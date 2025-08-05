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
const bonusElettrodomesticiServiceDuration = new Trend("get_bonus_elettrodomestici_service");
const bonusElettrodomesticiServicePreferencesDuration = new Trend("get_bonus_elettrodomestici_service_preferences");

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
      "GET featured institutions returns 200": (r) => [200, 401].includes(r.status),
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

    // Retrieve Bonus Elettrodomestici service
    // Estimated 5,5k req/h
    const getBonusService = http.get(
      `${config.IO_BACKEND_BASE_URL}/api/v2/services/01JSEAMB13Y8EE487F95F64H9W`,
      {
        headers: {
          Authorization: `Bearer ${await tokenChecker(thumbprint)}`,
          "Content-Type": "application/json",
        },
        responseType: "text",
      }
    );
    check(getBonusService, {
      "GET Bonus Elettrodomestici Service returns 200": (r) => [200, 401].includes(r.status),
    });
    if (getBonusService.status !== 200){
      console.log(`GET Bonus Elettrodomestici Service returns an error => statusCode=${getBonusService.status}, detail=${getBonusService.body}`)
    }
    bonusElettrodomesticiServiceDuration.add(getBonusService.timings.duration);

    // Retrieve Bonus Elettrodomestici service preferences
    // Estimated 5,5k req/h
    const getBonusServicePreferences = http.get(
      `${config.IO_BACKEND_BASE_URL}/api/v1/services/01JSEAMB13Y8EE487F95F64H9W/preferences`,
      {
        headers: {
          Authorization: `Bearer ${await tokenChecker(thumbprint)}`,
          "Content-Type": "application/json",
        },
        responseType: "text",
      }
    );
    check(getBonusServicePreferences, {
      "GET Bonus Elettrodomestici Service preferences returns 200": (r) => [200, 401].includes(r.status),
    });
    if (getBonusServicePreferences.status !== 200){
      console.log(`GET Bonus Elettrodomestici Service preferences returns an error => statusCode=${getBonusServicePreferences.status}, detail=${getBonusServicePreferences.body}`)
    }
    bonusElettrodomesticiServicePreferencesDuration.add(getBonusServicePreferences.timings.duration);
  }
}
