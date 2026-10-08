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
  t.literal("APP_OPENING"),
  t.literal("TRIAL"),
  t.literal("MESSAGE_DETAIL"),
  t.literal("WALLET"),
  t.literal("BONUS"),
  t.literal("SERVICES"),
  t.literal("CGN"),
]);
export type FeatureScenarioType = t.TypeOf<typeof FeatureScenarioType>;

export const FeatureScenarioEnabledType = t.type({
  FEATURE_ENABLED: t.literal(true),
  SCENARIOS: CommaSeparatedListOf(FeatureScenarioType),
});

export type FeatureScenarioEnabledType = t.TypeOf<
  typeof FeatureScenarioEnabledType
>;

export const FeatureScenarioConfig = t.union([
  t.type({
    FEATURE_ENABLED: t.literal(false),
  }),
  FeatureScenarioEnabledType,
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
    FIXTURES_ENABLED: t.literal(false),
  }),
  FixturesEnabledConfig,
]);
export type FixturesConfig = t.TypeOf<typeof FixturesConfig>;

export const IConfig = t.intersection([
  t.type({
    AUTH_BACKEND_BASE_URL: t.string,
    IO_BACKEND_BASE_URL: t.string,
    IO_BACKEND_TEST_PASSWD: NonEmptyString,
    TEST_FISCAL_CODE: CommaSeparatedListOf(FiscalCode),
    REDIS_CONN_STRING: NonEmptyString,
    ENABLE_LV_SCENERY: t.boolean,
    ENABLE_SSO_INTROSPECTION: t.boolean,
    SERVICES_BASE_RATE_PERCENTAGE: t.number,
    DOCUMENTS_ON_IO_RATE_PERCENTAGE: t.number,
    IT_WALLET_RATE_PERCENTAGE: t.number,
    IT_WALLET_KEY_ATTESTATION_MULTIPLIER: t.number
  }),
  K6Config,
  FeatureScenarioConfig,
  FixturesConfig,
]);
export type IConfig = t.TypeOf<typeof IConfig>;

const parseWalletRatePercentage = (
  value: string | undefined,
  variableName: string
): number => {
  if (value === undefined) {
    return 0;
  }

  if (!/^\d+$/.test(value)) {
    throw new Error(`${variableName} must be an integer between 0 and 100`);
  }

  const percentage = Number(value);
  if (percentage < 0 || percentage > 100 || percentage % 1 !== 0) {
    throw new Error(`${variableName} must be an integer between 0 and 100`);
  }

  return percentage;
};

const parseWalletKeyAttestationMultiplier = (
  value: string | undefined
): number => {
  if (value === undefined) {
    return 10;
  }

  const multiplier = Number(value);
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(multiplier) || multiplier < 1) {
    throw new Error(
      "IT_WALLET_KEY_ATTESTATION_MULTIPLIER must be a positive safe integer"
    );
  }

  return multiplier;
};

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
      ),
      ENABLE_LV_SCENERY: pipe(
        env.ENABLE_LV_SCENERY,
        BooleanFromString.decode,
        E.getOrElse(() => false)
      ),
      ENABLE_SSO_INTROSPECTION: pipe(
        env.ENABLE_SSO_INTROSPECTION,
        BooleanFromString.decode,
        E.getOrElse(() => false)
      ),
      SERVICES_BASE_RATE_PERCENTAGE: pipe(
        env.SERVICES_BASE_RATE_PERCENTAGE,
        IntegerFromString.decode,
        E.getOrElse(() => 100)
      ),
      DOCUMENTS_ON_IO_RATE_PERCENTAGE: parseWalletRatePercentage(
        env.DOCUMENTS_ON_IO_RATE_PERCENTAGE,
        "DOCUMENTS_ON_IO_RATE_PERCENTAGE"
      ),
      IT_WALLET_RATE_PERCENTAGE: parseWalletRatePercentage(
        env.IT_WALLET_RATE_PERCENTAGE,
        "IT_WALLET_RATE_PERCENTAGE"
      ),
      IT_WALLET_KEY_ATTESTATION_MULTIPLIER: parseWalletKeyAttestationMultiplier(
        env.IT_WALLET_KEY_ATTESTATION_MULTIPLIER
      )
    }),
    IConfig.decode,
    E.getOrElseW((errs) => {
      throw new Error(readableReportSimplified(errs));
    })
  );
