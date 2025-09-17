import http, { ExpectedStatusesObject, RefinedParams } from "k6/http"

export const getK6DefaultHttpParams = async (thumbprint: string, tokenChecker: (thumbprint: string) => Promise<string>, statuses?: Array<number | ExpectedStatusesObject>): Promise<RefinedParams<"text">> => {
  return {
    headers: {
      Authorization: `Bearer ${await tokenChecker(thumbprint)}`,
      "Content-Type": "application/json",
    },
    timeout: "12s",
    responseType: "text",
    responseCallback: statuses ? http.expectedStatuses(...statuses) : undefined
  }
}
