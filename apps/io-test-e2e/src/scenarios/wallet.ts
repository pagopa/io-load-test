//@ts-ignore
import { htmlReport } from "https://raw.githubusercontent.com/benc-uk/k6-reporter/main/dist/bundle.js";
//@ts-ignore
import { textSummary } from "https://jslib.k6.io/k6-summary/0.0.4/index.js";
import { check, fail } from "k6";
import { Trend } from "k6/metrics";
import http from "k6/http";
import { IConfig } from "../utils/config";
import { CreateKeyResponse, NonceResponse } from "../types/wallet";
import { pipe } from "fp-ts/lib/function";
import * as E from "fp-ts/Either";
import { readableReportSimplified } from "@pagopa/ts-commons/lib/reporters";

const createWalletInstanceDuration = new Trend("wallet_create_wallet_instance");

export const walletInstanceCreation = async (
  config: IConfig,
  thumbprint: string,
  tokenChecker: (thumbprint: string) => Promise<string>
) => {
  const getNonce = http.get(
    `${config.IO_BACKEND_BASE_URL}/api/v1/wallet/nonce`,
    {
      headers: {
        Accept: "*/*",
        Authorization: `Bearer ${await tokenChecker(thumbprint)}`,
        "Content-Type": "application/json",
      },
      responseType: "text",
    }
  );

  check(getNonce, {
    "(wallet) GET nonce returns 200": (r) => r.status === 200,
  });

  const nonce = pipe(
    getNonce.json(),
    NonceResponse.decode,
    E.map((_) => _.nonce),
    E.getOrElseW((_) => {
      console.error("Error decoding nonce");
      fail(readableReportSimplified(_));
    })
  );

  createWalletInstanceDuration.add(getNonce.timings.duration);

  const createKey = http.get(`http://localhost:8001/random-keys`, {
    headers: {
      "Content-Type": "application/json",
    },
    responseType: "text",
  });

  const walletKeyKid = pipe(
    createKey.json(),
    CreateKeyResponse.decode,
    E.map((_) => _.kid),
    E.getOrElseW((_) => {
      console.error("Error decoding created key");
      fail(readableReportSimplified(_));
    })
  );

  const walletInstanceCreationParams = {
    challenge: nonce,
    hardware_key_tag: walletKeyKid,
    key_attestation: "test",
  };

  const createWalletInstance = http.post(
    `${config.IO_BACKEND_BASE_URL}/api/v1/wallet/wallet-instances`,
    JSON.stringify(walletInstanceCreationParams),
    {
      headers: {
        Accept: "*/*",
        Authorization: `Bearer ${await tokenChecker(thumbprint)}`,
        "Content-Type": "application/json",
      },
      responseType: "text",
    }
  );

  check(createWalletInstance, {
    "(wallet) POST wallet-instances returns 204": (r) => r.status === 204,
  });

  createWalletInstanceDuration.add(createWalletInstance.timings.duration);
};
