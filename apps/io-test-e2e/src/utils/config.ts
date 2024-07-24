import { pipe } from "fp-ts/lib/function";
import * as t from "io-ts";
import * as E from "fp-ts/Either";
import * as O from "fp-ts/Option";
import { readableReportSimplified } from "@pagopa/ts-commons/lib/reporters";
import { FiscalCode, NonEmptyString } from "@pagopa/ts-commons/lib/strings";
import { CommaSeparatedListOf } from "./separated-list";
import { IntegerFromString } from "@pagopa/ts-commons/lib/numbers";
import { BooleanFromString } from "io-ts-types";

export const FeatureScenarioType = t.union([
  t.literal("TRIAL"),
  t.literal("MESSAGE_DETAIL"),
]);
export type FeatureScenarioType = t.TypeOf<typeof FeatureScenarioType>;

export const FeatureScenarioEnabledType = t.type({
  FEATURE_ENABLED: t.literal(true),
  SCENARIOS: CommaSeparatedListOf(FeatureScenarioType),
});
export type FeatureScenarioEnabledType = t.TypeOf<typeof FeatureScenarioEnabledType>;

export const FeatureScenarioConfig = t.union([
  t.type({
    FEATURE_ENABLED: t.literal(false),
  }),
  FeatureScenarioEnabledType
]);
export type FeatureScenarioConfig = t.TypeOf<typeof FeatureScenarioConfig>;

export const K6Config = t.type({
  rate: IntegerFromString,
  duration: NonEmptyString,
  preAllocatedVUs: IntegerFromString,
  maxVUs: IntegerFromString,
});
export type K6Config = t.TypeOf<typeof K6Config>;

export const FixturesEnabledConfig = t.type({
  FIXTURES_ENABLED: t.literal(true),
  SEND_MESSAGES_APIM_BASE_URL: NonEmptyString,
  SEND_MESSAGES_APIM_SUBSCRIPTION_KEYS: CommaSeparatedListOf(NonEmptyString),
});
export type FixturesEnabledConfig = t.TypeOf<typeof FixturesEnabledConfig>;

export const FixturesConfig = t.union([
  t.type({
    FIXTURES_ENABLED: t.literal(false)
  }),
  FixturesEnabledConfig
]);
export type FixturesConfig = t.TypeOf<typeof FixturesConfig>;

export const IConfig = t.intersection([
  t.type({
    AUTH_BACKEND_BASE_URL: t.string,
    IO_BACKEND_BASE_URL: t.string,
    IO_BACKEND_TEST_PASSWD: NonEmptyString,
    TEST_FISCAL_CODE: CommaSeparatedListOf(FiscalCode),
    REDIS_CONN_STRING: NonEmptyString
  }),
  K6Config,
  FeatureScenarioConfig,
  FixturesConfig,
]);
export type IConfig = t.TypeOf<typeof IConfig>;

export const getConfigOrThrow = (
  environment: { [name: string]: string } | NodeJS.ProcessEnv
) =>
  pipe(
    environment,
    (env) => ({
      ...env,
      AUTH_BACKEND_BASE_URL: pipe(
        env.AUTH_BACKEND_BASE_URL,
        O.fromNullable,
        O.getOrElse(() => env.IO_BACKEND_BASE_URL)
      ),
      FEATURE_ENABLED: pipe(
        env.FEATURE_ENABLED,
        BooleanFromString.decode,
        E.getOrElse(() => false)
      ),
      FIXTURES_ENABLED: pipe(
        env.FIXTURES_ENABLED,
        BooleanFromString.decode,
        E.getOrElse(() => false)
      )
    }),
    IConfig.decode,
    E.getOrElseW((errs) => {
      throw new Error(readableReportSimplified(errs));
    })
  );
