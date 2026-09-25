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

// Validates Lollipop signing inputs and returns headers for the requested POST.
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

// Returns a fresh ES256 public JWK; its thumbprint is exposed as the key id.
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

// Attestation payloads use a randomly selected supported mobile platform.
const APP_PLATFORMS = ["android", "ios"];
const randomPlatform = (): string =>
  APP_PLATFORMS[Math.floor(Math.random() * APP_PLATFORMS.length)];

// Maps each requested JWT type to its protected header and claims. The caller
// signs the returned specification with the per-request ES256 keypair.
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
    // Legacy wallet attestation; keep it as the default for older callers.
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
        },
      };
    // IT Wallet instance attestation request.
    case "wia-request+jwt":
      return {
        protectedHeader: {
          alg: "ES256",
          kid: publicKey.kid,
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
          iss: request.key_tag,
          platform: randomPlatform(),
          wallet_solution_id: "appio",
          wallet_solution_version: "3.25.0.1",
        },
      };
    // IT Wallet key attestation request, including its nested key-attestation JWT.
    case "wua-request+jwt": {
      const platform = randomPlatform();
      const innerAttestation = await new jose.SignJWT({
        cnf: {
          jwk: publicKey,
        },
        wscd_key_attestation: {
          attestation: platform == "android" ? "test" : undefined,
          storage_type: "LOCAL_NATIVE",
        },
      })
        .setProtectedHeader({
          alg: "ES256",
          kid: publicKey.kid,
          typ: "key-attestation-request+jwt",
        })
        .setIssuedAt()
        .setExpirationTime("2h")
        .sign(keypair.privateKey);
      return {
        protectedHeader: {
          alg: "ES256",
          kid: publicKey.kid,
          typ: "wua-request+jwt",
        },
        claims: {
          cnf: {
            jwk: publicKey,
          },
          hardware_key_tag: request.key_tag,
          hardware_signature: "test",
          integrity_assertion: "test",
          iss: request.key_tag,
          nonce: request.nonce,
          platform,
          wallet_solution_id: "appio",
          wallet_solution_version: "3.25.0.1",
          keys_to_attest: [innerAttestation],
        },
      };
    }
    default:
      throw new Error(`Unsupported jwk_type: ${String(jwkType)}`);
  }
}

// Accepts a nonce, key tag, and optional JWT type; returns the signed JWT in
// `wallet_attestation_request`. A fresh keypair is used for each request.
app.post("/wallet-attestation-request", async (req, res) => {
  const keypair = await jose.generateKeyPair("ES256");
  return pipe(
    req.body,
    CreateWalletAttestationRequest.decode,
    TE.fromEither,
    TE.mapLeft((errs) => new Error(readableReportSimplified(errs))),
    TE.chain((request) =>
      pipe(
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
          const { protectedHeader, claims } = await buildAttestationSpec(
            request,
            publicKey,
            keypair,
            request.jwk_type
          );
          console.error({ protectedHeader, claims });
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
    TE.map((war) => ({ wallet_attestation_request: war })),
    TE.bimap(
      (err) => res.status(500).json({ error: err.message }),
      (_) => res.json(_)
    )
  )();
});

http.createServer(app).listen(8001);
