import { pipe } from "fp-ts/lib/function";
import * as t from "io-ts";
import * as E from "fp-ts/Either";
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

export const FeatureScanarioEnabledType = t.type({
  FEATURE_ENABLED: t.literal(true),
  SCENARIOS: CommaSeparatedListOf(FeatureScenarioType),
});
export type FeatureScanarioEnabledType = t.TypeOf<typeof FeatureScanarioEnabledType>;

export const FeatureScenarioConfig = t.union([
  t.type({
    FEATURE_ENABLED: t.literal(false),
  }),
  FeatureScanarioEnabledType
]);
export type FeatureScenarioConfig = t.TypeOf<typeof FeatureScenarioConfig>;

export const K6Config = t.type({
  rate: IntegerFromString,
  duration: NonEmptyString,
  preAllocatedVUs: IntegerFromString,
  maxVUs: IntegerFromString,
});
export type K6Config = t.TypeOf<typeof K6Config>;

export const IConfig = t.intersection([
  t.type({
    IO_BACKEND_BASE_URL: t.string,
    IO_BACKEND_TEST_PASSWD: NonEmptyString,
    TEST_FISCAL_CODE: CommaSeparatedListOf(FiscalCode),
  }),
  K6Config,
  FeatureScenarioConfig,
]);
export type IConfig = t.TypeOf<typeof IConfig>;

export const getConfigOrThrow = (
  environment: { [name: string]: string } | NodeJS.ProcessEnv
) =>
  pipe(
    environment,
    (env) => ({
      ...env,
      FEATURE_ENABLED: pipe(
        env.FEATURE_ENABLED,
        BooleanFromString.decode,
        E.getOrElse(() => false)
      )
    }),
    IConfig.decode,
    E.getOrElseW((errs) => {
      throw new Error(readableReportSimplified(errs));
    })
  );
