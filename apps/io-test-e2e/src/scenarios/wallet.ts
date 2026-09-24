import { Counter, Trend } from "k6/metrics";
import http, { RefinedResponse, ResponseType } from "k6/http";
import * as t from "io-ts";
import { pipe } from "fp-ts/lib/function";
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
const createInstanceDuration = new Trend("wallet_create_instance_duration");
const createInstanceSuccess = new Counter(
  "wallet_create_instance_success"
);
const createInstanceFailure = new Counter("wallet_create_instance_failure");
const attestationTokenDuration = new Trend(
  "wallet_attestation_token_duration"
);
const attestationTokenSuccess = new Counter(
  "wallet_attestation_token_success"
);
const attestationTokenFailure = new Counter(
  "wallet_attestation_token_failure"
);

type BatchRequest = {
  method: "GET" | "POST";
  url: string;
  body?: string;
  params: ReturnType<typeof getK6DefaultHttpParams>;
};

/* Decode a JSON response body into the given codec. */
const decodeBody = <A, S>(body: string, codec: t.Type<A, S>) =>
  getResponseBodyAsType(body, codec);

/* Function to handle wallet instance creation and attestation.
 * Warning: This works only with fiscal codes that start with LVTEST00A00.
 * The flow is parallelized in batches: nonces and key generation run first,
 * instance creation and attestation request next, then the token exchange.
 */
export const walletInstanceCreation = async ({
  config,
  token,
}: FeatureScenarioParams) => {
  const authTextParams = getK6DefaultHttpParams(token, { responseType: "text" });
  const signerTextParams = getK6DefaultHttpParams(token, { responseType: "text" });

  // Batch 1: all independent requests (nonces + signer local key).
  const batch1: BatchRequest[] = [
    {
      method: "GET",
      url: `${config.IO_BACKEND_BASE_URL}/api/wallet/v1/nonce`,
      params: authTextParams,
    },
    {
      method: "GET",
      url: `${localUrl}/random-key`,
      params: { ...signerTextParams, headers: {} },
    },
    {
      method: "GET",
      url: `${config.IO_BACKEND_BASE_URL}/api/wallet/v1/nonce`,
      params: authTextParams,
    },
  ];

  const responses1 = (await Promise.all(
    batch1.map((request) =>
      http.asyncRequest(request.method, request.url, null, request.params)
    )
  )) as RefinedResponse<ResponseType>[];

  const nonce1 = responses1[0];
  const randomKey = responses1[1];
  const nonce2 = responses1[2];

  trackRequest({
    response: nonce1 as RefinedResponse<"text">,
    checkTitle: "GET Wallet Nonce",
    successCounter: getNonceSuccess,
    failureCounter: getNonceFailure,
    durationTrend: getNonceDuration,
    successStatuses: [200],
    skipStatuses: [401],
  });

  trackRequest({
    response: nonce2 as RefinedResponse<"text">,
    checkTitle: "GET Wallet Nonce",
    successCounter: getNonceSuccess,
    failureCounter: getNonceFailure,
    durationTrend: getNonceDuration,
    successStatuses: [200],
    skipStatuses: [401],
  });

  const challenge = pipe(
    decodeBody(String(nonce1.body || ""), NonceResponse),
    E.map((data) => data.nonce),
    E.getOrElseW((errors) => {
      console.error(`Error decoding wallet nonce|DETAIL => ${errors.message}`);
      return "" as string;
    })
  );

  const walletKeyTag = pipe(
    decodeBody(String(randomKey.body || ""), CreateKeyResponse),
    E.map((data) => data.kid),
    E.getOrElseW((errors) => {
      console.error(
        `Error decoding created wallet key|DETAIL => ${errors.message}`
      );
      return "" as string;
    })
  );

  const attestationChallenge = pipe(
    decodeBody(String(nonce2.body || ""), NonceResponse),
    E.map((data) => data.nonce),
    E.getOrElseW((errors) => {
      console.error(
        `Error decoding wallet attestation nonce|DETAIL => ${errors.message}`
      );
      return "" as string;
    })
  );

  if (!challenge || !walletKeyTag || !attestationChallenge) {
    return;
  }

  // Batch 2: wallet instance creation and attestation request (signer local).
  const batch2: BatchRequest[] = [
    {
      method: "POST",
      url: `${config.IO_BACKEND_BASE_URL}/api/wallet/v1/wallet-instances`,
      body: JSON.stringify({
        challenge,
        hardware_key_tag: walletKeyTag,
        key_attestation: "test",
      }),
      params: authTextParams,
    },
    {
      method: "POST",
      url: `${localUrl}/wallet-attestation-request`,
      body: JSON.stringify({
        nonce: attestationChallenge,
        key_tag: walletKeyTag,
      }),
      params: {
        headers: {
          "Content-Type": "application/json",
        },
        responseType: "text",
        timeout: "5s",
      },
    },
  ];

  const responses2 = (await Promise.all(
    batch2.map((request) =>
      http.asyncRequest(request.method, request.url, request.body, request.params)
    )
  )) as RefinedResponse<ResponseType>[];

  const createWalletInstanceResponse = responses2[0];
  const walletAttestationRequest = responses2[1];

  trackRequest({
    response: createWalletInstanceResponse as RefinedResponse<"text">,
    checkTitle: "POST Wallet Instance",
    successCounter: createInstanceSuccess,
    failureCounter: createInstanceFailure,
    durationTrend: createInstanceDuration,
    successStatuses: [204],
    skipStatuses: [401],
  });

  console.log(`Wallet Attestation Request Response: ${String(walletAttestationRequest.body || "")}`)
  
  const createdWar = pipe(
    decodeBody(
      String(walletAttestationRequest.body || ""),
      CreateWalletAttestationResponse
    ),
    E.map((data) => data.wallet_attestation_request),
    E.getOrElseW((errors) => {
      console.error(
        `Error decoding wallet attestation request|DETAIL => ${errors.message}`
      );
      return "" as string;
    })
  );

  if (!createdWar || createWalletInstanceResponse.status !== 204) {
    return;
  }

  // Final step: exchange the attestation for a wallet token.
  const createWalletAttestationResponse = http.post(
    `${config.IO_BACKEND_BASE_URL}/api/wallet/v1/wallet-attestations`,
    JSON.stringify({
      //grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: createdWar,
    }),
    authTextParams
  );

  trackRequest({
    response: createWalletAttestationResponse as RefinedResponse<"text">,
    checkTitle: "POST Wallet Attestation Token",
    successCounter: attestationTokenSuccess,
    failureCounter: attestationTokenFailure,
    durationTrend: attestationTokenDuration,
    successStatuses: [200],
    skipStatuses: [401],
  });

  // IT Wallet new
  const createWalletInstanceAttestationResponse = http.post(
    `${config.IO_BACKEND_BASE_URL}/api/wallet/v1/wallet-instance-attestations`,
    JSON.stringify({
      //grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: createdWar,
    }),
    authTextParams
  );


  const createWalletKeyAttestationResponse = http.post(
    `${config.IO_BACKEND_BASE_URL}/api/wallet/v1/key-attestations`,
    JSON.stringify({
      //grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: createdWar,
    }),
    authTextParams
  );
  /**
   * Valore contenitore esterno
  {
    "alg": "ES256",
    "kid": "ec#1",
    "typ": "wua-request+jwt"
  }
  {
    "cnf": {
      "jwk": {
        "kty": "EC",
        "x": "bXZ7gXeYQIN3D8s-_6PLwRci-LKeOR4pBaIDGbHu3_c",
        "y": "-IviCfpgz96E_UJAjR0WdPdz9F3EXJG6QpZexyinBew",
        "kid": "8UkfrvttLkpAQOOp4KYpaPsBLlvb2hhAAyTLBVN6NUc",
        "crv": "P-256"
      }
    },
    "hardware_key_tag": "bar11",
    "hardware_signature": "foo",
    "integrity_assertion": "foo",
    "iss": "bar11",
    "keys_to_attest": [
      "eyJhbGciOiJFUzI1NiIsImtpZCI6ImVjIzEiLCJ0eXAiOiJrZXktYXR0ZXN0YXRpb24tcmVxdWVzdCtqd3QifQ.eyJjbmYiOnsiandrIjp7ImNydiI6IlAtMjU2Iiwia3R5IjoiRUMiLCJ4IjoiYlhaN2dYZVlRSU4zRDhzLV82UEx3UmNpLUxLZU9SNHBCYUlER2JIdTNfYyIsInkiOiItSXZpQ2ZwZ3o5NkVfVUpBalIwV2RQZHo5RjNFWEpHNlFwWmV4eWluQmV3Iiwia2lkIjoiOFVrZnJ2dHRMa3BBUU9PcDRLWXBhUHNCTGx2YjJoaEFBeVRMQlZONk5VYyJ9fSwid3NjZF9rZXlfYXR0ZXN0YXRpb24iOnsic3RvcmFnZV90eXBlIjoiTE9DQUxfTkFUSVZFIn0sImlhdCI6MTc4OTExMjA4NCwiZXhwIjoxODIwNjY5Njg0fQ._bPnvROq2Xl1W1wdaL67-1my_JYTU9RtW8anetKRL1uAk_ykUcfcnvRAYEBiXdwWbArYeLClN7RmH-Bry5IbFw"
    ],
    "nonce": "bab89e0130507dbf12f095092092b720bd4c0a4b535bd4855127f9f97d8e5c08",
    "platform": "ios",
    "wallet_solution_id": "appio",
    "wallet_solution_version": "3.25.0.1",
    "iat": 1789112118,
    "exp": 1820669718
  }
  * Valore all'interno di keys_to_attest con stessa chiave
  {
    "alg": "ES256",
    "kid": "ec#1",
    "typ": "key-attestation-request+jwt"
  }
  {
  "cnf": {
    "jwk": {
      "crv": "P-256",
      "kty": "EC",
      "x": "bXZ7gXeYQIN3D8s-_6PLwRci-LKeOR4pBaIDGbHu3_c",
      "y": "-IviCfpgz96E_UJAjR0WdPdz9F3EXJG6QpZexyinBew",
      "kid": "8UkfrvttLkpAQOOp4KYpaPsBLlvb2hhAAyTLBVN6NUc"
    }
  },
  "wscd_key_attestation": {
    "storage_type": "LOCAL_NATIVE"
  }
}
   */
};
