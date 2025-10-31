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
  const chunkSize = 20;
  return pipe(
    config.TEST_FISCAL_CODE as ReadonlyArray<FiscalCode>,
    ROA.chunksOf(chunkSize),
    ROA.map(chunk =>
      pipe(
        chunk,
        ROA.map(fiscalCode =>
          pipe(TE.tryCatch(() => initNewLollipopKey(config)(fiscalCode), E.toError))
        ),
        ROA.sequence(T.ApplicativePar), // parallel execution within the chunk
        T.map(ROA.rights)
      )
    ),
    ROA.sequence(T.ApplicativeSeq), // sequential execution of chunks
    T.map(chunks => chunks.flat()),
    T.map(results => {
      console.log(JSON.stringify(results.map(r => r.keyPair)));
    })
  )();
};

generateTestData().catch((err) => {
  console.error("Error executing the generator script: ", err);
  process.exit(1);
});
