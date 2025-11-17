import { IConfig } from "../utils/config";
import { GeneratedKeypair } from "../utils/lollipop";
// @ts-ignore
import { randomIntBetween } from "https://jslib.k6.io/k6-utils/1.2.0/index.js";
import { Trend, Counter } from "k6/metrics";
import http from "k6/http";
import { getK6DefaultHttpParams } from "../utils/http";
import { trackRequest } from "../utils/metrics";

const getCgnStatusDuration = new Trend("get_cgn_status");
const getCgnStatusSuccess = new Counter("get_cgn_status_success");
const getCgnStatusFailure = new Counter("get_cgn_status_failure");


export const loadingCgnDataPortfolioTab = async ({
  config,
  key,
  tokenChecker
}: {
  config: IConfig;
  key: GeneratedKeypair;
  tokenChecker: (key: GeneratedKeypair) => Promise<string>;
}) => {
  const executeCgnApi = randomIntBetween(1, 100) < 41;
  if (executeCgnApi) {
    console.debug(`executeCgnApi`);
    // Get CGN status
    // Peak 29k req/h
    const getCgnStatus = http.get(`${config.IO_BACKEND_BASE_URL}/api/v1/cgn/status`, {
      ...await getK6DefaultHttpParams(key, tokenChecker)
    });
    trackRequest({
      response: getCgnStatus,
      checkTitle: "GET CGN status",
      successCounter: getCgnStatusSuccess,
      failureCounter: getCgnStatusFailure,
      durationTrend: getCgnStatusDuration,
      successStatuses: [200, 404],
      skipStatuses: [401]
    });
  }
};

