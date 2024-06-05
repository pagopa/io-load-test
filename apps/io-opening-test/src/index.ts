import { getConfigOrThrow } from "./utils/config";
//@ts-ignore
import { htmlReport } from "https://raw.githubusercontent.com/benc-uk/k6-reporter/main/dist/bundle.js";
//@ts-ignore
import { textSummary } from "https://jslib.k6.io/k6-summary/0.0.4/index.js";
import exec from "k6/execution";
import { SharedArray } from "k6/data";
import { GeneratedKeypair } from "./utils/lollipop";
import { lvScenario } from "./scenarios/lv";
import { check } from "k6";
import { Trend } from "k6/metrics";
import http from "k6/http";

const keys: ReadonlyArray<GeneratedKeypair> = new SharedArray(
  "keys",
  function() {
    // here you can open files, and then do additional processing or generate the array with data dynamically
    const f = JSON.parse(open("../data/keys.json"));
    return f; // f must be an array[]
  }
);

const config = getConfigOrThrow(__ENV);

export const options = {
  discardResponseBodies: true,
  scenarios: {
    contacts: {
      executor: "constant-arrival-rate",

      // How long the test lasts
      duration: config.duration,

      maxVUs: config.maxVUs,
      // How many iterations per timeUnit
      rate: config.rate,
      /**
       * AzureDiagnostics
        | where backendPoolName_s == "appbackend-app-address-pool"
        | where requestUri_s != "/pagopa/api/v1/user" and requestUri_s != "/bpd/api/v1/user" and httpStatus_d != 404
        | summarize requests = count() by clientIP_s, bin(TimeGenerated, 15m)
        | summarize count() by clientIP_s
        | summarize sum(count_)
       */

      // Start `rate` iterations per second
      timeUnit: "1s",

      // Pre-allocate VUs (concurrent users)
      preAllocatedVUs: keys.length,
    },
  },
};

const profileDuration = new Trend("get_profile_duration");
const messagesDuration = new Trend("get_messages_duration");

export default async function() {
  const token = lvScenario(config, exec.vu.idInInstance, keys);
  // Retrieve the profile using the new token
  const getProfile = http.get(`${config.IO_BACKEND_BASE_URL}/api/v1/profile`, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    responseType: "text",
  });
  check(getProfile, {
    "GET Profile returns 200": (r) => r.status === 200,
  });
  profileDuration.add(getProfile.timings.duration);

  // Retrieve users's messages
  const getMessages = http.get(`${config.IO_BACKEND_BASE_URL}/api/v1/messages?page_size=10&enrich_result_data=true`, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    responseType: "text",
  });
  check(getMessages, {
    "GET Users's messages returns 200": (r) => r.status === 200,
  });
  messagesDuration.add(getMessages.timings.duration);
}

export function handleSummary(data: unknown) {
  return {
    "./out/summary.html": htmlReport(data),
    "./out/summary.json": JSON.stringify(data),
    stdout: textSummary(data, { indent: " ", enableColors: true }),
  };
}
