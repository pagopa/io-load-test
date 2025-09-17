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
  thumbprint: string,
  tokenChecker: (thumbprint: string) => Promise<string>
) => {
  // Check if App is online
  // Peak 650k req/h
  const isOnline = http.get(`${config.IO_BACKEND_BASE_URL}/api/v1/ping`);
  isOnline.status === 204 ? pingSuccess.add(1) : pingFailure.add(1);
  check(isOnline, {
    "GET Status returns 200": (r) => r.status === 204,
  });
  pingDuration.add(isOnline.timings.duration);

  // Retrieve the session using the new token
  // Peak 115k req/h
  const getSession = http.get(
    `${config.AUTH_BACKEND_BASE_URL}/api/v1/session`,
    {
      ...await getK6DefaultHttpParams(thumbprint, tokenChecker)
    }
  );
  check(getSession, {
    "GET Get Session returns 200": (r) => [200, 401].includes(r.status),
  });
  if (getSession.status !== 200){
    console.log(`Get Session returns an error => statusCode=${getSession.status}, detail=${getSession.body}`)
    sessionFailure.add(1);
  } else {
    sessionSuccess.add(1);
  }

  sessionDuration.add(getSession.timings.duration);
  const executeSecondGetSession = randomIntBetween(1, 10) < 6;
  if(executeSecondGetSession){
    const getSession2 = http.get(
      `${config.AUTH_BACKEND_BASE_URL}/api/v1/session`,
      {
        ...await getK6DefaultHttpParams(thumbprint, tokenChecker)
      }
    );
    check(getSession2, {
      "GET Get Session returns 200": (r) => [200, 401].includes(r.status),
    });
    if (getSession2.status !== 200){
      console.log(`Get Session returns an error => statusCode=${getSession2.status}, detail=${getSession2.body}`)
      sessionFailure.add(1);
    } else {
      sessionSuccess.add(1);
    }
    sessionDuration.add(getSession2.timings.duration);
  }

  // Retrieve the profile using the new token
  // Peak 70k req/h
  const getProfile = http.get(`${config.IO_BACKEND_BASE_URL}/api/v1/profile`, {
    ...await getK6DefaultHttpParams(thumbprint, tokenChecker)
  });
  check(getProfile, {
    "GET Profile returns 200": (r) => [200, 401].includes(r.status),
  });

  // Service preferences require a non Legacy service preferences mode
  // if the current profile is detected to use Legacy mode it will be updated to AUTO mode
  const profile = JSON.parse(getProfile.body);
  if (profile.service_preferences_settings && profile.service_preferences_settings.mode == "LEGACY") {
    console.error(`Legacy mode detected for `, profile.fiscal_code);
    const upsertProfile = http.post(`${config.IO_BACKEND_BASE_URL}/api/v1/profile`,JSON.stringify({...profile, service_preferences_settings: {mode: "AUTO"}}), {
      ...await getK6DefaultHttpParams(thumbprint, tokenChecker)
    });
    check(upsertProfile, {
      "POST Update Profile returns 200": (r) => [200, 401].includes(r.status),
    });
  }
  if (getProfile.status !== 200){
    console.log(`Get Profile returns an error => statusCode=${getProfile.status}, detail=${getProfile.body}`);
    profileFailure.add(1);
  } else {
    profileSuccess.add(1);
  }
  profileDuration.add(getProfile.timings.duration);

  // Check if a delete profile operation is in progress
  // Peak 2.8k req/h
  const executeUserDataProcessing = randomIntBetween(1, 27) == 1;
  if (executeUserDataProcessing) {
    console.debug(`executeUserDataProcessing`);
    const deleteUserDataProcessing = http.get(`${config.IO_BACKEND_BASE_URL}/api/v1/user-data-processing/DELETE`, {
      ...await getK6DefaultHttpParams(thumbprint, tokenChecker)
    });
    [200, 404, 401].includes(deleteUserDataProcessing.status) ? userDataProcessingSuccess.add(1) : userDataProcessingFailure.add(1);
    check(deleteUserDataProcessing, {
      "GET User Data Processing for delete returns 200": (r) => [200, 404, 401].includes(r.status),
    });
    userDataProcessingDuration.add(deleteUserDataProcessing.timings.duration);
  }


  //check if fiscalCode is whitelisted for IT Wallet
  // Peak 55k req/h
  const isFiscalCodeWhitelisted = http.get(`${config.IO_BACKEND_BASE_URL}/api/v1/wallet/whitelisted-fiscal-code`, {
    ...await getK6DefaultHttpParams(thumbprint, tokenChecker)
  });
  check(isFiscalCodeWhitelisted, {
    "GET FiscalCode Whitelist returns 200": (r) => [200, 401].includes(r.status),
  });
  if (isFiscalCodeWhitelisted.status !== 200){
    console.log(`Get FiscalCode Whitelist returns an error => statusCode=${isFiscalCodeWhitelisted.status}, detail=${isFiscalCodeWhitelisted.body}`)
    fiscalCodeWhitelistFailure.add(1);
  } else {
    fiscalCodeWhitelistSuccess.add(1);
  }
  fiscalCodeWhitelistDuration.add(isFiscalCodeWhitelisted.timings.duration);

  //check wallet instance status
  // Peak 55k req/h
  const getWalletInstanceStatus = http.get(`${config.IO_BACKEND_BASE_URL}/api/v1/wallet/wallet-instances/current/status`, {
    ...await getK6DefaultHttpParams(thumbprint, tokenChecker)
  });
  check(getWalletInstanceStatus, {
    "GET Wallet Instance Status returns 200": (r) => [200, 401].includes(r.status),
  });
  if (getWalletInstanceStatus.status !== 200){
    console.log(`Get Wallet Instance Status returns an error => statusCode=${getWalletInstanceStatus.status}, detail=${getWalletInstanceStatus.body}`)
    walletInstanceStatusFailure.add(1);
  } else {
    walletInstanceStatusSuccess.add(1);
  }
  walletInstanceStatusDuration.add(getWalletInstanceStatus.timings.duration);

  // Retrieve SEND activation status
  // Peak 56k req/h
  const getSendActivationStatus = http.get(
    `${config.IO_BACKEND_BASE_URL}/api/v1/services/01G40DWQGKY5GRWSNM4303VNRP/preferences`,
    {
      ...await getK6DefaultHttpParams(thumbprint, tokenChecker)
    }
  );
  check(getSendActivationStatus, {
    "GET SEND activation status returns 200": (r) => [200, 401].includes(r.status),
  });
  if (getSendActivationStatus.status !== 200){
    console.log(`Get SEND activation returns an error => statusCode=${getSendActivationStatus.status}, detail=${getSendActivationStatus.body}`)
    sendActivationStatusFailure.add(1);
  } else {
    sendActivationStatusSuccess.add(1);
  }
  sendActivationStatusDuration.add(getSendActivationStatus.timings.duration);

  // Retrieve users's messages
  // Peak 56k req/h
  const getMessages = http.get(
    `${config.IO_BACKEND_BASE_URL}/api/v1/messages?enrich_result_data=true&page_size=12&archived=false`,
    {
      ...await getK6DefaultHttpParams(thumbprint, tokenChecker)
    }
  );
  check(getMessages, {
    "GET Users's messages returns 200": (r) => [200, 401].includes(r.status),
  });
  if (getMessages.status !== 200){
    console.log(`Get Messages returns an error => statusCode=${getMessages.status}, detail=${getMessages.body}`)
    messagesFailure.add(1);
  } else {
    messagesSuccess.add(1);
  }
  messagesDuration.add(getMessages.timings.duration);
};
