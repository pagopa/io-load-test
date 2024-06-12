//@ts-ignore
import { htmlReport } from "https://raw.githubusercontent.com/benc-uk/k6-reporter/main/dist/bundle.js";
//@ts-ignore
import { textSummary } from "https://jslib.k6.io/k6-summary/0.0.4/index.js";
import { check } from "k6";
import { Trend } from "k6/metrics";
import http from "k6/http";
import { IConfig } from "../utils/config";

const sessionDuration = new Trend("get_session_duration");
const profileDuration = new Trend("get_profile_duration");
const messagesDuration = new Trend("get_opening_messages_duration");

export const appOpening = async (
  config: IConfig,
  thumbprint: string,
  tokenChecker: (thumbprint: string) => Promise<string>
) => {
  // Retrieve the session using the new token
  const getSession = http.get(
    `${config.AUTH_BACKEND_BASE_URL}/api/v1/session`,
    {
      headers: {
        Authorization: `Bearer ${await tokenChecker(thumbprint)}`,
        "Content-Type": "application/json",
      },
      responseType: "text",
    }
  );
  check(getSession, {
    "GET Get Session returns 200": (r) => [200, 401].includes(r.status),
  });
  if (getSession.status !== 200){
    console.log(`Get Session returns an error => statusCode=${getSession.status}, detail=${getSession.body}`)
  }
  sessionDuration.add(getSession.timings.duration);

  // Retrieve the profile using the new token
  const getProfile = http.get(`${config.IO_BACKEND_BASE_URL}/api/v1/profile`, {
    headers: {
      Authorization: `Bearer ${await tokenChecker(thumbprint)}`,
      "Content-Type": "application/json",
    },
    responseType: "text",
  });
  check(getProfile, {
    "GET Profile returns 200": (r) => [200, 401].includes(r.status),
  });
  if (getProfile.status !== 200){
    console.log(`Get Profile returns an error => statusCode=${getProfile.status}, detail=${getProfile.body}`)
  }
  profileDuration.add(getProfile.timings.duration);

  // Retrieve users's messages
  const getMessages = http.get(
    `${config.IO_BACKEND_BASE_URL}/api/v1/messages?page_size=10&enrich_result_data=true`,
    {
      headers: {
        Authorization: `Bearer ${await tokenChecker(thumbprint)}`,
        "Content-Type": "application/json",
      },
      responseType: "text",
    }
  );
  check(getMessages, {
    "GET Users's messages returns 200": (r) => [200, 401].includes(r.status),
  });
  if (getMessages.status !== 200){
    console.log(`Get Messages returns an error => statusCode=${getMessages.status}, detail=${getMessages.body}`)
  }
  messagesDuration.add(getMessages.timings.duration);
};
