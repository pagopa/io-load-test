import { RefinedParams, ResponseType } from "k6/http";

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
});
