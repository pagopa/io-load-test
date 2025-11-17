import http, { ExpectedStatusesObject, RefinedParams } from "k6/http"
import { GeneratedKeypair } from "./lollipop"

export const getK6DefaultHttpParams = async (key: GeneratedKeypair, tokenChecker: (key: GeneratedKeypair) => Promise<string>, statuses?: Array<number | ExpectedStatusesObject>): Promise<RefinedParams<"text">> => {
  return {
    headers: {
      Authorization: `Bearer ${await tokenChecker(key)}`,
      "Content-Type": "application/json",
    },
    timeout: "12s",
    responseType: "text",
    responseCallback: statuses ? http.expectedStatuses(...statuses) : undefined
  }
}
