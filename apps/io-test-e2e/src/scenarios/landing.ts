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
import { Client } from "k6/experimental/redis";
import { setKey } from "../utils/token";
import { flow, pipe } from "fp-ts/lib/function";
import { PublicSession } from "../generated/definitions/session-manager/PublicSession";
import * as E from "fp-ts/Either";
import * as TE from "fp-ts/TaskEither";
import { readableReportSimplified } from "@pagopa/ts-commons/lib/reporters";
import { getResponseBodyAsType } from "../utils/responses";
import { PaginatedPublicMessagesCollection } from "../generated/definitions/messages/PaginatedPublicMessagesCollection";

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
const walletInstanceStatusWithIdDuration = new Trend("get_wallet_instance_status_wid_duration");
const walletInstanceStatusWithIdFailure = new Counter("get_wallet_instance_status_wid_failure");
const walletInstanceStatusWithIdSuccess = new Counter("get_wallet_instance_status_wid_success");
const sendActivationStatusDuration = new Trend("get_send_activation_status");
const sendActivationStatusFailure = new Counter("get_send_activation_failure");
const sendActivationStatusSuccess = new Counter("get_send_activation_success");
const messagesDuration = new Trend("get_opening_messages_duration");
const messagesFailure = new Counter("get_opening_messages_failure");
const messagesSuccess = new Counter("get_opening_messages_success");
const messageDuration = new Trend("get_opening_message_detail_duration");
const messageFailure = new Counter("get_opening_message_detail_failure");
const messageSuccess = new Counter("get_opening_message_detail_success");

/**
 * Loading app base scenario. Assuming as base rate the GET Profile api call
 * with 167k req/h, the other APIs are scaled accordingly inside the function.
 * @param param0 The parameters required for the app opening scenario, including configuration, key, Redis client, and token checker function.
 */
export const appOpening = async ({
  config,
  key,
  REDIS_CLIENT,
  tokenChecker
}: {
  config: IConfig;
  key: GeneratedKeypair;
  REDIS_CLIENT: Client;
  tokenChecker: (key: GeneratedKeypair) => Promise<string>;
}) => {
  // Check if App is online
  // Peak 371k req/h
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
  // Peak 225k req/h
  const getSession = http.get(
    `${config.AUTH_BACKEND_BASE_URL}/api/auth/v1/session`,
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
  // Store BPD token in Redis to use it in other scenarios
  await pipe(
    E.tryCatch(() =>
      JSON.parse(getSession.body),
      E.toError
    ),
    E.chain(
      flow(
        PublicSession.decode,
        E.mapLeft((err) => {
          return new Error(readableReportSimplified(err));
        })
      )
    ),
    TE.fromEither,
    TE.chain((session) => setKey(REDIS_CLIENT, `${key.thumbprint}-bpd-token`, session.bpdToken || "")),
  )().catch((e) => {
    console.error(`Error storing BPD token for key ${key.thumbprint}|DETAIL => ${e.message}`);
  });
  // Occasionally execute a second get session to simulate multiple app tabs
  const executeSecondGetSession = randomIntBetween(1, 10) < 4;
  if(executeSecondGetSession){
    const getSession2 = http.get(
      `${config.AUTH_BACKEND_BASE_URL}/api/auth/v1/session`,
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
  // Peak 167k req/h
  const getProfile = http.get(`${config.IO_BACKEND_BASE_URL}/api/identity/v1/profile`, {
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
    console.info(`Legacy mode detected for `, profile.fiscal_code);
    const upsertProfile = http.post(`${config.IO_BACKEND_BASE_URL}/api/identity/v1/profile`,JSON.stringify({...profile, service_preferences_settings: {mode: "AUTO"}}), {
      ...await getK6DefaultHttpParams(key, tokenChecker)
    });
    check(upsertProfile, {
      "POST Update Profile": (r) => [200, 401].includes(r.status),
    });
  }

  // Check if a delete profile operation is in progress
  // Peak 4.8k req/h
  const executeUserDataProcessing = randomIntBetween(1, 35) == 1;
  if (executeUserDataProcessing) {
    console.debug(`executeUserDataProcessing`);
    const deleteUserDataProcessing = http.get(`${config.IO_BACKEND_BASE_URL}/api/identity/v1/user-data-processing/DELETE`, {
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

  const executeWalletInit = randomIntBetween(1, 100) <= 68;
  if (executeWalletInit) {
    console.debug(`executeWalletInit`);
    //check if fiscalCode is whitelisted for IT Wallet
    // Peak 113k req/h
    const isFiscalCodeWhitelisted = http.get(`${config.IO_BACKEND_BASE_URL}/api/wallet/v1/whitelisted-fiscal-code`, {
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
    // Peak 113k req/h
    const getWalletInstanceStatus = http.get(`${config.IO_BACKEND_BASE_URL}/api/wallet/v1/wallet-instances/current/status`, {
      ...await getK6DefaultHttpParams(key, tokenChecker)
    });
    trackRequest({
      response: getWalletInstanceStatus,
      checkTitle: "GET Wallet Instance Status",
      successCounter: walletInstanceStatusSuccess,
      failureCounter: walletInstanceStatusFailure,
      durationTrend: walletInstanceStatusDuration,
      successStatuses: [200, 404],
      skipStatuses: [401]
    });

    //check wallet instance status
    // Peak 76k req/h
    const executeWalletInstanceStatusWithId = randomIntBetween(1, 100) <= 68;
    if (executeWalletInstanceStatusWithId) {
      console.debug(`executeWalletInstanceStatusWithId`);
      const getWalletInstanceStatusWithId = http.get(`${config.IO_BACKEND_BASE_URL}/api/wallet/v1/wallet-instances/${profile.fiscal_code}/status`, {
        ...await getK6DefaultHttpParams(key, tokenChecker)
      });
      trackRequest({
        response: getWalletInstanceStatusWithId,
        checkTitle: "GET Wallet Instance Status with ID",
        successCounter: walletInstanceStatusWithIdSuccess,
        failureCounter: walletInstanceStatusWithIdFailure,
        durationTrend: walletInstanceStatusWithIdDuration,
        successStatuses: [200, 404],
        skipStatuses: [401]
      });
    }
  }

  // Retrieve SEND activation status
  // Peak 117k req/h
  const executeGetSendActivation = randomIntBetween(1, 100) <= 70;
  if (executeGetSendActivation) {
    console.debug(`executeGetSendActivation`);
    const getSendActivationStatus = http.get(
      `${config.IO_BACKEND_BASE_URL}/api/identity/v1/services/01G40DWQGKY5GRWSNM4303VNRP/preferences`,
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
  }

  console.debug(`executeGetMessages`);
  // Retrieve users's messages
  // Peak 161k req/h
  const getMessages = http.get(
    `${config.IO_BACKEND_BASE_URL}/api/communication/v1/messages?enrich_result_data=true&page_size=12&archived=false`,
    {
      ...await getK6DefaultHttpParams(key, tokenChecker)
    }
  );
  trackRequest({
    response: getMessages,
    checkTitle: "GET Users's messages",
    successCounter: messagesSuccess,
    failureCounter: messagesFailure,
    durationTrend: messagesDuration,
    successStatuses: [200],
    skipStatuses: [401]
  });


  // Retrieve user's message by ID
  // Peak 94.5k req/h
  const executeGetMessage = randomIntBetween(1, 100) <= 57;
  if (executeGetMessage) {
    console.debug(`executeGetMessage`);
    await pipe(
      getResponseBodyAsType(
        getMessages.body,
        PaginatedPublicMessagesCollection
      ),
      TE.fromEither,
      TE.chain((res) =>
        pipe(
          res.items[0],
          E.fromNullable(new Error("No messages available")),
          TE.fromEither
        )
      ),
      TE.map((message) => message.id),
      TE.bindTo("messagesId"),
      TE.bind("requestDefaultsAndRefreshToken", () =>
        TE.tryCatch(() => getK6DefaultHttpParams(key, tokenChecker), E.toError)
      ),
      TE.map(({ messagesId, requestDefaultsAndRefreshToken }) => {
          const getMessage = http.get(
            `${config.IO_BACKEND_BASE_URL}/api/communication/v1/messages/${messagesId}`,
            {
              ...requestDefaultsAndRefreshToken
            }
          );
          trackRequest({
            response: getMessage,
            checkTitle: "GET User's message by ID",
            successCounter: messageSuccess,
            failureCounter: messageFailure,
            durationTrend: messageDuration,
            successStatuses: [200],
            skipStatuses: [401]
          });
        }
      )
    )();
  }
};
