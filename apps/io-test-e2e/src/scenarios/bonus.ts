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
  key: GeneratedKeypair,
  tokenChecker: (key: GeneratedKeypair) => Promise<string>
) => {
  const executeServicesApis = randomIntBetween(1, 100) < 41;
  if (executeServicesApis) {
    console.debug(`executeServicesApis`);
    // Get featured services
    // Peak 29k req/h
    const futuredServices = http.get(`${config.IO_BACKEND_BASE_URL}/api/v2/services/featured`, {
      ...await getK6DefaultHttpParams(key, tokenChecker)
    }
    );
    trackRequest({
      response: futuredServices,
      checkTitle: "GET featured services",
      successCounter: featuredServicesSuccess,
      failureCounter: featuredServicesFailure,
      durationTrend: featuredServicesDuration,
      successStatuses: [200],
      skipStatuses: [401]
    });


    // Get featured institutions
    // Peak 29k req/h
    const futuredInstitutions = http.get(`${config.IO_BACKEND_BASE_URL}/api/v2/institutions/featured`, {
      ...await getK6DefaultHttpParams(key, tokenChecker)
    });
    trackRequest({
      response: futuredInstitutions,
      checkTitle: "GET featured institutions",
      successCounter: featuredInstitutionsSuccess,
      failureCounter: featuredInstitutionsFailure,
      durationTrend: featuredInstitutionsDuration,
      successStatuses: [200],
      skipStatuses: [401]
    });

    // List institutions page 1
    // Peak 29k req/h
    const institutionsFirstPage = http.get(`${config.IO_BACKEND_BASE_URL}/api/v2/institutions?scope=NATIONAL&limit=10&offset=0`, {
      ...await getK6DefaultHttpParams(key, tokenChecker)
    });
    trackRequest({
      response: institutionsFirstPage,
      checkTitle: "GET institutions page 1",
      successCounter: institutionsPageOneSuccess,
      failureCounter: institutionsPageOneFailure,
      durationTrend: institutionsPageOneDuration,
      successStatuses: [200],
      skipStatuses: [401]
    });

    // List institutions page 2
    // Peak 17k req/h
    const executeIstitutionsSecondPage = randomIntBetween(1, 100) < 60;
    if (executeIstitutionsSecondPage) {
      const institutionsSecondPage = http.get(`${config.IO_BACKEND_BASE_URL}/api/v2/institutions?scope=NATIONAL&limit=10&offset=10`, {
        ...await getK6DefaultHttpParams(key, tokenChecker)
      });
      trackRequest({
        response: institutionsSecondPage,
        checkTitle: "GET institutions page 2",
        successCounter: institutionsPageTwoSuccess,
        failureCounter: institutionsPageTwoFailure,
        durationTrend: institutionsPageTwoDuration,
        successStatuses: [200],
        skipStatuses: [401]
      });
    }

    // Retrieve Bonus Elettrodomestici service
    // Estimated 29k req/h
    const getBonusService = http.get(
      `${config.IO_BACKEND_BASE_URL}/api/v2/services/01JSEAMB13Y8EE487F95F64H9W`,
      {
        ...await getK6DefaultHttpParams(key, tokenChecker)
      }
    );
    trackRequest({
      response: getBonusService,
      checkTitle: "GET Bonus Elettrodomestici Service",
      successCounter: bonusElettrodomesticiServiceSuccess,
      failureCounter: bonusElettrodomesticiServiceFailure,
      durationTrend: bonusElettrodomesticiServiceDuration,
      successStatuses: [200],
      skipStatuses: [401]
    });

    // Retrieve Bonus Elettrodomestici service preferences
    // Estimated 29k req/h
    const getBonusServicePreferences = http.get(
      `${config.IO_BACKEND_BASE_URL}/api/v1/services/01JSEAMB13Y8EE487F95F64H9W/preferences`,
      {
        ...await getK6DefaultHttpParams(key, tokenChecker)
      }
    );
    trackRequest({
      response: getBonusServicePreferences,
      checkTitle: "GET Bonus Elettrodomestici Service preferences",
      successCounter: bonusElettrodomesticiServicePreferencesSuccess,
      failureCounter: bonusElettrodomesticiServicePreferencesFailure,
      durationTrend: bonusElettrodomesticiServicePreferencesDuration,
      successStatuses: [200],
      skipStatuses: [401]
    });
  }
}
