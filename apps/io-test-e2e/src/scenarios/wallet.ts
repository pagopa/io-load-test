import { check, fail } from "k6";
import { Trend } from "k6/metrics";
import http from "k6/http";
import { IConfig } from "../utils/config";
import {
  CreateKeyResponse,
  CreateWalletAttestationResponse,
  NonceResponse,
} from "../types/wallet";
import { pipe } from "fp-ts/lib/function";
import * as E from "fp-ts/Either";
import { readableReportSimplified } from "@pagopa/ts-commons/lib/reporters";
import { GeneratedKeypair } from "../utils/lollipop";

// Define metrics
const localUrl = "http://localhost:8001";
const createWalletInstanceDuration = new Trend("wallet_create_wallet_instance");
const createWalletAttestationDuration = new Trend(
  "wallet_create_wallet_attestation"
);

// Function to get nonce
const getNonce = async (
  config: IConfig,
  key: GeneratedKeypair,
  tokenChecker: (key: GeneratedKeypair) => Promise<string>
) => {
  // Perform HTTP GET request for nonce
  const response = http.get(
    `${config.IO_BACKEND_BASE_URL}/api/wallet/v1/nonce`,
    {
      headers: {
        Accept: "*/*",
        Authorization: `Bearer ${await tokenChecker(key)}`,
        "Content-Type": "application/json",
      },
      responseType: "text",
    }
  );

  // Check for 200 status
  check(response, {
    "(wallet) GET nonce returns 200": (r) => r.status === 200,
  });

  // Decode the nonce using fp-ts Either
  const nonce = pipe(
    response.json(),
    NonceResponse.decode,
    E.map((data) => data.nonce),
    E.getOrElseW((errors) => {
      console.error("Error decoding nonce");
      fail(readableReportSimplified(errors));
    })
  );

  // Add duration to metric
  createWalletInstanceDuration.add(response.timings.duration);

  return nonce;
};

/* Function to handle wallet instance creation.
 * Warning: This work only with fiscal codes that starts with LVTEST00A00
 */
export const walletInstanceCreation = async ({
  config,
  key,
  tokenChecker
}: {
  config: IConfig;
  key: GeneratedKeypair;
  tokenChecker: (key: GeneratedKeypair) => Promise<string>;
}) => {
  // Fetch nonce
  const nonce = await getNonce(config, key, tokenChecker);

  // Create key request
  const createKeyResponse = http.get(`${localUrl}/random-key`, {
    headers: { "Content-Type": "application/json" },
    responseType: "text",
  });

  // Decode created key
  const walletKeyTag = pipe(
    createKeyResponse.json(),
    CreateKeyResponse.decode,
    E.map((data) => data.kid),
    E.getOrElseW((errors) => {
      console.error("Error decoding created key");
      fail(readableReportSimplified(errors));
    })
  );

  // Wallet instance creation parameters
  const walletInstanceCreationParams = {
    challenge: nonce,
    hardware_key_tag: walletKeyTag,
    key_attestation: "test",
  };

  // Create wallet instance via POST
  const createWalletInstanceResponse = http.post(
    `${config.IO_BACKEND_BASE_URL}/api/wallet/v1/wallet-instances`,
    JSON.stringify(walletInstanceCreationParams),
    {
      headers: {
        Accept: "*/*",
        Authorization: `Bearer ${await tokenChecker(key)}`,
        "Content-Type": "application/json",
      },
      responseType: "text",
    }
  );

  // Check for 204 status
  check(createWalletInstanceResponse, {
    "(wallet) POST wallet-instances returns 204": (r) => r.status === 204,
  });

  // Add duration to metric
  createWalletInstanceDuration.add(
    createWalletInstanceResponse.timings.duration
  );

  // Fetch second nonce
  const secondNonce = await getNonce(config, key, tokenChecker);

  // Create wallet attestation request (WAR)
  const createWarResponse = http.post(
    `${localUrl}/wallet-attestation-request`,
    JSON.stringify({ nonce: secondNonce, key_tag: walletKeyTag }),
    {
      headers: { "Content-Type": "application/json" },
      responseType: "text",
    }
  );

  // Decode WAR
  const createdWar = pipe(
    createWarResponse.json(),
    CreateWalletAttestationResponse.decode,
    E.map((data) => data.wallet_attestation_request),
    E.getOrElseW((errors) => {
      console.error("Error decoding WAR");
      fail(readableReportSimplified(errors));
    })
  );

  // Wallet attestation creation parameters
  const walletAttestationCreationParams = {
    grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
    assertion: createdWar,
  };

  // Create wallet attestation
  const createWalletAttestationResponse = http.post(
    `${config.IO_BACKEND_BASE_URL}/api/wallet/v1/token`,
    JSON.stringify(walletAttestationCreationParams),
    {
      headers: {
        Accept: "*/*",
        Authorization: `Bearer ${await tokenChecker(key)}`,
        "Content-Type": "application/json",
      },
      responseType: "text",
    }
  );

  // Check for 200 status
  check(createWalletAttestationResponse, {
    "(wallet) POST token returns 200": (r) => r.status === 200,
  });

  // Add duration to metric
  createWalletAttestationDuration.add(
    createWalletAttestationResponse.timings.duration
  );
};
