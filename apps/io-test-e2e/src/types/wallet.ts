import * as t from "io-ts";

export const NonceResponse = t.type({
  nonce: t.string,
});
export type NonceResponse = t.TypeOf<typeof NonceResponse>;

export const CreateKeyResponse = t.type({
  kid: t.string,
});
export type CreateKeyResponse = t.TypeOf<typeof CreateKeyResponse>;

export const CreateWalletAttestationRequest = t.type({
  nonce: t.string,
  key_tag: t.string,
});
export type CreateWalletAttestationRequest = t.TypeOf<
  typeof CreateWalletAttestationRequest
>;

export const CreateWalletAttestationResponse = t.type({
  wallet_attestation_request: t.string,
});
export type CreateWalletAttestationResponse = t.TypeOf<
  typeof CreateWalletAttestationResponse
>;
