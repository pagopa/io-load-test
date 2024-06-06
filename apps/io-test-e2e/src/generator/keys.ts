import { pipe } from "fp-ts/lib/function";
import { getConfigOrThrow } from "../utils/config";
import * as TE from "fp-ts/TaskEither";
import * as T from "fp-ts/Task";
import * as ROA from "fp-ts/lib/ReadonlyArray";
import { initNewLollipopKey } from "../utils/lollipop";
import * as E from "fp-ts/Either";
import { FiscalCode } from "@pagopa/ts-commons/lib/strings";

const config = getConfigOrThrow(process.env);

const generateTestData = () => {
  return pipe(
    config.TEST_FISCAL_CODE as ReadonlyArray<FiscalCode>,
    ROA.map((fiscalCode) =>
      pipe(TE.tryCatch(() => initNewLollipopKey(config)(fiscalCode), E.toError))
    ),
    ROA.sequence(T.ApplicativeSeq),
    T.map(ROA.rights),
    T.map((_) => {
      console.log(JSON.stringify(_));
    })
  )();
};

generateTestData().catch((err) => {
  console.error("Error executing the generator script: ", err);
  process.exit(1);
});
