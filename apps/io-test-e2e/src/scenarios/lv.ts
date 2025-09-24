import http from "k6/http";
import { check, fail } from "k6";
import { pipe } from "fp-ts/lib/function";
import { GenerateNonceResponse } from "../generated/definitions/fast-login/GenerateNonceResponse";
import * as E from "fp-ts/Either";
//@ts-ignore
import { htmlReport } from "https://raw.githubusercontent.com/benc-uk/k6-reporter/main/dist/bundle.js";
//@ts-ignore
import { textSummary } from "https://jslib.k6.io/k6-summary/0.0.4/index.js";
import { errorsToReadableMessages, readableReportSimplified } from "@pagopa/ts-commons/lib/reporters";

import { SignerResponseBody } from "../types/signer";
import { AccessToken } from "../generated/definitions/login/AccessToken";
import { IConfig } from "../utils/config";
import { Counter, Trend } from "k6/metrics";
import { GeneratedKeypair } from "../utils/lollipop";
import { NonEmptyString } from "@pagopa/ts-commons/lib/strings";
import { trackRequest } from "../utils/metrics";
import { Client } from "k6/experimental/redis";
import { acquireLockOrWait, delKey, releaseLock, setKey } from "../utils/token";

const generateNonceDuration = new Trend("generate_nonce_duration");
const generateNonceSuccess = new Counter("generate_nonce_success");
const generateNonceFailure = new Counter("generate_nonce_failure");

const refreshFastLoginDuration = new Trend("fast_login_duration");
const refreshFastLoginSuccess = new Counter("fast_login_success");
const refreshFastLoginFailure = new Counter("fast_login_failure");

const refreshFastLoginWaiting = new Trend("fast_login_waiting");
const scenarioDuration = new Trend("lv_scenario_duration");


export const lvScenario = async (
  config: IConfig,
  REDIS_CLIENT: Client,
  key: GeneratedKeypair
): Promise<NonEmptyString> => {

  let duration = 0;
  // Generate Nonce
  const generateNonceResponse = http.post(
    `${config.AUTH_BACKEND_BASE_URL}/api/v1/fast-login/nonce/generate`,
    undefined,
    {
      responseType: "text",
    }
  );
  trackRequest({
    response: generateNonceResponse,
    checkTitle: "GET Nonce",
    successCounter: generateNonceSuccess,
    failureCounter: generateNonceFailure,
    durationTrend: generateNonceDuration,
    successStatuses: [200]
  });
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
    privateKeyJwk: JSON.stringify(key.privateKey),
    thumbprint: key.thumbprint,
    nonce,
    url: config.AUTH_BACKEND_BASE_URL + "/api/v1/fast-login",
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

  await acquireLockOrWait(REDIS_CLIENT, key.thumbprint);
  await delKey(REDIS_CLIENT, key.thumbprint)();

  // Refresh the session using Lollipop signature
  const refreshSession = http.post(
    `${config.AUTH_BACKEND_BASE_URL}/api/v1/fast-login`,
    undefined,
    {
      headers: {
        "x-pagopa-lollipop-original-method": "POST",
        "x-pagopa-lollipop-original-url": `${config.AUTH_BACKEND_BASE_URL}/api/v1/fast-login`,
        signature: lollipopParams.signature,
        "signature-input": lollipopParams.signatureInput,
        "Content-Type": "application/json",
      },
      responseType: "text",
    }
  );
  trackRequest({
    response: refreshSession,
    checkTitle: "POST Fast Login",
    successCounter: refreshFastLoginSuccess,
    failureCounter: refreshFastLoginFailure,
    durationTrend: refreshFastLoginDuration,
    successStatuses: [200]
  });
  refreshFastLoginWaiting.add(refreshSession.timings.waiting);
  duration += refreshSession.timings.duration;
  const errorOrToken = pipe(
    refreshSession.json(),
    AccessToken.decode,
    E.map((_) => _.token),
    E.mapLeft((_) => {
      console.error(`refreshResponse => ${refreshSession.status}`)
      console.error(`FiscalCode => ${key.fiscalCode} | Thumbprint => ${key.thumbprint}`)
      console.error(`Error decoding the refresh session response|DETAIL=${errorsToReadableMessages(_).join("|")}`);
      return new Error(readableReportSimplified(_));
    })
  );
  if(E.isLeft(errorOrToken)) {
    await releaseLock(REDIS_CLIENT, key.thumbprint);
    fail(errorOrToken.left.message);
  }
  await setKey(REDIS_CLIENT, key.thumbprint, errorOrToken.right)();
  await releaseLock(REDIS_CLIENT, key.thumbprint);
  scenarioDuration.add(duration);
  return errorOrToken.right;
};
