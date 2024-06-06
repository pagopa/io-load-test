import * as t from "io-ts";
import { JsonFromString } from "io-ts-types";

export const SignParams = t.type({
  privateKeyJwk: t.string.pipe(JsonFromString),
  thumbprint: t.string,
  nonce: t.string,
  url: t.string,
});
export type SignParams = t.TypeOf<typeof SignParams>;

export const SignerResponseBody = t.intersection([
  t.type({
    signature: t.string,
    signatureInput: t.string,
  }),
  t.partial({
    digest: t.string,
  }),
]);
export type SignerResponseBody = t.TypeOf<typeof SignerResponseBody>;
