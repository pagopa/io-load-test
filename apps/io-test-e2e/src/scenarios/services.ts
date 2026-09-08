import http from "k6/http";
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

/* Function to handle user landing on the services section.
 */
export const loadingOnlyServicesAppTab = async ({
  config,
  key,
  tokenChecker
}: {
  config: IConfig;
  key: GeneratedKeypair;
  tokenChecker: (key: GeneratedKeypair) => Promise<string>;
}) => {
  // Base rate of executing this flow is 9.2k req/h
  // Use SERVICES_BASE_RATE_PERCENTAGE env to control the execution rate of this flow
  // in combination with other flows during load testing.
  const executeServicesApis = randomIntBetween(1, 100);
  if (executeServicesApis <= config.SERVICES_BASE_RATE_PERCENTAGE) {
    console.debug(`executeServicesApis`);

    // Obtain default HTTP parameters once since the initial three requests
    // are executed concurrently via http.batch immediately after obtaining the parameters.
    const defaultParams = await getK6DefaultHttpParams(key, tokenChecker);

    // Concurrent execution via http.batch for initial landing requests:
    // - Featured services (Peak 9.2k req/h)
    // - Featured institutions (Peak 9.2k req/h)
    // - List institutions page 1 (Peak 9.2k req/h)
    const [futuredServices, futuredInstitutions, institutionsFirstPage] =
      http.batch([
        // Get featured services
        // Peak 9.2k req/h
        {
          method: "GET",
          url: `${config.IO_BACKEND_BASE_URL}/api/catalog/v1/services/featured`,
          params: defaultParams,
        },
        // Get featured institutions
        // Peak 9.2k req/h
        {
          method: "GET",
          url: `${config.IO_BACKEND_BASE_URL}/api/catalog/v1/institutions/featured`,
          params: defaultParams,
        },
        // List institutions page 1
        // Peak 9.2k req/h
        {
          method: "GET",
          url: `${config.IO_BACKEND_BASE_URL}/api/catalog/v1/institutions?scope=NATIONAL&limit=10&offset=0`,
          params: defaultParams,
        },
      ]);

    trackRequest({
      response: futuredServices,
      checkTitle: "GET featured services",
      successCounter: featuredServicesSuccess,
      failureCounter: featuredServicesFailure,
      durationTrend: featuredServicesDuration,
      successStatuses: [200],
      skipStatuses: [401],
    });

    trackRequest({
      response: futuredInstitutions,
      checkTitle: "GET featured institutions",
      successCounter: featuredInstitutionsSuccess,
      failureCounter: featuredInstitutionsFailure,
      durationTrend: featuredInstitutionsDuration,
      successStatuses: [200],
      skipStatuses: [401],
    });

    trackRequest({
      response: institutionsFirstPage,
      checkTitle: "GET institutions page 1",
      successCounter: institutionsPageOneSuccess,
      failureCounter: institutionsPageOneFailure,
      durationTrend: institutionsPageOneDuration,
      successStatuses: [200],
      skipStatuses: [401],
    });

    // List institutions page 2
    // Peak 4.4k req/h
    const executeIstitutionsSecondPage = randomIntBetween(1, 100) < 47;
    if (executeIstitutionsSecondPage) {
      const institutionsSecondPage = http.get(
        `${config.IO_BACKEND_BASE_URL}/api/catalog/v1/institutions?scope=NATIONAL&limit=10&offset=10`,
        {
          ...(await getK6DefaultHttpParams(key, tokenChecker)),
        }
      );
      trackRequest({
        response: institutionsSecondPage,
        checkTitle: "GET institutions page 2",
        successCounter: institutionsPageTwoSuccess,
        failureCounter: institutionsPageTwoFailure,
        durationTrend: institutionsPageTwoDuration,
        successStatuses: [200],
        skipStatuses: [401],
      });
    }

    // List institutions page 3
    // Peak 3k req/h
    const executeIstitutionsThirdPage = randomIntBetween(1, 100) < 32;
    if (executeIstitutionsThirdPage) {
      const institutionsThirdPage = http.get(
        `${config.IO_BACKEND_BASE_URL}/api/catalog/v1/institutions?scope=NATIONAL&limit=10&offset=20`,
        {
          ...(await getK6DefaultHttpParams(key, tokenChecker)),
        }
      );
      trackRequest({
        response: institutionsThirdPage,
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
    const serviceBatchParams = await getK6DefaultHttpParams(key, tokenChecker);

    const serviceRequests = [
      // 01EWZ58ZJ3FM3PTPYV6VTGG47S - 29k req/h (5 requests)
      {
        method: "GET" as const,
        url: `${config.IO_BACKEND_BASE_URL}/api/catalog/v1/services/01EWZ58ZJ3FM3PTPYV6VTGG47S`,
        params: serviceBatchParams,
      },
      {
        method: "GET" as const,
        url: `${config.IO_BACKEND_BASE_URL}/api/catalog/v1/services/01EWZ58ZJ3FM3PTPYV6VTGG47S`,
        params: serviceBatchParams,
      },
      {
        method: "GET" as const,
        url: `${config.IO_BACKEND_BASE_URL}/api/catalog/v1/services/01EWZ58ZJ3FM3PTPYV6VTGG47S`,
        params: serviceBatchParams,
      },
      {
        method: "GET" as const,
        url: `${config.IO_BACKEND_BASE_URL}/api/catalog/v1/services/01EWZ58ZJ3FM3PTPYV6VTGG47S`,
        params: serviceBatchParams,
      },
      {
        method: "GET" as const,
        url: `${config.IO_BACKEND_BASE_URL}/api/catalog/v1/services/01EWZ58ZJ3FM3PTPYV6VTGG47S`,
        params: serviceBatchParams,
      },
      // 01HD63674XJ1R6XCNHH24PCRR2 - 16k req/h (2 requests)
      {
        method: "GET" as const,
        url: `${config.IO_BACKEND_BASE_URL}/api/catalog/v1/services/01HD63674XJ1R6XCNHH24PCRR2`,
        params: serviceBatchParams,
      },
      {
        method: "GET" as const,
        url: `${config.IO_BACKEND_BASE_URL}/api/catalog/v1/services/01HD63674XJ1R6XCNHH24PCRR2`,
        params: serviceBatchParams,
      },
      // 01DBJNW5NR2M2VQTM7VG0SGNNZ - 12k req/h (2 requests)
      {
        method: "GET" as const,
        url: `${config.IO_BACKEND_BASE_URL}/api/catalog/v1/services/01DBJNW5NR2M2VQTM7VG0SGNNZ`,
        params: serviceBatchParams,
      },
      {
        method: "GET" as const,
        url: `${config.IO_BACKEND_BASE_URL}/api/catalog/v1/services/01DBJNW5NR2M2VQTM7VG0SGNNZ`,
        params: serviceBatchParams,
      },
      // 01G40DWQGKY5GRWSNM4303VNRP - 4k req/h (1 request)
      {
        method: "GET" as const,
        url: `${config.IO_BACKEND_BASE_URL}/api/catalog/v1/services/01G40DWQGKY5GRWSNM4303VNRP`,
        params: serviceBatchParams,
      },
    ];

    const bonusServicesResponses = http.batch(serviceRequests);

    bonusServicesResponses.forEach((res) => {
      trackRequest({
        response: res,
        checkTitle: "GET Service",
        successCounter: bonusElettrodomesticiServiceSuccess,
        failureCounter: bonusElettrodomesticiServiceFailure,
        durationTrend: bonusElettrodomesticiServiceDuration,
        successStatuses: [200],
        skipStatuses: [401],
      });
    });
  }
};
