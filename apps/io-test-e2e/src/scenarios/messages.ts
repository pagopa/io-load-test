//@ts-ignore
import { htmlReport } from "https://raw.githubusercontent.com/benc-uk/k6-reporter/main/dist/bundle.js";
//@ts-ignore
import { textSummary } from "https://jslib.k6.io/k6-summary/0.0.4/index.js";
import { check } from "k6";
import { Trend } from "k6/metrics";
import http from "k6/http";
import { NonEmptyString } from "@pagopa/ts-commons/lib/strings";
import { IConfig } from "../utils/config";
import * as E from "fp-ts/Either";
import * as O from "fp-ts/Option";
import { pipe } from "fp-ts/lib/function";
import { PaginatedPublicMessagesCollection } from "../generated/definitions/backend/PaginatedPublicMessagesCollection";
import { getResponseBodyAsType } from "../utils/responses";

const messagesDuration = new Trend("get_messages_duration");
const messageDetailDuration = new Trend("get_message_detail_duration");

export const messageListAndDetail = (
  config: IConfig,
  token: NonEmptyString
) => {
  // Retrieve users's messages
  const getFirstPageMessages = http.get(
    `${config.IO_BACKEND_BASE_URL}/api/v1/messages?page_size=10&enrich_result_data=true`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      responseType: "text",
    }
  );
  check(getFirstPageMessages, {
    "GET Users's first page messages returns 200": (r) => r.status === 200,
  });
  messagesDuration.add(getFirstPageMessages.timings.duration);

  // Fetch next messages page if present and fetch a message detail
  pipe(
    getResponseBodyAsType(
      getFirstPageMessages.body,
      PaginatedPublicMessagesCollection
    ),
    E.map((firstPageResponse) =>
      pipe(
        firstPageResponse.next,
        E.fromNullable(Error("Second page not present")),
        E.chain((minimumId) => {
          const getSecondPageMessages = http.get(
            `${config.IO_BACKEND_BASE_URL}/api/v1/messages?page_size=10&enrich_result_data=true&minimum_id=${minimumId}`,
            {
              headers: {
                Authorization: `Bearer ${token}`,
                "Content-Type": "application/json",
              },
              responseType: "text",
            }
          );
          check(getSecondPageMessages, {
            "GET Users's second page messages returns 200": (r) =>
              r.status === 200,
          });
          messagesDuration.add(getSecondPageMessages.timings.duration);

          return getResponseBodyAsType(
            getSecondPageMessages.body,
            PaginatedPublicMessagesCollection
          );
        }),
        E.map((res) => res.items[0]),
        E.getOrElseW(() => firstPageResponse.items[0])
      )
    ),
    E.map((msg) => msg.id),
    O.fromEither,
    O.map((messageId) => {
      const getMessageDetail = http.get(
        `${config.IO_BACKEND_BASE_URL}/api/v1/messages/${messageId}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          responseType: "text",
        }
      );
      check(getMessageDetail, {
        "GET Users's message detail returns 200": (r) => r.status === 200,
      });
      messageDetailDuration.add(getMessageDetail.timings.duration);
    }),
    O.toUndefined
  );
};
