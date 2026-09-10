import { FeatureScenarioEnabledType, getConfigOrThrow } from "./utils/config";
//@ts-ignore
import { htmlReport } from "https://raw.githubusercontent.com/benc-uk/k6-reporter/main/dist/bundle.js";
//@ts-ignore
import { textSummary } from "https://jslib.k6.io/k6-summary/0.0.4/index.js";
import { GeneratedKeypair } from "./utils/lollipop";
import { lvScenario } from "./scenarios/lv";
import { pipe } from "fp-ts/lib/function";
import * as E from "fp-ts/Either";
import { getFeatureScenario } from "./scenarios/mapping";
import { getRedisClient } from "./utils/redis";
import {
  getSessionTokenOrRefresh,
  keysInitializer,
  popListKeyAsJson,
  pushListKey,
  REDIS_KEYS_LIST,
  setLocalToken,
} from "./utils/token";
import { SharedArray } from "k6/data";
import { Trend } from "k6/metrics";
import http from "k6/http";
import { FeatureScenarioParams } from "./types/scenario";

const keys: ReadonlyArray<GeneratedKeypair> = new SharedArray(
  "keys",
  function() {
    const f = JSON.parse(open("../data/keys.json"));
    return f;
  }
);

const config = getConfigOrThrow(__ENV);
const iterationWallDuration = new Trend("iteration_wall_duration");

export const options = {
  discardResponseBodies: true,
  batch: 20,
  batchPerHost: 20,
  scenarios: {
    contacts: {
      executor: "ramping-arrival-rate",
      startRate: 1,
      stages: [
        { target: 10, duration: "2m" },
        { target: 10, duration: "1m" },
        { target: 100, duration: "2m" },
        { target: 100, duration: "15m" },
        //{ target: 10, duration: "1m" }, { target: 10, duration: "1m" },
        //{ target: 50, duration: "2m" }, { target: 50, duration: "3m" },
        //{ target: 5000, duration: "10m" }, { target: 5000, duration: "2m" },
      ],
      maxVUs: config.maxVUs,
      timeUnit: "1s",
      preAllocatedVUs: config.preAllocatedVUs,
      gracefulStop: "1m",
    },
  },
};

http.setResponseCallback(
  http.expectedStatuses({ min: 200, max: 399 })
);

const REDIS_CLIENT = getRedisClient(config.REDIS_CONN_STRING);
const tokenChecker = getSessionTokenOrRefresh(REDIS_CLIENT, config);

export async function setup() {
  const result = await keysInitializer(REDIS_CLIENT)(REDIS_KEYS_LIST, keys)();
  if (E.isLeft(result)) {
    throw result.left;
  }
}

const runFeatureScenarios = async (params: FeatureScenarioParams) => {
  const scenarios = pipe(
    config,
    FeatureScenarioEnabledType.decode,
    E.map((featureScenarioConfig) =>
      featureScenarioConfig.SCENARIOS.map(getFeatureScenario)
    ),
    E.getOrElseW(() => [] as ReturnType<typeof getFeatureScenario>[])
  );
  await Promise.all(scenarios.map((fn) => fn(params)));
};

export default async function() {
  const startedAt = Date.now();
  let leasedKey: GeneratedKeypair | undefined;
  try {
    const popped = await popListKeyAsJson(REDIS_CLIENT, REDIS_KEYS_LIST)();
    if (E.isLeft(popped)) {
      throw popped.left;
    }
    leasedKey = popped.right as GeneratedKeypair;

    const token = config.ENABLE_LV_SCENERY
      ? await lvScenario(config, REDIS_CLIENT, leasedKey)
      : await tokenChecker(leasedKey);
    setLocalToken(leasedKey.thumbprint, token);

    await runFeatureScenarios({
      config,
      REDIS_CLIENT,
      key: leasedKey,
      token,
    });
  } catch (e) {
    const err = e as Error;
    console.error(
      `Abort execution|DETAIL => ${JSON.stringify(err)} | ${err && err.stack} | ${
        err && err.message
      }`
    );
  } finally {
    if (leasedKey) {
      const pushed = await pushListKey(
        REDIS_CLIENT,
        REDIS_KEYS_LIST,
        JSON.stringify(leasedKey)
      )();
      if (E.isLeft(pushed)) {
        console.error(
          `Failed to return key to Redis queue|DETAIL => ${JSON.stringify(
            pushed.left
          )}`
        );
      }
    }
    iterationWallDuration.add(Date.now() - startedAt);
  }
}

export function handleSummary(data: unknown) {
  return {
    "./out/summary.html": htmlReport(data),
    "./out/summary.json": JSON.stringify(data),
    stdout: textSummary(data, { indent: " ", enableColors: true }),
  };
}
