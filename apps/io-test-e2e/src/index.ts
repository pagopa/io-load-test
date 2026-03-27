import { FeatureScenarioEnabledType, getConfigOrThrow } from "./utils/config";
//@ts-ignore
import { htmlReport } from "https://raw.githubusercontent.com/benc-uk/k6-reporter/main/dist/bundle.js";
//@ts-ignore
import { textSummary } from "https://jslib.k6.io/k6-summary/0.0.4/index.js";
import { GeneratedKeypair } from "./utils/lollipop";
import { lvScenario } from "./scenarios/lv";
import { pipe } from "fp-ts/lib/function";
import * as E from "fp-ts/Either";
import * as TE from "fp-ts/TaskEither";
import * as AR from "fp-ts/Array";
import { getFeatureScenario } from "./scenarios/mapping";
import { getRedisClient } from "./utils/redis";
import {
  getSessionTokenOrRefresh,
  keysInitializer,
  popListKeyAsJson,
  pushListKey,
} from "./utils/token";
import { SharedArray } from "k6/data";
import { identity } from "fp-ts/lib/function";

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
      executor: "ramping-arrival-rate",

      startRate: 1,

      stages: [
        {target: 10, duration: "2m"},{target: 10, duration: "1m"},
        {target: 100, duration: "2m"}, {target: 100, duration: "15m"},
        //{target: 10, duration: "1m"}, {target: 10, duration: "1m"},
        //{target: 50, duration: "2m"}, {target: 50, duration: "3m"},
        //{target: 5000, duration: "10m"}, {target: 5000, duration: "2m"},
      ],

      maxVUs: config.maxVUs,

      // Start `rate` iterations per second
      timeUnit: "1s",

      // Pre-allocate VUs (concurrent users)
      preAllocatedVUs: config.preAllocatedVUs,
      gracefulStop: "1m"
    },
  },
};

const REDIS_CLIENT = getRedisClient(config.REDIS_CONN_STRING);

export const newTokenChecker = getSessionTokenOrRefresh(REDIS_CLIENT, config);
const queueInitializer = keysInitializer(REDIS_CLIENT);

export default async function() {
  await pipe(
    queueInitializer("keys", keys),
    TE.chain(() => popListKeyAsJson(REDIS_CLIENT, "keys")),
    TE.map((generatedKeyPair) => generatedKeyPair as GeneratedKeypair),
    TE.chain((key) =>
      pipe(
        config.ENABLE_LV_SCENERY,
        TE.fromPredicate(identity, () => false),
        TE.chainW(() =>
          TE.tryCatch(() => lvScenario(config, REDIS_CLIENT, key), () => new Error("Error executing lvScenario")),
        ),
        TE.chainW(() =>
          pushListKey(REDIS_CLIENT, "keys", JSON.stringify(key))
        ),
        TE.orElseW(() =>
          pushListKey(REDIS_CLIENT, "keys", JSON.stringify(key))
        ),
        TE.chain(() =>
          pipe(
            config,
            FeatureScenarioEnabledType.decode,
            E.map((featureScenarioConfig) =>
              featureScenarioConfig.SCENARIOS.map(getFeatureScenario)
            ),
            E.getOrElseW(() => []),
            (scenarios) =>
              scenarios.map((fn) =>
                TE.tryCatch(
                  async () => fn({ config, REDIS_CLIENT, key, tokenChecker:newTokenChecker }),
                  E.toError
                )
              ),
            AR.sequence(TE.ApplicativeSeq)
          )
        )
      )
    ),
    TE.mapLeft(e => console.error(`Abort execution|DETAIL => ${JSON.stringify(e)} | ${e.stack} | ${e.message}`)),
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
