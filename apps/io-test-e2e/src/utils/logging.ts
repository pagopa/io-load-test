import { pipe } from "fp-ts/lib/function";
import * as TE from "fp-ts/lib/TaskEither";

export const logTaskEither = (msg: string) => <E, O>(te: TE.TaskEither<E,O>) => pipe(
    te,
    TE.map(o => {
      console.log(msg);
      return o;
    })
  )