import { FeatureScanarioEnabledType, getConfigOrThrow } from "./utils/config";
//@ts-ignore
import { htmlReport } from "https://raw.githubusercontent.com/benc-uk/k6-reporter/main/dist/bundle.js";
//@ts-ignore
import { textSummary } from "https://jslib.k6.io/k6-summary/0.0.4/index.js";
import { GeneratedKeypair } from "./utils/lollipop";
import { lvScenario } from "./scenarios/lv";
import { appOpening } from "./scenarios/landing";
import { pipe } from "fp-ts/lib/function";
import * as E from "fp-ts/Either";
import * as TE from "fp-ts/TaskEither";
import * as AR from "fp-ts/Array";
import { getFeatureScenario } from "./scenarios/mapping";
import { getRedisClient } from "./utils/redis";
import {
  checkAndGetToken,
  delKey,
  keysInitializer,
  popListKeyAsJson,
  pushListKey,
  setKey,
} from "./utils/token";
import { SharedArray } from "k6/data";

const keys: ReadonlyArray<GeneratedKeypair> = new SharedArray(
  "keys",
  function() {
    // here you can open files, and then do additional processing or generate the array with data dynamically
    const f = JSON.parse(open("../data/keys.json"));
    return f; // f must be an array[]
  }
);

const config = getConfigOrThrow(__ENV);

export const options = {
  scenarios: {
    contacts: {
      executor: "constant-arrival-rate",

      // How long the test lasts
      duration: config.duration,

      maxVUs: config.maxVUs,
      // How many iterations per timeUnit
      rate: config.rate,
      /**
       * AzureDiagnostics
        | where backendPoolName_s == "appbackend-app-address-pool"
        | where requestUri_s != "/pagopa/api/v1/user" and requestUri_s != "/bpd/api/v1/user" and httpStatus_d != 404
        | summarize requests = count() by clientIP_s, bin(TimeGenerated, 15m)
        | summarize count() by clientIP_s
        | summarize sum(count_)
       */

      // Start `rate` iterations per second
      timeUnit: "1s",

      // Pre-allocate VUs (concurrent users)
      preAllocatedVUs: config.preAllocatedVUs,
    },
  },
};

const REDIS_CLIENT = getRedisClient(config.REDIS_CONN_STRING);

export const tokenChecker = checkAndGetToken(REDIS_CLIENT);
const queueInitializer = keysInitializer(REDIS_CLIENT);

export async function setup() {
  //await queueInitializer("keys", keys)()
}

export default async function() {
  await pipe(
    queueInitializer("keys", keys),
    TE.chain(() => popListKeyAsJson(REDIS_CLIENT, "keys")),
    TE.map((generatedKeyPair) => generatedKeyPair as GeneratedKeypair),
    TE.chain((key) =>
      pipe(
        delKey(REDIS_CLIENT, key.thumbprint),
        TE.chain(() =>
          pipe(
            lvScenario(config, key),
            TE.of,
            TE.chain((token) =>
              pipe(
                setKey(REDIS_CLIENT, key.thumbprint, token),
                TE.chain(() =>
                  pushListKey(REDIS_CLIENT, "keys", JSON.stringify(key))
                ),
                TE.map(() => token)
              )
            ),
            TE.orElseW(() =>
              pushListKey(REDIS_CLIENT, "keys", JSON.stringify(key))
            )
          )
        ),
        TE.chain(() =>
          TE.tryCatch(
            () => appOpening(config, key.thumbprint, tokenChecker),
            E.toError
          )
        ),
        TE.map(() =>
          pipe(
            config,
            FeatureScanarioEnabledType.decode,
            E.map((featureScenarioConfig) =>
              featureScenarioConfig.SCENARIOS.map(getFeatureScenario)
            ),
            E.getOrElseW(() => []),
            (scenarios) =>
              scenarios.map((fn) =>
                TE.tryCatch(
                  () => fn(config, key.thumbprint, tokenChecker),
                  E.toError
                )
              ),
            AR.sequence(TE.ApplicativeSeq)
          )
        )
      )
    ),
    TE.mapLeft(e => console.error(`Abort execution|DETAIL => ${JSON.stringify(e)}`)),
    TE.toUnion
  )();
}

export function handleSummary(data: unknown) {
  return {
    "./out/summary.html": htmlReport(data),
    "./out/summary.json": JSON.stringify(data),
    stdout: textSummary(data, { indent: " ", enableColors: true }),
  };
}
