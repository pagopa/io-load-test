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
import { getK6DefaultHttpParams } from "../utils/http";

const localUrl = "http://localhost:8001";
const createWalletInstanceDuration = new Trend("wallet_create_wallet_instance");
const createWalletAttestationDuration = new Trend(
  "wallet_create_wallet_attestation"
);

const getNonce = (config: IConfig, token: string) => {
  const defaultParams = getK6DefaultHttpParams(token, { responseType: "text" });
  const response = http.get(
    `${config.IO_BACKEND_BASE_URL}/api/wallet/v1/nonce`,
    {
      ...defaultParams,
      headers: {
        ...defaultParams.headers,
        Accept: "*/*",
      },
    }
  );

  check(response, {
    "(wallet) GET nonce returns 200": (r) => r.status === 200,
  });

  const nonce = pipe(
    response.json(),
    NonceResponse.decode,
    E.map((data) => data.nonce),
    E.getOrElseW((errors) => {
      console.error("Error decoding nonce");
      fail(readableReportSimplified(errors));
    })
  );

  createWalletInstanceDuration.add(response.timings.duration);

  return nonce;
};

/* Function to handle wallet instance creation.
 * Warning: This work only with fiscal codes that starts with LVTEST00A00
 */
export const walletInstanceCreation = async ({
  config,
  token
}: {
  config: IConfig;
  key: GeneratedKeypair;
  token: string;
}) => {
  const defaultParams = getK6DefaultHttpParams(token, { responseType: "text" });
  const nonce = getNonce(config, token);

  const createKeyResponse = http.get(`${localUrl}/random-key`, {
    headers: { "Content-Type": "application/json" },
    responseType: "text",
  });

  const walletKeyTag = pipe(
    createKeyResponse.json(),
    CreateKeyResponse.decode,
    E.map((data) => data.kid),
    E.getOrElseW((errors) => {
      console.error("Error decoding created key");
      fail(readableReportSimplified(errors));
    })
  );

  const walletInstanceCreationParams = {
    challenge: nonce,
    hardware_key_tag: walletKeyTag,
    key_attestation: "test",
  };

  const createWalletInstanceResponse = http.post(
    `${config.IO_BACKEND_BASE_URL}/api/wallet/v1/wallet-instances`,
    JSON.stringify(walletInstanceCreationParams),
    {
      ...defaultParams,
      headers: {
        ...defaultParams.headers,
        Accept: "*/*",
      },
    }
  );

  check(createWalletInstanceResponse, {
    "(wallet) POST wallet-instances returns 204": (r) => r.status === 204,
  });

  createWalletInstanceDuration.add(
    createWalletInstanceResponse.timings.duration
  );

  const secondNonce = getNonce(config, token);

  const createWarResponse = http.post(
    `${localUrl}/wallet-attestation-request`,
    JSON.stringify({ nonce: secondNonce, key_tag: walletKeyTag }),
    {
      headers: { "Content-Type": "application/json" },
      responseType: "text",
    }
  );

  const createdWar = pipe(
    createWarResponse.json(),
    CreateWalletAttestationResponse.decode,
    E.map((data) => data.wallet_attestation_request),
    E.getOrElseW((errors) => {
      console.error("Error decoding WAR");
      fail(readableReportSimplified(errors));
    })
  );

  const walletAttestationCreationParams = {
    grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
    assertion: createdWar,
  };

  const createWalletAttestationResponse = http.post(
    `${config.IO_BACKEND_BASE_URL}/api/wallet/v1/token`,
    JSON.stringify(walletAttestationCreationParams),
    {
      ...defaultParams,
      headers: {
        ...defaultParams.headers,
        Accept: "*/*",
      },
    }
  );

  check(createWalletAttestationResponse, {
    "(wallet) POST token returns 200": (r) => r.status === 200,
  });

  createWalletAttestationDuration.add(
    createWalletAttestationResponse.timings.duration
  );
};
