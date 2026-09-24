import express from "express";
import * as bodyParser from "body-parser";

import { SignParams } from "../types/signer";
import { identity, pipe } from "fp-ts/lib/function";
import * as E from "fp-ts/Either";
import * as TE from "fp-ts/TaskEither";
import { createLollipopHeaders } from "../utils/signature";
import * as jose from "jose";
import { readableReportSimplified } from "@pagopa/ts-commons/lib/reporters";
import * as http from "http";
import { CreateWalletAttestationRequest } from "../types/wallet";

const app = express();
app.use(bodyParser.json());

app.post("/signature-params", async (req, res) => {
  return pipe(
    req.body,
    SignParams.decode,
    TE.fromEither,
    TE.mapLeft((errs) => new Error(readableReportSimplified(errs))),
    TE.chain((_) =>
      TE.tryCatch(
        () =>
          createLollipopHeaders({
            body: undefined,
            privateKeyJwk: _.privateKeyJwk as jose.JWK,
            thumbprint: _.thumbprint,
            url: _.url,
            nonce: _.nonce,
            method: "POST",
          }),
        E.toError
      )
    ),
    TE.chainEitherK(identity),
    TE.bimap(
      (err) => res.status(500).json({ error: err.message }),
      (_) => res.json(_)
    )
  )();
});

app.get("/random-key", async (_req, res) => {
  const keyPair = await jose.generateKeyPair("ES256");
  return pipe(
    TE.tryCatch(() => jose.exportJWK(keyPair.publicKey), E.toError),
    TE.chain((publicKey) =>
      pipe(
        TE.tryCatch(() => jose.calculateJwkThumbprint(publicKey), E.toError),
        TE.map((kid) => ({
          ...publicKey,
          kid,
        }))
      )
    ),
    TE.bimap(
      (err) => res.status(500).json({ error: err.message }),
      (_) => res.json(_)
    )
  )();
});

// Wallet solution platforms; attestation types 2 and 3 pick one at random.
const APP_PLATFORMS = ["android", "ios"];
const randomPlatform = (): string =>
  APP_PLATFORMS[Math.floor(Math.random() * APP_PLATFORMS.length)];

// Builds the protected header and payload claims for the attestation
// typology selected by the optional `jwk_type` request field,
// which carries the target JWT `typ` value:
//     "wp-war+jwt"      (or absent) -> original behaviour, dynamic JWK/kid
//     "wia-request+jwt"              -> static kid, wallet solution claims
//     "wua-request+jwt"              -> nested key attestation
// The returned spec is then signed by the caller with the generated keypair.
// `sign()` is async in jose v4, hence the async helper (for the nested
// "wua-request+jwt" key-attestation JWT).
async function buildAttestationSpec(
  request: CreateWalletAttestationRequest,
  publicKey: jose.JWK & { kid: string },
  keypair: jose.GenerateKeyPairResult,
  jwkType:
    | "wp-war+jwt"
    | "wia-request+jwt"
    | "wua-request+jwt"
    | undefined
): Promise<{
  protectedHeader: jose.JWTHeaderParameters;
  claims: Record<string, unknown>;
}> {
  switch (jwkType) {
    // "wp-war+jwt" (default, `jwk_type` absent): byte-for-byte equivalent
    // to the original behaviour.
    case "wp-war+jwt":
    case undefined:
      return {
        protectedHeader: {
          alg: "ES256",
          kid: publicKey.kid,
          typ: "wp-war+jwt",
        },
        claims: {
          aud: "aud",
          nonce: request.nonce,
          cnf: {
            jwk: publicKey,
          },
          hardware_key_tag: request.key_tag,
          hardware_signature: "test",
          integrity_assertion: "test",
          iss: publicKey.kid,
            // platform: "android"
            // wallet_solution_id: "appio",
            // wallet_solution_version: "3.25.0.1"
        },
      };
    // "wia-request+jwt" as documented by the original comment block
    // (static kid, no aud, wallet solution claims, random platform).
    case "wia-request+jwt":
      return {
          /**
           * {
              "alg": "ES256",
              "kid": "ec#1",
              "typ": "wia-request+jwt"
              }
           */
          protectedHeader: {
            alg: "ES256",
            kid: "ec#1",
            typ: "wia-request+jwt",
          },
          claims: {
            nonce: request.nonce,
            cnf: {
              jwk: publicKey,
            },
            hardware_key_tag: request.key_tag,
            hardware_signature: "test",
            integrity_assertion: "test",
            iss: publicKey.kid,
            platform: randomPlatform(),
            wallet_solution_id: "appio",
            wallet_solution_version: "3.25.0.1",
          },
      };
    // "wua-request+jwt" as documented in src/scenarios/wallet.ts
    // (the request-generated public key, static "bar11" key) plus a nested
    // key-attestation JWT signed with the same generated keypair (no
    // iat/exp, per the reference).
    case "wua-request+jwt": {
      // Nested key-attestation JWT signed with the same generated keypair;
      // no iat/exp, per the reference in src/scenarios/wallet.ts.
      const innerAttestation = await new jose.SignJWT({
        cnf: {
          jwk: publicKey,
        },
        wscd_key_attestation: {
          storage_type: "LOCAL_NATIVE",
        },
      })
        .setProtectedHeader({
          alg: "ES256",
          kid: "ec#1",
          typ: "key-attestation-request+jwt",
        })
        .sign(keypair.privateKey);
      return {
        protectedHeader: {
          alg: "ES256",
          kid: "ec#1",
          typ: "wua-request+jwt",
        },
        claims: {
          cnf: {
            jwk: publicKey,
          },
          hardware_key_tag: "bar11",
          hardware_signature: "foo",
          integrity_assertion: "foo",
          iss: "bar11",
          nonce: request.nonce,
          platform: randomPlatform(),
          wallet_solution_id: "appio",
          wallet_solution_version: "3.25.0.1",
          keys_to_attest: [innerAttestation],
        },
      };
    }
    // Unreachable: the codec only accepts 1 | 2 | 3 | undefined, anything
    // else is rejected during request decoding (500 error response).
    default:
      throw new Error(`Unsupported jwk_type: ${String(jwkType)}`);
  }
}

app.post("/wallet-attestation-request", async (req, res) => {
  console.info("CALLING WAR ENDPOINT: ", req.body);
  const keypair = await jose.generateKeyPair("ES256");
  return pipe(
    req.body,
    CreateWalletAttestationRequest.decode,
    TE.fromEither,
    TE.mapLeft((errs) => new Error(readableReportSimplified(errs))),
    TE.chain((request) =>
      pipe(
        // jose v4's exportJWK/calculateJwkThumbprint are async; fp-ts 2.16's
        // TE.tryCatch awaits the returned promise and keeps rejections inside
        // the TaskEither (no unhandled promises / thrown exceptions).
        TE.tryCatch(() => jose.exportJWK(keypair.publicKey), E.toError),
        TE.chain((publicKey) =>
          pipe(
            TE.tryCatch(
              () => jose.calculateJwkThumbprint(publicKey),
              E.toError
            ),
            TE.map((kid) => ({
              ...publicKey,
              kid,
            }))
          )
        ),
        TE.map((publicKey) => ({
          request,
          publicKey,
          challenge: request.nonce,
          keyTag: request.key_tag,
        }))
      )
    ),
    TE.chain(({ request, publicKey }) =>
      TE.tryCatch(
        async () => {
          // Select the attestation typology via the optional `jwk_type`
          // request field (1 = default, 2, 3), then sign the resulting
          // header/claims with the freshly generated keypair
          // (jose v4's sign() is async; tryCatch awaits the promise).
          const { protectedHeader, claims } = await buildAttestationSpec(
            request,
            publicKey,
            keypair,
            request.jwk_type
          );
          return (
            new jose.SignJWT(claims)
              .setProtectedHeader(protectedHeader)
              .setIssuedAt()
              .setExpirationTime("2h")
              .sign(keypair.privateKey)
          );
        },
        E.toError
      )
    ),
    TE.map((war) => {
      console.log(JSON.stringify({ wallet_attestation_request: war }));
      return { wallet_attestation_request: war };
    }),
    TE.bimap(
      (err) => {
        console.error(err);
        return res.status(500).json({ error: err.message })
      },
      (_) => res.json(_)
    )
  )();
});

http.createServer(app).listen(8001);
