import http from "k6/http";
import { IConfig } from "../utils/config";
import { check } from "k6";
// @ts-ignore
import { randomIntBetween } from "https://jslib.k6.io/k6-utils/1.2.0/index.js";
import { Trend } from "k6/metrics";

const featuredServicesDuration = new Trend("get_featured_services");
const featuredInstitutionsDuration = new Trend("get_featured_institutions");
const institutionsPageOneDuration = new Trend("get_institutions_page_1");
const institutionsPageTwoDuration = new Trend("get_institutions_page_2");

/* Function to handle user landing on the services section.
 */
export const loadingServicesAppTab = async (
  config: IConfig,
  thumbprint: string,
  tokenChecker: (thumbprint: string) => Promise<string>
) => {
  const executeServicesApis = randomIntBetween(1, 13) == 1;
  if (executeServicesApis) {
    console.log(`executeServicesApis`);
    // Get featured services
    // Peak 5.5k req/h
    const futuredServices = http.get(`${config.IO_BACKEND_BASE_URL}/api/v2/services/featured`, {
      headers: {
        Authorization: `Bearer ${await tokenChecker(thumbprint)}`,
        "Content-Type": "application/json",
      },
      responseType: "text",
    });
    check(futuredServices, {
      "GET featured services returns 200": (r) => [200, 401].includes(r.status),
    });
    featuredServicesDuration.add(futuredServices.timings.duration);

    // Get featured institutions
    // Peak 5.5k req/h
    const futuredInstitutions = http.get(`${config.IO_BACKEND_BASE_URL}/api/v2/institutions/featured`, {
      headers: {
        Authorization: `Bearer ${await tokenChecker(thumbprint)}`,
        "Content-Type": "application/json",
      },
      responseType: "text",
    });
    check(futuredInstitutions, {
      "GET featured services returns 200": (r) => [200, 401].includes(r.status),
    });
    featuredInstitutionsDuration.add(futuredInstitutions.timings.duration);

    // List institutions page 1
    // Peak 5.5k req/h
    const institutionsFirstPage = http.get(`${config.IO_BACKEND_BASE_URL}/api/v2/institutions?scope=NATIONAL&limit=10&offset=0`, {
      headers: {
        Authorization: `Bearer ${await tokenChecker(thumbprint)}`,
        "Content-Type": "application/json",
      },
      responseType: "text",
    });
    check(institutionsFirstPage, {
      "GET institutions page 1 returns 200": (r) => [200, 401].includes(r.status),
    });
    institutionsPageOneDuration.add(institutionsFirstPage.timings.duration);

    // List institutions page 2
    // Peak 2.9k req/h
    const institutionsSecondPage = http.get(`${config.IO_BACKEND_BASE_URL}/api/v2/institutions?scope=NATIONAL&limit=10&offset=10`, {
      headers: {
        Authorization: `Bearer ${await tokenChecker(thumbprint)}`,
        "Content-Type": "application/json",
      },
      responseType: "text",
    });
    check(institutionsSecondPage, {
      "GET institutions page 2 returns 200": (r) => [200, 401].includes(r.status),
    });
    institutionsPageTwoDuration.add(institutionsSecondPage.timings.duration);

    // TODO: Add APIs call to getService and getServicePreferences for the bonus elettrodomentici service
  }
}
