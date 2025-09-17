import http from "k6/http";
import { IConfig } from "../utils/config";
import { check } from "k6";
// @ts-ignore
import { randomIntBetween } from "https://jslib.k6.io/k6-utils/1.2.0/index.js";
import { Counter, Trend } from "k6/metrics";
import { getK6DefaultHttpParams } from "../utils/http";

const featuredServicesDuration = new Trend("get_featured_services");
const featuredServicesSuccess = new Counter("get_featured_services_success");
const featuredServicesFailure = new Counter("get_featured_services_failure");

const featuredInstitutionsDuration = new Trend("get_featured_institutions");
const featuredInstitutionsSuccess = new Counter("get_featured_institutions_success");
const featuredInstitutionsFailure = new Counter("get_featured_institutions_failure");

const institutionsPageOneDuration = new Trend("get_institutions_page_1");
const institutionsPageOneSuccess = new Counter("get_institutions_page_1_success");
const institutionsPageOneFailure = new Counter("get_institutions_page_1_failure");

const institutionsPageTwoDuration = new Trend("get_institutions_page_2");
const institutionsPageTwoSuccess = new Counter("get_institutions_page_2_success");
const institutionsPageTwoFailure = new Counter("get_institutions_page_2_failure");

const bonusElettrodomesticiServiceDuration = new Trend("get_bonus_elettrodomestici_service");
const bonusElettrodomesticiServiceSuccess = new Counter("get_bonus_elettrodomestici_service_success");
const bonusElettrodomesticiServiceFailure = new Counter("get_bonus_elettrodomestici_service_failure");

const bonusElettrodomesticiServicePreferencesDuration = new Trend("get_bonus_elettrodomestici_service_preferences");
const bonusElettrodomesticiServicePreferencesSuccess = new Counter("get_bonus_elettrodomestici_service_preferences_success");
const bonusElettrodomesticiServicePreferencesFailure = new Counter("get_bonus_elettrodomestici_service_preferences_failure");

/* Function to handle user landing on the services section.
 */
export const loadingServicesAppTab = async (
  config: IConfig,
  thumbprint: string,
  tokenChecker: (thumbprint: string) => Promise<string>
) => {
  const executeServicesApis = randomIntBetween(1, 100) < 41;
  if (executeServicesApis) {
    console.debug(`executeServicesApis`);
    // Get featured services
    // Peak 29k req/h
    const futuredServices = http.get(`${config.IO_BACKEND_BASE_URL}/api/v2/services/featured`, {
      ...await getK6DefaultHttpParams(thumbprint, tokenChecker)
    }
    );
    [200, 401].includes(futuredServices.status) ? featuredServicesSuccess.add(1) : featuredServicesFailure.add(1);
    check(futuredServices, {
      "GET featured services returns 200": (r) => [200, 401].includes(r.status),
    });
    featuredServicesDuration.add(futuredServices.timings.duration);


    // Get featured institutions
    // Peak 29k req/h
    const futuredInstitutions = http.get(`${config.IO_BACKEND_BASE_URL}/api/v2/institutions/featured`, {
      ...await getK6DefaultHttpParams(thumbprint, tokenChecker)
    });
    [200, 401].includes(futuredInstitutions.status) ? featuredInstitutionsSuccess.add(1) : featuredInstitutionsFailure.add(1);
    check(futuredInstitutions, {
      "GET featured institutions returns 200": (r) => [200, 401].includes(r.status),
    });
    featuredInstitutionsDuration.add(futuredInstitutions.timings.duration);

    // List institutions page 1
    // Peak 29k req/h
    const institutionsFirstPage = http.get(`${config.IO_BACKEND_BASE_URL}/api/v2/institutions?scope=NATIONAL&limit=10&offset=0`, {
      ...await getK6DefaultHttpParams(thumbprint, tokenChecker)
    });
    [200, 401].includes(institutionsFirstPage.status) ? institutionsPageOneSuccess.add(1) : institutionsPageOneFailure.add(1);
    check(institutionsFirstPage, {
      "GET institutions page 1 returns 200": (r) => [200, 401].includes(r.status),
    });
    institutionsPageOneDuration.add(institutionsFirstPage.timings.duration);

    // List institutions page 2
    // Peak 17k req/h
    const executeIstitutionsSecondPage = randomIntBetween(1, 100) < 60;
    if (executeIstitutionsSecondPage) {
      const institutionsSecondPage = http.get(`${config.IO_BACKEND_BASE_URL}/api/v2/institutions?scope=NATIONAL&limit=10&offset=10`, {
        ...await getK6DefaultHttpParams(thumbprint, tokenChecker)
      });
      [200, 401].includes(institutionsSecondPage.status) ? institutionsPageTwoSuccess.add(1) : institutionsPageTwoFailure.add(1);
      check(institutionsSecondPage, {
        "GET institutions page 2 returns 200": (r) => [200, 401].includes(r.status),
      });
      institutionsPageTwoDuration.add(institutionsSecondPage.timings.duration);
    }

    // Retrieve Bonus Elettrodomestici service
    // Estimated 29k req/h
    const getBonusService = http.get(
      `${config.IO_BACKEND_BASE_URL}/api/v2/services/01JSEAMB13Y8EE487F95F64H9W`,
      {
        ...await getK6DefaultHttpParams(thumbprint, tokenChecker)
      }
    );
    [200, 401].includes(getBonusService.status) ? bonusElettrodomesticiServiceSuccess.add(1) : bonusElettrodomesticiServiceFailure.add(1);
    check(getBonusService, {
      "GET Bonus Elettrodomestici Service returns 200": (r) => [200, 401].includes(r.status),
    });
    if (getBonusService.status !== 200){
      console.log(`GET Bonus Elettrodomestici Service returns an error => statusCode=${getBonusService.status}, detail=${getBonusService.body}`)
    }
    bonusElettrodomesticiServiceDuration.add(getBonusService.timings.duration);

    // Retrieve Bonus Elettrodomestici service preferences
    // Estimated 29k req/h
    const getBonusServicePreferences = http.get(
      `${config.IO_BACKEND_BASE_URL}/api/v1/services/01JSEAMB13Y8EE487F95F64H9W/preferences`,
      {
        ...await getK6DefaultHttpParams(thumbprint, tokenChecker)
      }
    );
    [200, 401].includes(getBonusServicePreferences.status) ? bonusElettrodomesticiServicePreferencesSuccess.add(1) : bonusElettrodomesticiServicePreferencesFailure.add(1);
    check(getBonusServicePreferences, {
      "GET Bonus Elettrodomestici Service preferences returns 200": (r) => [200, 401].includes(r.status),
    });
    if (getBonusServicePreferences.status !== 200){
      console.log(`GET Bonus Elettrodomestici Service preferences returns an error => statusCode=${getBonusServicePreferences.status}, detail=${getBonusServicePreferences.body}`)
    }
    bonusElettrodomesticiServicePreferencesDuration.add(getBonusServicePreferences.timings.duration);
  }
}
