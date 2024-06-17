import { flow, pipe } from "fp-ts/lib/function";
import { FixturesEnabledConfig, getConfigOrThrow } from "../utils/config";
import * as TE from "fp-ts/TaskEither";
import * as T from "fp-ts/Task";
import * as ROA from "fp-ts/lib/ReadonlyArray";
import { initNewLollipopKey } from "../utils/lollipop";
import * as E from "fp-ts/Either";
import * as O from "fp-ts/Option";
import { FiscalCode, NonEmptyString } from "@pagopa/ts-commons/lib/strings";
import { createClient } from "../generated/definitions/services/client";
import { createClient as createBEClient } from "../generated/definitions/backend/client";

import * as NAR from "fp-ts/NonEmptyArray";
import * as AR from "fp-ts/Array";
import {
  errorsToReadableMessages,
  readableReportSimplified,
} from "@pagopa/ts-commons/lib/reporters";
import * as r from "@pagopa/ts-commons/lib/requests";
import { NewMessage } from "../generated/definitions/services/NewMessage";
import { faker as F } from "@faker-js/faker";
import { CreatedMessage } from "../generated/definitions/services/CreatedMessage";
import { InitializedProfile } from "../generated/definitions/backend/InitializedProfile";

const generateTestMessage = (
  fiscalCode: FiscalCode,
  msgNum: number
): NewMessage => ({
  content: {
    markdown: `md${msgNum} ${F.string.alphanumeric({
      length: {
        min: 90,
        max: 110,
      },
    })}`,
    subject: `s${msgNum} ${F.string.alpha(12)}`,
  },
  fiscal_code: fiscalCode,
});

const fixturesHandler = pipe(getConfigOrThrow(process.env), (config) =>
  pipe(
    FixturesEnabledConfig.decode(config),
    E.mapLeft((errs) => {
      return console.log(errorsToReadableMessages(errs).join("|"));
    }),
    O.fromEither,
    O.bindTo("fixturesConfig"),
    O.bind("testFiscalCodes", () =>
      O.some(config.TEST_FISCAL_CODE as ReadonlyArray<FiscalCode>)
    ),
    O.bind("subscritionKeys", ({ fixturesConfig }) =>
      O.some([...fixturesConfig.SEND_MESSAGES_APIM_SUBSCRIPTION_KEYS] as Array<
        NonEmptyString
      >)
    ),
    O.bind("messagesIOClient", ({ fixturesConfig }) =>
      O.some(
        createClient({
          basePath: "",
          baseUrl: fixturesConfig.SEND_MESSAGES_APIM_BASE_URL,
          fetchApi: fetch,
        })
      )
    ),
    O.bind("backendIOClient", () =>
      O.some(
        createBEClient({
          basePath: "/api/v1",
          baseUrl: `${config.IO_BACKEND_BASE_URL}`,
          fetchApi: fetch,
        })
      )
    ),
    O.bind(
      "generateAndUpsertProfiles",
      ({ backendIOClient, testFiscalCodes }) =>
        pipe(
          testFiscalCodes,
          ROA.map((fiscalCode) =>
            pipe(
              TE.tryCatch(
                () => initNewLollipopKey(config)(fiscalCode),
                E.toError
              ),
              TE.map((r) => r.token),
              TE.bindTo("sessionToken"),
              TE.bind("existingProfileVersion", ({ sessionToken }) =>
                pipe(
                  TE.tryCatch(
                    () =>
                      backendIOClient.getUserProfile({
                        Bearer: `Bearer ${sessionToken}`,
                      }),
                    E.toError
                  ),
                  TE.chain(
                    flow(
                      TE.fromEither,
                      TE.mapLeft(
                        (errs) => new Error(readableReportSimplified(errs))
                      )
                    )
                  ),
                  TE.chain(
                    TE.fromPredicate(
                      (
                        _
                      ): _ is r.IResponseType<200, InitializedProfile, never> =>
                        _.status === 200,
                      (res) =>
                        new Error(`Get User Profile: [status ${res.status}]`)
                    )
                  ),
                  TE.map((r) => r.value)
                )
              ),
              TE.chain(({ existingProfileVersion, sessionToken }) =>
                pipe(
                  TE.tryCatch(
                    () =>
                      backendIOClient.updateProfile({
                        Bearer: `Bearer ${sessionToken}`,
                        body: {
                          accepted_tos_version: 4.8,
                          is_inbox_enabled: true,
                          version: existingProfileVersion.version,
                        },
                      }),
                    E.toError
                  ),
                  TE.chain(
                    flow(
                      TE.fromEither,
                      TE.mapLeft(
                        (errs) => new Error(readableReportSimplified(errs))
                      )
                    )
                  ),
                  TE.chain(
                    TE.fromPredicate(
                      (
                        _
                      ): _ is r.IResponseType<200, InitializedProfile, never> =>
                        _.status === 200,
                      (res) =>
                        new Error(
                          `Update Profile: [status ${
                            res.status
                          }] [value ${JSON.stringify(res.value)}]`
                        )
                    )
                  )
                )
              )
            )
          ),
          ROA.sequence(TE.ApplicativeSeq),
          O.some
        )
    ),
    O.bind(
      "generateMessages",
      ({ messagesIOClient, testFiscalCodes, subscritionKeys }) =>
        pipe(
          testFiscalCodes,
          ROA.map((fiscalCode) =>
            pipe(
              NAR.range(1, 10),
              (arr) =>
                arr.map((num) =>
                  pipe(
                    {
                      message: generateTestMessage(fiscalCode, num),
                      subKey: pipe(subscritionKeys.shift(), (key) =>
                        pipe(
                          subscritionKeys.push(key as NonEmptyString),
                          () => key
                        )
                      ),
                    },
                    ({ message, subKey }) =>
                      TE.tryCatch(
                        () =>
                          messagesIOClient.submitMessageforUserWithFiscalCodeInBody(
                            {
                              message,
                              SubscriptionKey: subKey as NonEmptyString,
                            }
                          ),
                        E.toError
                      ),
                    TE.chain(
                      flow(
                        TE.fromEither,
                        TE.mapLeft(
                          (errs) => new Error(readableReportSimplified(errs))
                        )
                      )
                    ),
                    TE.chain(
                      TE.fromPredicate(
                        (_): _ is r.IResponseType<201, CreatedMessage, never> =>
                          _.status === 201,
                        (res) =>
                          new Error(
                            `Send Message num ${num}: [status ${res.status}]`
                          )
                      )
                    ),
                    TE.chain((res) => TE.fromTask(T.delay(500)(T.of(res))))
                  )
                ),
              AR.sequence(TE.ApplicativeSeq),
              TE.map((responses) => responses.length === 10)
            )
          ),
          ROA.sequence(TE.ApplicativeSeq),
          O.some
        )
    ),
    O.map(({ generateMessages, generateAndUpsertProfiles }) =>
      pipe(
        generateAndUpsertProfiles,
        TE.chainW(() => generateMessages),
        TE.getOrElse((e) => {
          throw e;
        })
      )
    ),
    O.getOrElseW(() => T.of(void 0))
  )
);

fixturesHandler().catch((err) => {
  console.error("Error executing the fixtures script: ", err);
  process.exit(1);
});
