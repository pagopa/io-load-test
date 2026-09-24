import http, { RefinedResponse } from "k6/http";
import { IConfig } from "../utils/config";
// @ts-ignore
import { randomIntBetween } from "https://jslib.k6.io/k6-utils/1.2.0/index.js";
import { Counter, Trend } from "k6/metrics";
import { getK6DefaultHttpParams } from "../utils/http";
import { trackRequest } from "../utils/metrics";
import { GeneratedKeypair } from "../utils/lollipop";

const featuredServicesDuration = new Trend("get_featured_services");
const featuredServicesSuccess = new Counter("get_featured_services_success");
const featuredServicesFailure = new Counter("get_featured_services_failure");

const featuredInstitutionsDuration = new Trend("get_featured_institutions");
const featuredInstitutionsSuccess = new Counter(
  "get_featured_institutions_success"
);
const featuredInstitutionsFailure = new Counter(
  "get_featured_institutions_failure"
);

const institutionsPageOneDuration = new Trend("get_institutions_page_1");
const institutionsPageOneSuccess = new Counter(
  "get_institutions_page_1_success"
);
const institutionsPageOneFailure = new Counter(
  "get_institutions_page_1_failure"
);

const institutionsPageTwoDuration = new Trend("get_institutions_page_2");
const institutionsPageTwoSuccess = new Counter(
  "get_institutions_page_2_success"
);
const institutionsPageTwoFailure = new Counter(
  "get_institutions_page_2_failure"
);

const institutionsPageThreeDuration = new Trend("get_institutions_page_3");
const institutionsPageThreeSuccess = new Counter(
  "get_institutions_page_3_success"
);
const institutionsPageThreeFailure = new Counter(
  "get_institutions_page_3_failure"
);

const bonusElettrodomesticiServiceDuration = new Trend(
  "get_bonus_elettrodomestici_service"
);
const bonusElettrodomesticiServiceSuccess = new Counter(
  "get_bonus_elettrodomestici_service_success"
);
const bonusElettrodomesticiServiceFailure = new Counter(
  "get_bonus_elettrodomestici_service_failure"
);
const servicesWallDuration = new Trend("services_scenario_duration");

/* Function to handle user landing on the services section.
 */
export const loadingOnlyServicesAppTab = async ({
  config,
  token
}: {
  config: IConfig;
  key: GeneratedKeypair;
  token: string;
}) => {
  // Base rate of executing this flow is 9.2k req/h
  // Use SERVICES_BASE_RATE_PERCENTAGE env to control the execution rate of this flow
  // in combination with other flows during load testing.
  const executeServicesApis = randomIntBetween(1, 100);
  if (executeServicesApis > config.SERVICES_BASE_RATE_PERCENTAGE) {
    return;
  }

  const scenarioStartedAt = Date.now();
  const defaultParams = getK6DefaultHttpParams(token);
  const executeIstitutionsSecondPage = randomIntBetween(1, 100) < 47;
  const executeIstitutionsThirdPage = randomIntBetween(1, 100) < 32;

  const landingRequests = [
    {
      method: "GET" as const,
      url: `${config.IO_BACKEND_BASE_URL}/api/catalog/v1/services/featured`,
      params: defaultParams,
    },
    {
      method: "GET" as const,
      url: `${config.IO_BACKEND_BASE_URL}/api/catalog/v1/institutions/featured`,
      params: defaultParams,
    },
    {
      method: "GET" as const,
      url: `${config.IO_BACKEND_BASE_URL}/api/catalog/v1/institutions?scope=NATIONAL&limit=10&offset=0`,
      params: defaultParams,
    },
  ];

  if (executeIstitutionsSecondPage) {
    landingRequests.push({
      method: "GET" as const,
      url: `${config.IO_BACKEND_BASE_URL}/api/catalog/v1/institutions?scope=NATIONAL&limit=10&offset=10`,
      params: defaultParams,
    });
  }

  if (executeIstitutionsThirdPage) {
    landingRequests.push({
      method: "GET" as const,
      url: `${config.IO_BACKEND_BASE_URL}/api/catalog/v1/institutions?scope=NATIONAL&limit=10&offset=20`,
      params: defaultParams,
    });
  }

  const landingResponses = await Promise.all(
    landingRequests.map((request) =>
      http.asyncRequest(request.method, request.url, null, request.params)
    )
  );

  const [
    futuredServices,
    futuredInstitutions,
    institutionsFirstPage,
    ...optionalPages
  ] = landingResponses;

  trackRequest({
    response: futuredServices as RefinedResponse<"text">,
    checkTitle: "GET featured services",
    successCounter: featuredServicesSuccess,
    failureCounter: featuredServicesFailure,
    durationTrend: featuredServicesDuration,
    successStatuses: [200],
    skipStatuses: [401],
  });

  trackRequest({
    response: futuredInstitutions as RefinedResponse<"text">,
    checkTitle: "GET featured institutions",
    successCounter: featuredInstitutionsSuccess,
    failureCounter: featuredInstitutionsFailure,
    durationTrend: featuredInstitutionsDuration,
    successStatuses: [200],
    skipStatuses: [401],
  });

  trackRequest({
    response: institutionsFirstPage as RefinedResponse<"text">,
    checkTitle: "GET institutions page 1",
    successCounter: institutionsPageOneSuccess,
    failureCounter: institutionsPageOneFailure,
    durationTrend: institutionsPageOneDuration,
    successStatuses: [200],
    skipStatuses: [401],
  });

  let optionalIndex = 0;
  if (executeIstitutionsSecondPage) {
    trackRequest({
      response: optionalPages[optionalIndex] as RefinedResponse<"text">,
      checkTitle: "GET institutions page 2",
      successCounter: institutionsPageTwoSuccess,
      failureCounter: institutionsPageTwoFailure,
      durationTrend: institutionsPageTwoDuration,
      successStatuses: [200],
      skipStatuses: [401],
    });
    optionalIndex += 1;
  }

  if (executeIstitutionsThirdPage) {
    trackRequest({
      response: optionalPages[optionalIndex] as RefinedResponse<"text">,
      checkTitle: "GET institutions page 3",
      successCounter: institutionsPageThreeSuccess,
      failureCounter: institutionsPageThreeFailure,
      durationTrend: institutionsPageThreeDuration,
      successStatuses: [200],
      skipStatuses: [401],
    });
  }

  // Retrieve services detail in parallel via http.batch (10 requests) to reach
  // a 10x ratio over the base APIs for a comulative rate of 96k req/h.
  // A set of service IDs is used to avoid overloading
  // the database with a single key and causing hot partitioning.
  // Request counts are proportioned according to real traffic rates:
  // - 01EWZ58ZJ3FM3PTPYV6VTGG47S (29k req/h): 5 requests (50%)
  // - 01HD63674XJ1R6XCNHH24PCRR2 (16k req/h): 2 requests (20%)
  // - 01DBJNW5NR2M2VQTM7VG0SGNNZ (12k req/h): 2 requests (20%)
  // - 01G40DWQGKY5GRWSNM4303VNRP (4k req/h):  1 request  (10%)
  const serviceRequests = [
    "01EWZ58ZJ3FM3PTPYV6VTGG47S",
    "01EWZ58ZJ3FM3PTPYV6VTGG47S",
    "01EWZ58ZJ3FM3PTPYV6VTGG47S",
    "01EWZ58ZJ3FM3PTPYV6VTGG47S",
    "01EWZ58ZJ3FM3PTPYV6VTGG47S",
    "01HD63674XJ1R6XCNHH24PCRR2",
    "01HD63674XJ1R6XCNHH24PCRR2",
    "01DBJNW5NR2M2VQTM7VG0SGNNZ",
    "01DBJNW5NR2M2VQTM7VG0SGNNZ",
    "01G40DWQGKY5GRWSNM4303VNRP",
  ].map((serviceId) => ({
    method: "GET" as const,
    url: `${config.IO_BACKEND_BASE_URL}/api/catalog/v1/services/${serviceId}`,
    params: defaultParams,
  }));

  const bonusServicesResponses = await Promise.all(
    serviceRequests.map((request) =>
      http.asyncRequest(request.method, request.url, null, request.params)
    )
  );

  bonusServicesResponses.forEach((res) => {
    trackRequest({
      response: res as RefinedResponse<"text">,
      checkTitle: "GET Service",
      successCounter: bonusElettrodomesticiServiceSuccess,
      failureCounter: bonusElettrodomesticiServiceFailure,
      durationTrend: bonusElettrodomesticiServiceDuration,
      successStatuses: [200],
      skipStatuses: [401],
    });
  });
  servicesWallDuration.add(Date.now() - scenarioStartedAt);
};
