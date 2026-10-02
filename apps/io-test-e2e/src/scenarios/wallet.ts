import { Counter, Trend } from "k6/metrics";
import http, { RefinedResponse, ResponseType } from "k6/http";
import * as t from "io-ts";
import * as E from "fp-ts/Either";
import { getK6DefaultHttpParams } from "../utils/http";
import { trackRequest } from "../utils/metrics";
import { getResponseBodyAsType } from "../utils/responses";
import { FeatureScenarioParams } from "../types/scenario";
import {
  CreateKeyResponse,
  CreateWalletAttestationResponse,
  NonceResponse,
} from "../types/wallet";

const localUrl = "http://localhost:8001";
const getNonceDuration = new Trend("wallet_get_nonce_duration");
const getNonceSuccess = new Counter("wallet_get_nonce_success");
const getNonceFailure = new Counter("wallet_get_nonce_failure");
const documentsOnIOInstanceCreationDuration = new Trend(
  "wallet_create_instance_duration"
);
const documentsOnIOInstanceCreationSuccess = new Counter(
  "wallet_create_instance_success"
);
const documentsOnIOInstanceCreationFailure = new Counter(
  "wallet_create_instance_failure"
);
const documentsOnIOAttestationTokenDuration = new Trend(
  "wallet_attestation_token_duration"
);
const documentsOnIOAttestationTokenSuccess = new Counter(
  "wallet_attestation_token_success"
);
const documentsOnIOAttestationTokenFailure = new Counter(
  "wallet_attestation_token_failure"
);
const whitelistDuration = new Trend("wallet_whitelist_duration");
const whitelistSuccess = new Counter("wallet_whitelist_success");
const whitelistFailure = new Counter("wallet_whitelist_failure");
const currentStatusDuration = new Trend("wallet_current_status_duration");
const currentStatusSuccess = new Counter("wallet_current_status_success");
const currentStatusFailure = new Counter("wallet_current_status_failure");
const statusWithIdDuration = new Trend("wallet_status_with_id_duration");
const statusWithIdSuccess = new Counter("wallet_status_with_id_success");
const statusWithIdFailure = new Counter("wallet_status_with_id_failure");
const itWalletInstanceAttestationDuration = new Trend(
  "wallet_instance_attestation_duration"
);
const itWalletInstanceAttestationSuccess = new Counter(
  "wallet_instance_attestation_success"
);
const itWalletInstanceAttestationFailure = new Counter(
  "wallet_instance_attestation_failure"
);
const itWalletKeyAttestationDuration = new Trend("wallet_key_attestation_duration");
const itWalletKeyAttestationSuccess = new Counter("wallet_key_attestation_success");
const itWalletKeyAttestationFailure = new Counter("wallet_key_attestation_failure");

type BatchRequest = {
  method: "GET" | "POST";
  url: string;
  body?: string;
  params: ReturnType<typeof getK6DefaultHttpParams>;
};

type NonceName =
  | "documentsOnIOInstanceCreation"
  | "documentsOnIOAttestation"
  | "itWalletInstanceCreation"
  | "itWalletInstanceAttestation"
  | `itWalletKeyAttestation${number}`;
type FlowRequestKind =
  | "documentsOnIOInstanceCreation"
  | "documentsOnIOAttestationRequest"
  | "itWalletInstanceCreation"
  | "itWalletInstanceAttestationRequest"
  | `itWalletKeyAttestationRequest${number}`;
type AttestationRequestKind =
  | "documentsOnIOAttestation"
  | "itWalletInstanceAttestation"
  | "itWalletKeyAttestation";

const decodeBody = <A, S>(body: string, codec: t.Type<A, S>) =>
  getResponseBodyAsType(body, codec);

const decodeNonce = (
  response: RefinedResponse<ResponseType>
): string | undefined => {
  if (response.status !== 200) {
    return undefined;
  }
  const result = decodeBody(String(response.body || ""), NonceResponse);
  return E.isRight(result) ? result.right.nonce : undefined;
};

const decodeKeyTag = (
  response: RefinedResponse<ResponseType>
): string | undefined => {
  if (response.status !== 200) {
    return undefined;
  }
  const result = decodeBody(String(response.body || ""), CreateKeyResponse);
  return E.isRight(result) ? result.right.kid : undefined;
};

const decodeAttestation = (
  response: RefinedResponse<ResponseType>
): string | undefined => {
  if (response.status !== 200) {
    return undefined;
  }
  const result = decodeBody(
    String(response.body || ""),
    CreateWalletAttestationResponse
  );
  return E.isRight(result) ? result.right.wallet_attestation_request : undefined;
};

const shouldExecute = (percentage: number): boolean =>
  Math.random() * 100 < percentage;

export const walletInstanceCreation = async ({
  config,
  key,
  token,
}: FeatureScenarioParams) => {
  const authTextParams = getK6DefaultHttpParams(token, { responseType: "text" });
  const statusParams = getK6DefaultHttpParams(token, {
    responseType: "text",
    additionalExpectedStatuses: [404],
  });
  const signerParams = {
    headers: {},
    responseType: "text" as const,
    timeout: "5s",
  };
  const signerJsonParams = {
    ...signerParams,
    headers: { "Content-Type": "application/json" },
  };

  const landingRequests: BatchRequest[] = [
    {
      method: "GET",
      url: `${config.IO_BACKEND_BASE_URL}/api/wallet/v1/whitelisted-fiscal-code`,
      params: authTextParams,
    },
    {
      method: "GET",
      url: `${config.IO_BACKEND_BASE_URL}/api/wallet/v1/wallet-instances/current/status`,
      params: statusParams,
    },
    {
      method: "GET",
      url: `${config.IO_BACKEND_BASE_URL}/api/wallet/v1/wallet-instances/${key.fiscalCode}/status`,
      params: statusParams,
    },
  ];

  const landingResponses = (await Promise.all(
    landingRequests.map((request) =>
      http.asyncRequest(request.method, request.url, null, request.params)
    )
  )) as RefinedResponse<ResponseType>[];

  trackRequest({
    response: landingResponses[0] as RefinedResponse<"text">,
    checkTitle: "GET Wallet Fiscal Code Whitelist",
    successCounter: whitelistSuccess,
    failureCounter: whitelistFailure,
    durationTrend: whitelistDuration,
    successStatuses: [200],
    skipStatuses: [401],
  });
  trackRequest({
    response: landingResponses[1] as RefinedResponse<"text">,
    checkTitle: "GET Current Wallet Instance Status",
    successCounter: currentStatusSuccess,
    failureCounter: currentStatusFailure,
    durationTrend: currentStatusDuration,
    successStatuses: [200, 404],
    skipStatuses: [401],
  });
  trackRequest({
    response: landingResponses[2] as RefinedResponse<"text">,
    checkTitle: "GET Wallet Instance Status with ID",
    successCounter: statusWithIdSuccess,
    failureCounter: statusWithIdFailure,
    durationTrend: statusWithIdDuration,
    successStatuses: [200, 404],
    skipStatuses: [401],
  });

  const executeDocumentsOnIO = shouldExecute(
    config.DOCUMENTS_ON_IO_RATE_PERCENTAGE
  );
  const executeITWallet = shouldExecute(config.IT_WALLET_RATE_PERCENTAGE);
  if (!executeDocumentsOnIO && !executeITWallet) {
    return;
  }

  const nonceRequests: { name: NonceName; request: BatchRequest }[] = [];
  const addNonceRequest = (name: NonceName) => {
    nonceRequests.push({
      name,
      request: {
        method: "GET",
        url: `${config.IO_BACKEND_BASE_URL}/api/wallet/v1/nonce`,
        params: authTextParams,
      },
    });
  };

  if (executeDocumentsOnIO) {
    addNonceRequest("documentsOnIOInstanceCreation");
    addNonceRequest("documentsOnIOAttestation");
  }
  if (executeITWallet) {
    addNonceRequest("itWalletInstanceCreation");
    addNonceRequest("itWalletInstanceAttestation");
    for (let index = 0; index < config.IT_WALLET_KEY_ATTESTATION_MULTIPLIER; index++) {
      addNonceRequest(`itWalletKeyAttestation${index}` as const);
    }
  }

  const prerequisiteRequests = nonceRequests.map(({ request }) => request);
  const addRandomKeyRequest = () => {
    const index = prerequisiteRequests.length;
    prerequisiteRequests.push({
      method: "GET",
      url: `${localUrl}/random-key`,
      params: signerParams,
    });
    return index;
  };
  const documentsOnIOKeyIndex = executeDocumentsOnIO ? addRandomKeyRequest() : undefined;
  const itWalletKeyIndex = executeITWallet ? addRandomKeyRequest() : undefined;

  const prerequisiteResponses = (await Promise.all(
    prerequisiteRequests.map((request) =>
      http.asyncRequest(request.method, request.url, null, request.params)
    )
  )) as RefinedResponse<ResponseType>[];

  const nonces = new Map<NonceName, string>();
  nonceRequests.forEach(({ name }, index) => {
    const response = prerequisiteResponses[index];
    trackRequest({
      response: response as RefinedResponse<"text">,
      checkTitle: `GET Wallet Nonce (${name})`,
      successCounter: getNonceSuccess,
      failureCounter: getNonceFailure,
      durationTrend: getNonceDuration,
      successStatuses: [200],
      skipStatuses: [401],
    });
    const nonce = decodeNonce(response);
    if (nonce) {
      nonces.set(name, nonce);
    }
  });
  const documentsOnIOKeyTag = documentsOnIOKeyIndex === undefined
    ? undefined
    : decodeKeyTag(prerequisiteResponses[documentsOnIOKeyIndex]);
  let itWalletKeyTag = itWalletKeyIndex === undefined
    ? undefined
    : decodeKeyTag(prerequisiteResponses[itWalletKeyIndex]);
  if (documentsOnIOKeyTag && documentsOnIOKeyTag === itWalletKeyTag) {
    console.log("Wallet signer returned identical hardware key tags; skipping IT Wallet flow");
    itWalletKeyTag = undefined;
  }
  const documentsOnIOInstanceCreationNonce = nonces.get("documentsOnIOInstanceCreation");
  const documentsOnIOAttestationNonce = nonces.get("documentsOnIOAttestation");
  const itWalletInstanceCreationNonce = nonces.get("itWalletInstanceCreation");
  const itWalletInstanceAttestationNonce = nonces.get("itWalletInstanceAttestation");

  const flowRequests: (BatchRequest & { kind: FlowRequestKind })[] = [];
  if (
    documentsOnIOKeyTag &&
    executeDocumentsOnIO &&
    documentsOnIOInstanceCreationNonce
  ) {
    flowRequests.push({
      kind: "documentsOnIOInstanceCreation",
      method: "POST",
      url: `${config.IO_BACKEND_BASE_URL}/api/wallet/v1/wallet-instances`,
      body: JSON.stringify({
        challenge: documentsOnIOInstanceCreationNonce,
        hardware_key_tag: documentsOnIOKeyTag,
        key_attestation: "test",
      }),
      params: authTextParams,
    });
  }
  if (
    documentsOnIOKeyTag &&
    executeDocumentsOnIO &&
    documentsOnIOAttestationNonce
  ) {
    flowRequests.push({
      kind: "documentsOnIOAttestationRequest",
      method: "POST",
      url: `${localUrl}/wallet-attestation-request`,
      body: JSON.stringify({
        nonce: documentsOnIOAttestationNonce,
        key_tag: documentsOnIOKeyTag,
      }),
      params: signerJsonParams,
    });
  }
  if (
    itWalletKeyTag &&
    executeITWallet &&
    itWalletInstanceCreationNonce
  ) {
    flowRequests.push({
      kind: "itWalletInstanceCreation",
      method: "POST",
      url: `${config.IO_BACKEND_BASE_URL}/api/wallet/v1/wallet-instances`,
      body: JSON.stringify({
        challenge: itWalletInstanceCreationNonce,
        hardware_key_tag: itWalletKeyTag,
        key_attestation: "test",
      }),
      params: authTextParams,
    });
  }
  if (
    itWalletKeyTag &&
    executeITWallet &&
    itWalletInstanceAttestationNonce
  ) {
    flowRequests.push({
      kind: "itWalletInstanceAttestationRequest",
      method: "POST",
      url: `${localUrl}/wallet-attestation-request`,
      body: JSON.stringify({
        nonce: itWalletInstanceAttestationNonce,
        key_tag: itWalletKeyTag,
        jwk_type: "wia-request+jwt",
      }),
      params: signerJsonParams,
    });
  }
  if (itWalletKeyTag && executeITWallet) {
    for (let index = 0; index < config.IT_WALLET_KEY_ATTESTATION_MULTIPLIER; index++) {
      const nonceName = `itWalletKeyAttestation${index}` as const;
      const nonce = nonces.get(nonceName);
      if (nonce) {
        flowRequests.push({
          kind: `itWalletKeyAttestationRequest${index}` as const,
          method: "POST",
          url: `${localUrl}/wallet-attestation-request`,
          body: JSON.stringify({
            nonce,
            key_tag: itWalletKeyTag,
            jwk_type: "wua-request+jwt",
          }),
          params: signerJsonParams,
        });
      }
    }
  }

  const flowResponses = (await Promise.all(
    flowRequests.map((request) =>
      http.asyncRequest(
        request.method,
        request.url,
        request.body || null,
        request.params
      )
    )
  )) as RefinedResponse<ResponseType>[];

  const flowResults = new Map<FlowRequestKind, RefinedResponse<ResponseType>>();
  flowRequests.forEach(({ kind }, index) => {
    flowResults.set(kind, flowResponses[index]);
  });

  const documentsOnIOInstanceCreationResponse =
    flowResults.get("documentsOnIOInstanceCreation");
  const documentsOnIOAttestationRequestResponse =
    flowResults.get("documentsOnIOAttestationRequest");
  const itWalletInstanceCreationResponse = flowResults.get("itWalletInstanceCreation");
  const itWalletInstanceAttestationRequestResponse =
    flowResults.get("itWalletInstanceAttestationRequest");
  [
    { name: "Documents on IO", response: documentsOnIOInstanceCreationResponse },
    { name: "IT Wallet", response: itWalletInstanceCreationResponse },
  ].forEach(({ name, response }) => {
    if (response) {
      trackRequest({
        response: response as RefinedResponse<"text">,
        checkTitle: `POST Wallet Instance (${name})`,
        successCounter: documentsOnIOInstanceCreationSuccess,
        failureCounter: documentsOnIOInstanceCreationFailure,
        durationTrend: documentsOnIOInstanceCreationDuration,
        successStatuses: [204],
        skipStatuses: [401],
      });
    }
  });

  const documentsOnIOAssertion = documentsOnIOAttestationRequestResponse
    ? decodeAttestation(documentsOnIOAttestationRequestResponse)
    : undefined;
  const itWalletInstanceAttestationAssertion =
    itWalletInstanceAttestationRequestResponse
      ? decodeAttestation(itWalletInstanceAttestationRequestResponse)
      : undefined;

  const attestationRequests: {
    kind: AttestationRequestKind;
    request: BatchRequest;
  }[] = [];
  if (
    documentsOnIOInstanceCreationResponse?.status === 204 &&
    documentsOnIOAssertion
  ) {
    attestationRequests.push({
      kind: "documentsOnIOAttestation",
      request: {
        method: "POST",
        url: `${config.IO_BACKEND_BASE_URL}/api/wallet/v1/wallet-attestations`,
        body: JSON.stringify({ assertion: documentsOnIOAssertion }),
        params: authTextParams,
      },
    });
  }
  if (
    itWalletInstanceCreationResponse?.status === 204 &&
    itWalletInstanceAttestationAssertion
  ) {
    attestationRequests.push({
      kind: "itWalletInstanceAttestation",
      request: {
        method: "POST",
        url: `${config.IO_BACKEND_BASE_URL}/api/wallet/v1/wallet-instance-attestations`,
        body: itWalletInstanceAttestationAssertion,
        params: {...authTextParams, headers: {...authTextParams.headers, "Content-Type": "text/plain"}},
      },
    });
  }
  if (itWalletInstanceCreationResponse?.status === 204) {
    for (let index = 0; index < config.IT_WALLET_KEY_ATTESTATION_MULTIPLIER; index++) {
      const requestKind = `itWalletKeyAttestationRequest${index}` as const;
      const response = flowResults.get(requestKind);
      const assertion = response ? decodeAttestation(response) : undefined;
      if (assertion) {
        attestationRequests.push({
          kind: "itWalletKeyAttestation",
          request: {
            method: "POST",
            url: `${config.IO_BACKEND_BASE_URL}/api/wallet/v1/key-attestations`,
            body: assertion,
            params: {
              ...authTextParams,
              headers: { ...authTextParams.headers, "Content-Type": "text/plain" },
            },
          },
        });
      }
    }
  }

  const attestationResponses = (await Promise.all(
    attestationRequests.map(({ request }) =>
      http.asyncRequest(
        request.method,
        request.url,
        request.body || null,
        request.params
      )
    )
  )) as RefinedResponse<ResponseType>[];

  attestationRequests.forEach(({ kind }, index) => {
    const response = attestationResponses[index] as RefinedResponse<"text">;
    switch (kind) {
      case "documentsOnIOAttestation":
        trackRequest({
          response,
          checkTitle: "POST Wallet Attestation Token",
          successCounter: documentsOnIOAttestationTokenSuccess,
          failureCounter: documentsOnIOAttestationTokenFailure,
          durationTrend: documentsOnIOAttestationTokenDuration,
          successStatuses: [200],
          skipStatuses: [401],
        });
        break;
      case "itWalletInstanceAttestation":
        trackRequest({
          response,
          checkTitle: "POST Wallet Instance Attestation",
          successCounter: itWalletInstanceAttestationSuccess,
          failureCounter: itWalletInstanceAttestationFailure,
          durationTrend: itWalletInstanceAttestationDuration,
          successStatuses: [200],
          skipStatuses: [401],
        });
        break;
      case "itWalletKeyAttestation":
        trackRequest({
          response,
          checkTitle: "POST Wallet Key Attestation",
          successCounter: itWalletKeyAttestationSuccess,
          failureCounter: itWalletKeyAttestationFailure,
          durationTrend: itWalletKeyAttestationDuration,
          successStatuses: [200],
          skipStatuses: [401],
        });
        break;
    }
  });
};
