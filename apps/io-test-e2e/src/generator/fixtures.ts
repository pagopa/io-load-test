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

import * as NAR from "fp-ts/NonEmptyArray";
import * as AR from "fp-ts/Array";
import { readableReportSimplified } from "@pagopa/ts-commons/lib/reporters";
import * as r from "@pagopa/ts-commons/lib/requests";
import { NewMessage } from "../generated/definitions/services/NewMessage";
import { faker as F } from "@faker-js/faker";
import { CreatedMessage } from "../generated/definitions/services/CreatedMessage";

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
    O.fromEither,
    O.bindTo("fixturesConfig"),
    O.bind("testFiscalCodes", () =>
      O.some(config.TEST_FISCAL_CODE as ReadonlyArray<FiscalCode>)
    ),
    O.bind("subscritionKeys", ({fixturesConfig}) => O.some([...fixturesConfig.SEND_MESSAGES_APIM_SUBSCRIPTION_KEYS] as Array<NonEmptyString>)),
    O.bind("messagesIOClient", ({ fixturesConfig }) =>
      O.some(
        createClient({
          basePath: "",
          baseUrl: fixturesConfig.SEND_MESSAGES_APIM_BASE_URL,
          fetchApi: fetch
        })
      )
    ),
    O.bind("generateProfiles", ({ testFiscalCodes }) =>
      pipe(
        testFiscalCodes,
        ROA.map((fiscalCode) =>
          pipe(
            TE.tryCatch(() => initNewLollipopKey(config)(fiscalCode), E.toError)
          )
        ),
        ROA.sequence(TE.ApplicativeSeq),
        O.some
      )
    ),
    O.bind("generateMessages", ({ messagesIOClient, testFiscalCodes, subscritionKeys }) =>
      pipe(
        testFiscalCodes,
        ROA.map(
          flow(
            (fiscalCode) => pipe(
              NAR.range(1, 10),
              (arr) => arr.map((num) => pipe(
                  ({message: generateTestMessage(fiscalCode, num), subKey: subscritionKeys.shift()}),
                  ({message, subKey}) =>
                    TE.tryCatch(
                      () =>
                        messagesIOClient.submitMessageforUserWithFiscalCodeInBody({
                          message,
                          SubscriptionKey: subKey as NonEmptyString
                        }),
                      E.toError
                    ),
                    TE.chain(
                      flow(
                        TE.fromEither,
                        TE.mapLeft((errs) => new Error(readableReportSimplified(errs)))
                      )
                    ),
                    TE.chain(
                      TE.fromPredicate(
                        (_): _ is r.IResponseType<201, CreatedMessage, never> =>
                          _.status === 201,
                        (res) => new Error(`Send Message num ${num}: [status ${res.status}]`)
                      )
                    ),
                    TE.chain((res) => TE.fromTask(T.delay(500)(T.of(res))))
                  )
                ),
              AR.sequence(TE.ApplicativeSeq),
              TE.map(responses => responses.length === 10),
            )
          )
        ),
        ROA.sequence(TE.ApplicativeSeq),
        O.some
      )
    ),
    O.map(({ generateMessages, generateProfiles }) =>
      pipe(
        generateProfiles,
        TE.chainW(() => generateMessages),
        TE.toUnion
      )
    ),
    O.getOrElseW(() => T.of(void 0))
  )
);

fixturesHandler().catch((err) => {
  console.error("Error executing the fixtures script: ", err);
  process.exit(1);
});
