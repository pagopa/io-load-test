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

const logTaskEither = (msg: string) => <E, O>(te: TE.TaskEither<E, O>) =>
  pipe(te , TE.map(o => {
    console.log(msg);
    return o;
  }));

const retriableTaskEither = (retryNum: number, fixedDelay: number) => async <E, O>(te: TE.TaskEither<E, O>) => {
    let res: E.Either<E,O> = await te();
    let isOk = E.isRight(res);
    let i = 2;
    while (i <= retryNum && !isOk){
      await TE.fromTask(T.delay(fixedDelay)(T.of(void 0)))();
      console.log(`Tentative num ${i} of ${retryNum}`);
      res = await te();
      isOk = E.isRight(res);
      i++;
    }
    return res;
}

const fixturesHandler = pipe(
  getConfigOrThrow(process.env),
  (config) =>
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
        O.some([
          ...fixturesConfig.SEND_MESSAGES_APIM_SUBSCRIPTION_KEYS,
        ] as Array<NonEmptyString>)
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
                initTe => TE.tryCatch(() => retriableTaskEither(5, 1000)(initTe), E.toError),
                TE.chain(TE.fromEither),
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
                    getTe => TE.tryCatch(() => retriableTaskEither(5, 1000)(getTe), E.toError),
                    TE.chain(TE.fromEither),
                    TE.chainW(
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
                        ): _ is r.IResponseType<
                          200,
                          InitializedProfile,
                          never
                        > => _.status === 200,
                        (res) =>
                          new Error(`Get User Profile: [status ${res.status}]`)
                      )
                    ),
                    TE.map((r) => r.value)
                  )
                ),
                TE.chain(({ existingProfileVersion, sessionToken }) =>
                  pipe(
                    existingProfileVersion,
                    O.fromPredicate((p) => p.is_inbox_enabled),
                    O.map((dbProfile) =>
                      pipe(
                        TE.tryCatch(
                          () =>
                            backendIOClient.updateProfile({
                              Bearer: `Bearer ${sessionToken}`,
                              body: {
                                accepted_tos_version: 4.8,
                                is_inbox_enabled: true,
                                version: dbProfile.version,
                              },
                            }),
                          E.toError
                        ),
                        updateTe => TE.tryCatch(() => retriableTaskEither(5, 1000)(updateTe), E.toError),
                        TE.chain(TE.fromEither),
                        TE.chain(
                          flow(
                            TE.fromEither,
                            TE.mapLeft(
                              (errs) =>
                                new Error(readableReportSimplified(errs))
                            )
                          )
                        ),
                        TE.chain(
                          TE.fromPredicate(
                            (
                              _
                            ): _ is r.IResponseType<
                              200,
                              InitializedProfile,
                              never
                            > => _.status === 200,
                            (res) =>
                              new Error(
                                `Update Profile: [status ${
                                  res.status
                                }] [value ${JSON.stringify(res.value)}]`
                              )
                          )
                        )
                      )
                    ),
                    O.getOrElseW(() => TE.of(void 0))
                  )
                ),
                logTaskEither(`Initialized profile for ${fiscalCode}`),
                TE.chain((res) => TE.fromTask(T.delay(200)(T.of(res))))
              )
            ),
            ROA.sequence(TE.ApplicativeSeq),
            O.some
          )
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
            logTaskEither(`Test messages sent for ${fiscalCode}`),
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
);

fixturesHandler().catch((err) => {
  console.error("Error executing the fixtures script: ", err);
  process.exit(1);
});
