// @ts-ignore
import { randomIntBetween } from "https://jslib.k6.io/k6-utils/1.2.0/index.js";
import { Trend, Counter } from "k6/metrics";
import http, { RefinedResponse } from "k6/http";
import { getK6DefaultHttpParams } from "../utils/http";
import { trackRequest } from "../utils/metrics";
import { FeatureScenarioParams } from "../types/scenario";

const getCgnStatusDuration = new Trend("get_cgn_status");
const getCgnStatusSuccess = new Counter("get_cgn_status_success");
const getCgnStatusFailure = new Counter("get_cgn_status_failure");
const cgnWallDuration = new Trend("cgn_scenario_duration");

export const loadingCgnDataPortfolioTab = async ({
  config,
  token
}: FeatureScenarioParams) => {
  const executeCgnApi = randomIntBetween(1, 100) < 41;
  if (!executeCgnApi) {
    return;
  }
  const scenarioStartedAt = Date.now();
  // Get CGN status
  // Peak 29k req/h
  const getCgnStatus = await http.asyncRequest(
    "GET",
    `${config.IO_BACKEND_BASE_URL}/api/cgn-card/v1/status`,
    null,
    getK6DefaultHttpParams(token)
  );
  trackRequest({
    response: getCgnStatus as RefinedResponse<"text">,
    checkTitle: "GET CGN status",
    successCounter: getCgnStatusSuccess,
    failureCounter: getCgnStatusFailure,
    durationTrend: getCgnStatusDuration,
    successStatuses: [200, 404],
    skipStatuses: [401]
  });
  cgnWallDuration.add(Date.now() - scenarioStartedAt);
};

