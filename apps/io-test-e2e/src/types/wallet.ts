import * as t from "io-ts";

export const NonceResponse = t.type({
  nonce: t.string,
});
export type NonceResponse = t.TypeOf<typeof NonceResponse>;

export const CreateKeyResponse = t.type({
  kid: t.string,
});
export type CreateKeyResponse = t.TypeOf<typeof CreateKeyResponse>;

export const CreateWalletAttestationRequest = t.intersection([
  t.type({
    nonce: t.string,
    key_tag: t.string,
  }),
  // Selects which attestation JWK/JWT variant the signer's
  // /wallet-attestation-request endpoint produces ("wp-war+jwt" =
  // default/current, the other typ strings = alternative typologies);
  // defaults to "wp-war+jwt" when omitted.
  t.partial({
    jwk_type: t.union([
      t.literal("wp-war+jwt"),
      t.literal("wia-request+jwt"),
      t.literal("wua-request+jwt"),
    ]),
  }),
]);
export type CreateWalletAttestationRequest = t.TypeOf<
  typeof CreateWalletAttestationRequest
>;

export const CreateWalletAttestationResponse = t.type({
  wallet_attestation_request: t.string,
});
export type CreateWalletAttestationResponse = t.TypeOf<
  typeof CreateWalletAttestationResponse
>;
