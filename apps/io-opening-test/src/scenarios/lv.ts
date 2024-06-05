import http from "k6/http";
import { check, fail } from "k6";
import { pipe } from "fp-ts/lib/function";
import { GenerateNonceResponse } from "../generated/definitions/fast-login/GenerateNonceResponse";
import * as E from "fp-ts/Either";
//@ts-ignore
import { htmlReport } from "https://raw.githubusercontent.com/benc-uk/k6-reporter/main/dist/bundle.js";
//@ts-ignore
import { textSummary } from "https://jslib.k6.io/k6-summary/0.0.4/index.js";
import { readableReportSimplified } from "@pagopa/ts-commons/lib/reporters";

import { SignerResponseBody } from "../types/signer";
import { AccessToken } from "../generated/definitions/login/AccessToken";
import { IConfig } from "../utils/config";
import { Trend } from "k6/metrics";
import { GeneratedKeypair } from "../utils/lollipop";
import { NonEmptyString } from "@pagopa/ts-commons/lib/strings";

const generateNonceDuration = new Trend("generate_nonce_duration");
const refreshFastLoginDuration = new Trend("fast_login_duration");
const refreshFastLoginWaiting = new Trend("fast_login_waiting");
const sessionDuration = new Trend("get_session_duration");
const scenarioDuration = new Trend("scenario_duration");

export const lvScenario = (
  config: IConfig,
  vuIdInstance: number,
  keys: ReadonlyArray<GeneratedKeypair>
): NonEmptyString => {
  let duration = 0;
  // Generate Nonce
  const generateNonceResponse = http.post(
    `${config.IO_BACKEND_BASE_URL}/api/v1/fast-login/nonce/generate`,
    undefined,
    {
      responseType: "text",
    }
  );
  check(generateNonceResponse, {
    "GET Nonce returns 200": (r) => r.status === 200,
  });
  generateNonceDuration.add(generateNonceResponse.timings.duration);
  duration += generateNonceResponse.timings.duration;
  const nonce = pipe(
    generateNonceResponse.json(),
    GenerateNonceResponse.decode,
    E.map((_) => _.nonce),
    E.getOrElseW((_) => {
      console.error("Error decoding nonce");
      fail(readableReportSimplified(_));
    })
  );

  // Generate Signature params for lollipop
  const parameters = {
    privateKeyJwk: JSON.stringify(keys[vuIdInstance - 1].privateKey),
    thumbprint: keys[vuIdInstance - 1].thumbprint,
    nonce,
    url: config.IO_BACKEND_BASE_URL + "/api/v1/fast-login",
  };
  const signerResponse = http.post(
    `http://localhost:8001/signature-params`,
    JSON.stringify(parameters),
    {
      headers: {
        "Content-Type": "application/json",
      },
      responseType: "text",
    }
  );
  check(signerResponse, {
    "POST Signature returns 200": (r) => r.status === 200,
  });

  const lollipopParams = pipe(
    signerResponse.json(),
    SignerResponseBody.decode,
    E.getOrElseW((_) => {
      console.error("Error decoding signer response body");
      fail(readableReportSimplified(_));
    })
  );

  // Refresh the session using Lollipop signature
  const refreshSession = http.post(
    `${config.IO_BACKEND_BASE_URL}/api/v1/fast-login`,
    undefined,
    {
      headers: {
        "x-pagopa-lollipop-original-method": "POST",
        "x-pagopa-lollipop-original-url": `${config.IO_BACKEND_BASE_URL}/api/v1/fast-login`,
        signature: lollipopParams.signature,
        "signature-input": lollipopParams.signatureInput,
        "Content-Type": "application/json",
      },
      responseType: "text",
    }
  );
  check(refreshSession, {
    "POST Fast Login returns 200": (r) => r.status === 200,
  });
  refreshFastLoginDuration.add(refreshSession.timings.duration);
  refreshFastLoginWaiting.add(refreshSession.timings.waiting);
  duration += refreshSession.timings.duration;
  const token = pipe(
    refreshSession.json(),
    AccessToken.decode,
    E.map((_) => _.token),
    E.getOrElseW((_) => {
      console.error("Error decoding the refresh session response");
      fail(readableReportSimplified(_));
    })
  );

  // Retrieve the session using the new token
  const getSession = http.get(`${config.IO_BACKEND_BASE_URL}/api/v1/session`, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    responseType: "text",
  });
  check(getSession, {
    "GET Get Session returns 200": (r) => r.status === 200,
  });
  sessionDuration.add(getSession.timings.duration);
  duration += getSession.timings.duration;
  scenarioDuration.add(duration);
  return token;
};
