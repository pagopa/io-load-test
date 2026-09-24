import { check } from "k6";
import { Trend } from "k6/metrics";
import http from "k6/http";
import { IConfig } from "../utils/config";
import * as E from "fp-ts/Either";
import * as TE from "fp-ts/TaskEither";
import { pipe } from "fp-ts/lib/function";
import { PaginatedPublicMessagesCollection } from "../generated/definitions/messages/PaginatedPublicMessagesCollection";
import { getResponseBodyAsType } from "../utils/responses";
import { getK6DefaultHttpParams } from "../utils/http";
import { GeneratedKeypair } from "../utils/lollipop";

const messagesDuration = new Trend("get_messages_duration");
const messageDetailDuration = new Trend("get_message_detail_duration");

export const messageListAndDetail = async ({
  config,
  token
}: {
  config: IConfig;
  key: GeneratedKeypair;
  token: string;
}) => {
  const defaultParams = getK6DefaultHttpParams(token, { responseType: "text" });
  const getFirstPageMessages = http.get(
    `${config.IO_BACKEND_BASE_URL}/api/communication/v1/messages?page_size=10&enrich_result_data=true`,
    defaultParams
  );
  check(getFirstPageMessages, {
    "GET Users's first page messages returns 200": (r) => r.status === 200,
  });
  messagesDuration.add(getFirstPageMessages.timings.duration);

  await pipe(
    getResponseBodyAsType(
      String(getFirstPageMessages.body || ""),
      PaginatedPublicMessagesCollection
    ),
    TE.fromEither,
    TE.chainW((firstPageResponse) =>
      pipe(
        firstPageResponse.next,
        E.fromNullable(Error("Second page not present")),
        TE.fromEither,
        TE.map((minimumId) => {
          const getSecondPageMessages = http.get(
            `${config.IO_BACKEND_BASE_URL}/api/communication/v1/messages?page_size=10&enrich_result_data=true&minimum_id=${minimumId}`,
            defaultParams
          );
          check(getSecondPageMessages, {
            "GET Users's second page messages returns 200": (r) =>
              r.status === 200,
          });
          messagesDuration.add(getSecondPageMessages.timings.duration);

          return getResponseBodyAsType(
            String(getSecondPageMessages.body || ""),
            PaginatedPublicMessagesCollection
          );
        }),
        TE.chain(TE.fromEither),
        TE.map((res) => res.items[0]),
        TE.orElse(() => TE.of(firstPageResponse.items[0]))
      )
    ),
    TE.chain((msg) =>
      pipe(
        msg,
        E.fromNullable(new Error("No messages available")),
        TE.fromEither
      )
    ),
    TE.map((msg) => {
      const getMessageDetail = http.get(
        `${config.IO_BACKEND_BASE_URL}/api/communication/v1/messages/${msg.id}`,
        defaultParams
      );
      check(getMessageDetail, {
        "GET Users's message detail returns 200": (r) => r.status === 200,
      });
      messageDetailDuration.add(getMessageDetail.timings.duration);
    })
  )();
};
