import http, { RefinedParams, ResponseType } from "k6/http";

export type HttpParams = RefinedParams<ResponseType>;

export const getK6DefaultHttpParams = (
  token: string,
  options?: {
    responseType?: ResponseType;
    timeout?: string;
  }
): HttpParams => ({
  headers: {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  },
  timeout: options?.timeout ?? "12s",
  responseType: options?.responseType ?? "none",
  // 401/404 are expected on some IO endpoints (no CGN card, no wallet
  // instance, skipped session). Do not count them as http_req_failed.
  responseCallback: http.expectedStatuses({ min: 200, max: 399 }, 401, 404),
});
