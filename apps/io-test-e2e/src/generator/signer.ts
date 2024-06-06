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
http.createServer(app).listen(8001);
