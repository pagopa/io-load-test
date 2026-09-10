// @ts-ignore
import { randomIntBetween } from "https://jslib.k6.io/k6-utils/1.2.0/index.js";
import { check } from "k6";
import { Counter, Trend } from "k6/metrics";
import http, { RefinedResponse, ResponseType } from "k6/http";
import { getK6DefaultHttpParams } from "../utils/http";
import { trackRequest } from "../utils/metrics";
import { setKey } from "../utils/token";
import { flow, pipe } from "fp-ts/lib/function";
import { PublicSession } from "../generated/definitions/session-manager/PublicSession";
import * as E from "fp-ts/Either";
import * as TE from "fp-ts/TaskEither";
import { readableReportSimplified } from "@pagopa/ts-commons/lib/reporters";
import { getResponseBodyAsType } from "../utils/responses";
import { PaginatedPublicMessagesCollection } from "../generated/definitions/messages/PaginatedPublicMessagesCollection";
import { FeatureScenarioParams } from "../types/scenario";

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
const appOpeningWallDuration = new Trend("app_opening_duration");

type BatchRequest = {
  method: "GET" | "POST";
  url: string;
  params: ReturnType<typeof getK6DefaultHttpParams>;
};

/**
 * Loading app base scenario. Assuming as base rate the GET Profile api call
 * with 167k req/h, the other APIs are scaled accordingly inside the function.
 */
export const appOpening = async ({
  config,
  key,
  REDIS_CLIENT,
  token
}: FeatureScenarioParams) => {
  const scenarioStartedAt = Date.now();
  const authParams = getK6DefaultHttpParams(token);
  const sessionParams = getK6DefaultHttpParams(token, { responseType: "text" });
  const profileParams = getK6DefaultHttpParams(token, { responseType: "text" });
  const messagesParams = getK6DefaultHttpParams(token, { responseType: "text" });

  const executeSecondGetSession = randomIntBetween(1, 10) < 4;
  const executeUserDataProcessing = randomIntBetween(1, 35) === 1;
  const executeWalletInit = randomIntBetween(1, 100) <= 68;
  const executeWalletInstanceStatusWithId = randomIntBetween(1, 100) <= 68;
  const executeGetSendActivation = randomIntBetween(1, 100) <= 70;
  const executeGetMessage = randomIntBetween(1, 100) <= 57;

  const requests: BatchRequest[] = [
    {
      method: "GET",
      url: `${config.IO_BACKEND_BASE_URL}/api/v1/ping`,
      params: { timeout: "12s", responseType: "none" },
    },
    {
      method: "GET",
      url: `${config.AUTH_BACKEND_BASE_URL}/api/auth/v1/session`,
      params: sessionParams,
    },
    {
      method: "GET",
      url: `${config.IO_BACKEND_BASE_URL}/api/identity/v1/profile`,
      params: profileParams,
    },
    {
      method: "GET",
      url: `${config.IO_BACKEND_BASE_URL}/api/communication/v1/messages?enrich_result_data=true&page_size=12&archived=false`,
      params: messagesParams,
    },
  ];

  const index = {
    ping: 0,
    session: 1,
    profile: 2,
    messages: 3,
    session2: -1,
    userDataProcessing: -1,
    fiscalCodeWhitelist: -1,
    walletStatus: -1,
    walletStatusWithId: -1,
    sendActivation: -1,
  };

  if (executeSecondGetSession) {
    index.session2 = requests.length;
    requests.push({
      method: "GET",
      url: `${config.AUTH_BACKEND_BASE_URL}/api/auth/v1/session`,
      params: authParams,
    });
  }

  if (executeUserDataProcessing) {
    index.userDataProcessing = requests.length;
    requests.push({
      method: "GET",
      url: `${config.IO_BACKEND_BASE_URL}/api/identity/v1/user-data-processing/DELETE`,
      params: authParams,
    });
  }

  if (executeWalletInit) {
    index.fiscalCodeWhitelist = requests.length;
    requests.push({
      method: "GET",
      url: `${config.IO_BACKEND_BASE_URL}/api/wallet/v1/whitelisted-fiscal-code`,
      params: authParams,
    });
    index.walletStatus = requests.length;
    requests.push({
      method: "GET",
      url: `${config.IO_BACKEND_BASE_URL}/api/wallet/v1/wallet-instances/current/status`,
      params: authParams,
    });
    if (executeWalletInstanceStatusWithId) {
      index.walletStatusWithId = requests.length;
      requests.push({
        method: "GET",
        url: `${config.IO_BACKEND_BASE_URL}/api/wallet/v1/wallet-instances/${key.fiscalCode}/status`,
        params: authParams,
      });
    }
  }

  if (executeGetSendActivation) {
    index.sendActivation = requests.length;
    requests.push({
      method: "GET",
      url: `${config.IO_BACKEND_BASE_URL}/api/identity/v1/services/01G40DWQGKY5GRWSNM4303VNRP/preferences`,
      params: authParams,
    });
  }

  const responses = (await Promise.all(
    requests.map((request) =>
      http.asyncRequest(request.method, request.url, null, request.params)
    )
  )) as RefinedResponse<ResponseType>[];

  const track = (
    responseIndex: number,
    checkTitle: string,
    successCounter: Counter,
    failureCounter: Counter,
    durationTrend: Trend,
    successStatuses: number[],
    skipStatuses?: number[]
  ) => {
    if (responseIndex < 0) {
      return;
    }
    trackRequest({
      response: responses[responseIndex] as RefinedResponse<"text">,
      checkTitle,
      successCounter,
      failureCounter,
      durationTrend,
      successStatuses,
      skipStatuses,
    });
  };

  track(index.ping, "GET Status", pingSuccess, pingFailure, pingDuration, [204]);
  track(
    index.session,
    "GET Get Session",
    sessionSuccess,
    sessionFailure,
    sessionDuration,
    [200],
    [401]
  );
  track(
    index.session2,
    "GET Get Session",
    sessionSuccess,
    sessionFailure,
    sessionDuration,
    [200],
    [401]
  );
  track(
    index.profile,
    "GET Profile",
    profileSuccess,
    profileFailure,
    profileDuration,
    [200],
    [401]
  );
  track(
    index.userDataProcessing,
    "GET User Data Processing for delete",
    userDataProcessingSuccess,
    userDataProcessingFailure,
    userDataProcessingDuration,
    [200, 404],
    [401]
  );
  track(
    index.fiscalCodeWhitelist,
    "GET FiscalCode Whitelist",
    fiscalCodeWhitelistSuccess,
    fiscalCodeWhitelistFailure,
    fiscalCodeWhitelistDuration,
    [200],
    [401]
  );
  track(
    index.walletStatus,
    "GET Wallet Instance Status",
    walletInstanceStatusSuccess,
    walletInstanceStatusFailure,
    walletInstanceStatusDuration,
    [200, 404],
    [401]
  );
  track(
    index.walletStatusWithId,
    "GET Wallet Instance Status with ID",
    walletInstanceStatusWithIdSuccess,
    walletInstanceStatusWithIdFailure,
    walletInstanceStatusWithIdDuration,
    [200, 404],
    [401]
  );
  track(
    index.sendActivation,
    "GET SEND activation status",
    sendActivationStatusSuccess,
    sendActivationStatusFailure,
    sendActivationStatusDuration,
    [200],
    [401]
  );
  track(
    index.messages,
    "GET Users's messages",
    messagesSuccess,
    messagesFailure,
    messagesDuration,
    [200],
    [401]
  );

  const getSession = responses[index.session];
  await pipe(
    E.tryCatch(() => JSON.parse(String(getSession.body || "")), E.toError),
    E.chain(
      flow(
        PublicSession.decode,
        E.mapLeft((err) => new Error(readableReportSimplified(err)))
      )
    ),
    TE.fromEither,
    TE.chain((session) =>
      setKey(REDIS_CLIENT, `${key.thumbprint}-bpd-token`, session.bpdToken || "")
    )
  )().catch((e) => {
    console.error(
      `Error storing BPD token for key ${key.thumbprint}|DETAIL => ${e.message}`
    );
  });

  const getProfile = responses[index.profile];
  try {
    const profile = JSON.parse(String(getProfile.body || ""));
    if (
      profile.service_preferences_settings &&
      profile.service_preferences_settings.mode === "LEGACY"
    ) {
      console.info(`Legacy mode detected for `, profile.fiscal_code);
      const upsertProfile = http.post(
        `${config.IO_BACKEND_BASE_URL}/api/identity/v1/profile`,
        JSON.stringify({
          ...profile,
          service_preferences_settings: { mode: "AUTO" },
        }),
        getK6DefaultHttpParams(token, { responseType: "text" })
      );
      check(upsertProfile, {
        "POST Update Profile": (r) => [200, 401].includes(r.status),
      });
    }
  } catch {
    // Non-JSON / unauthorized profile bodies must not abort the VU.
  }

  if (executeGetMessage) {
    const getMessages = responses[index.messages];
    await pipe(
      getResponseBodyAsType(
        String(getMessages.body || ""),
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
      TE.map((messagesId) => {
        const getMessage = http.get(
          `${config.IO_BACKEND_BASE_URL}/api/communication/v1/messages/${messagesId}`,
          getK6DefaultHttpParams(token)
        );
        trackRequest({
          response: getMessage as RefinedResponse<"text">,
          checkTitle: "GET User's message by ID",
          successCounter: messageSuccess,
          failureCounter: messageFailure,
          durationTrend: messageDuration,
          successStatuses: [200],
          skipStatuses: [401],
        });
      })
    )();
  }
  appOpeningWallDuration.add(Date.now() - scenarioStartedAt);
};
