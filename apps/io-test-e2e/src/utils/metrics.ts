import { identity, pipe } from "fp-ts/lib/function";
import * as E from "fp-ts/lib/Either";
import { Counter, Trend } from "k6/metrics";
import { check } from "k6";
import { RefinedResponse } from "k6/http";

type trackRequestParams = {
  response: RefinedResponse<"text">;
  successStatuses: number[];
  skipStatuses?: number[];
  successCounter: Counter,
  failureCounter: Counter;
  durationTrend: Trend;
  checkTitle: string
};

export const trackRequest = (params: trackRequestParams): void => {
  pipe(
    params.response.status,
    E.fromPredicate(status => params.successStatuses.includes(status), identity),
    E.map((status) => {
      params.successCounter.add(1);
      return status
    }),
    E.swap,
    E.map((status) => {
      console.log(`${params.checkTitle} returns an error => statusCode=${status}, detail=${params.response.body}`);
      return status
    }),
    E.chainW(E.fromPredicate(status => params.skipStatuses ? !params.skipStatuses.includes(status) : true, identity)),
    E.map((status) => {
      params.failureCounter.add(1);
      return status
    }),
    E.toUnion,
    () => check(params.response, { [params.checkTitle]: (r) => params.successStatuses.concat(params.skipStatuses || []).includes(r.status) }),
    () => params.durationTrend.add(params.response.timings.duration),
  );
}
