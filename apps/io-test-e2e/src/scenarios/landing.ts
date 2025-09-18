//@ts-ignore
import { htmlReport } from "https://raw.githubusercontent.com/benc-uk/k6-reporter/main/dist/bundle.js";
//@ts-ignore
import { textSummary } from "https://jslib.k6.io/k6-summary/0.0.4/index.js";
// @ts-ignore
import { randomIntBetween } from "https://jslib.k6.io/k6-utils/1.2.0/index.js";
import { check } from "k6";
import { Counter, Trend } from "k6/metrics";
import http from "k6/http";
import { IConfig } from "../utils/config";
import { getK6DefaultHttpParams } from "../utils/http";
import { trackRequest } from "../utils/metrics";
import { GeneratedKeypair } from "../utils/lollipop";

const pingDuration = new Trend("get_ping_duration");
const pingFailure = new Counter("get_ping_failure");
const pingSuccess = new Counter("get_ping_duration_success");
const sessionDuration = new Trend("get_session_duration");
const sessionFailure = new Counter("get_session_failure");
const sessionSuccess = new Counter("get_session_success");
const profileDuration = new Trend("get_profile_duration");
const profileFailure = new Counter("get_profile_failure");
const profileSuccess = new Counter("get_profile_success");
const userDataProcessingDuration = new Trend("get_user_data_processing_duration");
const userDataProcessingFailure = new Counter("get_user_data_processing_failure");
const userDataProcessingSuccess = new Counter("get_user_data_processing_success");
const fiscalCodeWhitelistDuration = new Trend("get_fiscal_code_whitelist_duration");
const fiscalCodeWhitelistFailure = new Counter("get_fiscal_code_whitelist_failure");
const fiscalCodeWhitelistSuccess = new Counter("get_fiscal_code_whitelist_success");
const walletInstanceStatusDuration = new Trend("get_wallet_instance_status_duration");
const walletInstanceStatusFailure = new Counter("get_wallet_instance_status_failure");
const walletInstanceStatusSuccess = new Counter("get_wallet_instance_status_success");
const sendActivationStatusDuration = new Trend("get_send_activation_status");
const sendActivationStatusFailure = new Counter("get_send_activation_failure");
const sendActivationStatusSuccess = new Counter("get_send_activation_success");
const messagesDuration = new Trend("get_opening_messages_duration");
const messagesFailure = new Counter("get_opening_messages_failure");
const messagesSuccess = new Counter("get_opening_messages_success");

export const appOpening = async (
  config: IConfig,
  key: GeneratedKeypair,
  tokenChecker: (key: GeneratedKeypair) => Promise<string>
) => {
  // Check if App is online
  // Peak 650k req/h
  const isOnline = http.get(`${config.IO_BACKEND_BASE_URL}/api/v1/ping`);
  trackRequest({
    response: isOnline,
    checkTitle: "GET Status",
    successCounter: pingSuccess,
    failureCounter: pingFailure,
    durationTrend: pingDuration,
    successStatuses: [204],
  });

  // Retrieve the session using the new token
  // Peak 115k req/h
  const getSession = http.get(
    `${config.AUTH_BACKEND_BASE_URL}/api/v1/session`,
    {
      ...await getK6DefaultHttpParams(key, tokenChecker)
    }
  );
  trackRequest({
    response: getSession,
    checkTitle: "GET Get Session",
    successCounter: sessionSuccess,
    failureCounter: sessionFailure,
    durationTrend: sessionDuration,
    successStatuses: [200],
    skipStatuses: [401]
  });
  const executeSecondGetSession = randomIntBetween(1, 10) < 6;
  if(executeSecondGetSession){
    const getSession2 = http.get(
      `${config.AUTH_BACKEND_BASE_URL}/api/v1/session`,
      {
        ...await getK6DefaultHttpParams(key, tokenChecker)
      }
    );
    trackRequest({
      response: getSession2,
      checkTitle: "GET Get Session",
      successCounter: sessionSuccess,
      failureCounter: sessionFailure,
      durationTrend: sessionDuration,
      successStatuses: [200],
      skipStatuses: [401]
    });
  }

  // Retrieve the profile using the new token
  // Peak 70k req/h
  const getProfile = http.get(`${config.IO_BACKEND_BASE_URL}/api/v1/profile`, {
    ...await getK6DefaultHttpParams(key, tokenChecker)
  });
  trackRequest({
    response: getProfile,
    checkTitle: "GET Profile",
    successCounter: profileSuccess,
    failureCounter: profileFailure,
    durationTrend: profileDuration,
    successStatuses: [200],
    skipStatuses: [401]
  });

  // Service preferences require a non Legacy service preferences mode
  // if the current profile is detected to use Legacy mode it will be updated to AUTO mode
  const profile = JSON.parse(getProfile.body);
  if (profile.service_preferences_settings && profile.service_preferences_settings.mode == "LEGACY") {
    console.error(`Legacy mode detected for `, profile.fiscal_code);
    const upsertProfile = http.post(`${config.IO_BACKEND_BASE_URL}/api/v1/profile`,JSON.stringify({...profile, service_preferences_settings: {mode: "AUTO"}}), {
      ...await getK6DefaultHttpParams(key, tokenChecker)
    });
    check(upsertProfile, {
      "POST Update Profile": (r) => [200, 401].includes(r.status),
    });
  }

  // Check if a delete profile operation is in progress
  // Peak 2.8k req/h
  const executeUserDataProcessing = randomIntBetween(1, 27) == 1;
  if (executeUserDataProcessing) {
    console.debug(`executeUserDataProcessing`);
    const deleteUserDataProcessing = http.get(`${config.IO_BACKEND_BASE_URL}/api/v1/user-data-processing/DELETE`, {
      ...await getK6DefaultHttpParams(key, tokenChecker)
    });
    trackRequest({
      response: deleteUserDataProcessing,
      checkTitle: "GET User Data Processing for delete",
      successCounter: userDataProcessingSuccess,
      failureCounter: userDataProcessingFailure,
      durationTrend: userDataProcessingDuration,
      successStatuses: [200, 404],
      skipStatuses: [401]
    });
  }


  //check if fiscalCode is whitelisted for IT Wallet
  // Peak 55k req/h
  const isFiscalCodeWhitelisted = http.get(`${config.IO_BACKEND_BASE_URL}/api/v1/wallet/whitelisted-fiscal-code`, {
    ...await getK6DefaultHttpParams(key, tokenChecker)
  });
  trackRequest({
    response: isFiscalCodeWhitelisted,
    checkTitle: "GET FiscalCode Whitelist",
    successCounter: fiscalCodeWhitelistSuccess,
    failureCounter: fiscalCodeWhitelistFailure,
    durationTrend: fiscalCodeWhitelistDuration,
    successStatuses: [200],
    skipStatuses: [401]
  });

  //check wallet instance status
  // Peak 55k req/h
  const getWalletInstanceStatus = http.get(`${config.IO_BACKEND_BASE_URL}/api/v1/wallet/wallet-instances/current/status`, {
    ...await getK6DefaultHttpParams(key, tokenChecker)
  });
  trackRequest({
    response: getWalletInstanceStatus,
    checkTitle: "GET Wallet Instance Status",
    successCounter: walletInstanceStatusSuccess,
    failureCounter: walletInstanceStatusFailure,
    durationTrend: walletInstanceStatusDuration,
    successStatuses: [200],
    skipStatuses: [401]
  });

  // Retrieve SEND activation status
  // Peak 56k req/h
  const getSendActivationStatus = http.get(
    `${config.IO_BACKEND_BASE_URL}/api/v1/services/01G40DWQGKY5GRWSNM4303VNRP/preferences`,
    {
      ...await getK6DefaultHttpParams(key, tokenChecker)
    }
  );
  trackRequest({
    response: getSendActivationStatus,
    checkTitle: "GET SEND activation status",
    successCounter: sendActivationStatusSuccess,
    failureCounter: sendActivationStatusFailure,
    durationTrend: sendActivationStatusDuration,
    successStatuses: [200],
    skipStatuses: [401]
  });

  // Retrieve users's messages
  // Peak 56k req/h
  const getMessages = http.get(
    `${config.IO_BACKEND_BASE_URL}/api/v1/messages?enrich_result_data=true&page_size=12&archived=false`,
    {
      ...await getK6DefaultHttpParams(key, tokenChecker)
    }
  );
  trackRequest({
    response: getMessages,
    checkTitle: "GET Users's messagess",
    successCounter: messagesSuccess,
    failureCounter: messagesFailure,
    durationTrend: messagesDuration,
    successStatuses: [200],
    skipStatuses: [401]
  });
};
