import {
  AlgorithmTypes,
  CreateSignatureHeaderOptions,
  algMap,
  createSignatureHeader,
} from "@mattrglobal/http-signatures";
import * as jose from "jose";
import * as E from "fp-ts/Either";

export type createLollipopHeadersT = (input: {
  method?: string;
  url: string;
  body: unknown;
  nonce?: string;
  headers?: Record<string, unknown>;
  privateKeyJwk: jose.JWK;
  thumbprint: string;
}) => Promise<
  E.Either<
    Error,
    { digest?: string; signature: string; signatureInput: string }
  >
>;
export const createLollipopHeaders: createLollipopHeadersT = async (input) => {
  const method = input?.method ?? "GET";
  const url = input.url;
  const alg = AlgorithmTypes["ecdsa-p256-sha256"];
  const sign = algMap[alg].sign(input.privateKeyJwk);
  const keyid = input.thumbprint;
  const lollipopHttpHeaders = {
    ["x-pagopa-lollipop-original-method"]: method,
    ["x-pagopa-lollipop-original-url"]: url,
  };
  const bodyCovered: string[] = input?.body ? ["content-digest"] : [];
  const options: CreateSignatureHeaderOptions = {
    alg,
    nonce: input.nonce,
    signer: { keyid, sign },
    url,
    method,
    httpHeaders: { ...input.headers, ...lollipopHttpHeaders },
    body: input?.body ? (input?.body as string) : undefined,
    coveredFields: [
      ...bodyCovered,
      "x-pagopa-lollipop-original-method",
      "x-pagopa-lollipop-original-url",
    ].map((v) => [v.toLowerCase(), new Map()]),
  };
  const result = await createSignatureHeader(options);

  return result.isOk()
    ? E.right(result.value)
    : E.left(
        new Error(
          `Error generating the signature message: ${result.error.message}`
        )
      );
};
