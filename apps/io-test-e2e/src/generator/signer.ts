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
          publicKey,
          challenge: request.nonce,
          keyTag: request.key_tag,
        }))
      )
    ),
    TE.chain(({ challenge, publicKey, keyTag }) =>
      TE.tryCatch(
        () =>
          new jose.SignJWT({
            challenge,
            cnf: {
              jwk: publicKey,
            },
            hardware_key_tag: keyTag,
            hardware_signature: "test",
            integrity_assertion: "test",
            iss: publicKey.kid,
            sub: "https://wallet.io.pagopa.it",
          })
            .setProtectedHeader({
              alg: "ES256",
              kid: publicKey.kid,
              typ: "war+jwt",
            })
            .setIssuedAt()
            .setExpirationTime("2h")
            .sign(keypair.privateKey),
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
