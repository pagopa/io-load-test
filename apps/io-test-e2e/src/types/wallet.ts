import * as t from "io-ts";

export const NonceResponse = t.type({
  nonce: t.string,
});
export type NonceResponse = t.TypeOf<typeof NonceResponse>;

export const CreateKeyResponse = t.type({
  kid: t.string,
});
export type CreateKeyResponse = t.TypeOf<typeof CreateKeyResponse>;
