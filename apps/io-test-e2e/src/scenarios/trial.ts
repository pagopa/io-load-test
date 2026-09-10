//@ts-ignore
import { htmlReport } from "https://raw.githubusercontent.com/benc-uk/k6-reporter/main/dist/bundle.js";
//@ts-ignore
import { textSummary } from "https://jslib.k6.io/k6-summary/0.0.4/index.js";
import { check } from "k6";
import { Trend } from "k6/metrics";
import http from "k6/http";
import { IConfig } from "../utils/config";
import { GeneratedKeypair } from "../utils/lollipop";
import { getK6DefaultHttpParams } from "../utils/http";

const createSubscriptionDuration = new Trend("post_subscription_duration");
const getSubscriptionDuration = new Trend("get_subscription_duration");

export const trialSubscription = async ({
  config,
  token
}: {
  config: IConfig;
  key: GeneratedKeypair;
  token: string;
}) => {
  const defaultParams = getK6DefaultHttpParams(token, { responseType: "text" });
  // Create a trial subscription
  const createSubscription = http.post(
    `${config.IO_BACKEND_BASE_URL}/api/v1/trials/trialId/subscriptions`,
    {},
    {
      ...defaultParams,
      headers: {
        ...defaultParams.headers,
        Accept: "*/*",
      },
    }
  );
  check(createSubscription, {
    "POST Trials subscription returns 201 or 202": (r) =>
      r.status === 201 || r.status === 202,
  });
  createSubscriptionDuration.add(createSubscription.timings.duration);

  // Retrieve users's Trial Subscription
  const getSubscription = http.get(
    `${config.IO_BACKEND_BASE_URL}/api/v1/trials/trialId/subscriptions`,
    defaultParams
  );
  check(getSubscription, {
    "GET Users's Trial subscription returns 200": (r) => r.status === 200,
  });
  getSubscriptionDuration.add(getSubscription.timings.duration);
};
