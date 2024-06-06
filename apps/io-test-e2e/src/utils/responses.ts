import * as J from "fp-ts/Json";
import * as E from "fp-ts/Either";
import { flow, pipe } from "fp-ts/lib/function";
import * as t from "io-ts";
import { errorsToReadableMessages } from "@pagopa/ts-commons/lib/reporters";

export const getResponseBodyAsType = <S, A>(
  bodyText: string,
  type: t.Type<A, S>
): E.Either<Error, A> =>
  pipe(
    bodyText,
    J.parse,
    E.mapLeft(E.toError),
    E.chain(
      flow(
        type.decode,
        E.mapLeft((errs) => new Error(errorsToReadableMessages(errs).join("|")))
      )
    )
  );
