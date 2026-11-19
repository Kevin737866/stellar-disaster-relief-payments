# Testing and mock limitations

## Cache invalidation

`sdk/src/cacheInvalidation.test.ts` seeds the read cache, performs representative
write calls, and verifies the next read is served from the loader again. Covered
paths:

- `AidClient.deployEmergencyFund`, `triggerDisbursement` (and failed-write behavior)
- `BeneficiaryClient.registerBeneficiary`, `verifyBeneficiary`, `updateLocation`
- `MerchantClient.processPayment`, `verifyMerchant`
- `TransferClient.createTransfer`, `spend`
- `TrackerClient.createShipment`, `addCheckpoint`

These tests use a mocked Stellar server/contract. They validate the cache wiring,
not on-chain behavior.

## Offline envelope builders

`sdk/src/offlineBuilders.test.ts` exercises the client offline builders with the
real `TransactionBuilder` and `Contract` (no network calls). Each test confirms:

- the envelope carries the expected network passphrase and starts unsigned;
- the serialized XDR deserializes to a single-operation transaction;
- signing records the signer and produces a valid signature;
- encode/decode survives transport and the signed transaction can be submitted;
- cross-network signing is rejected.

### Limitations

- The builders intentionally do **not** validate contract argument semantics;
  they only serialize the operation the caller requested.
- `buildOfflinePayment` returns a single-signature `OfflineEnvelope`.
  `buildMultiSigPayment` is provided separately when a threshold of signatures
  must be collected.
- Offline envelopes do not enforce expiry or nonce rules themselves; callers must
  apply the operational controls described in the SDK docs.

## Contract-shape alignment

`sdk/src/contractAlignment.test.ts` parses the Rust contract sources and compares
each SDK call's method name and argument count with the contract signature. This
catches drift that heavy mocks would otherwise hide.

Known divergences are deliberately listed in `KNOWN_DIVERGENCES` in that file:

| Contract method | Contract args | SDK args | Reason |
| --- | --- | --- | --- |
| `create_fund` | 11 | 10 | The SDK facade does not expose the optional `metadata` map yet. |
| `register_merchant` | 10 | 11 | The SDK still sends legacy onboarding fields (`stellar_toml_url`, daily/monthly limits, documents). |
| `process_payment` | 8 | 7 | The SDK does not expose the contract `payment_method` discriminator. |

Fixing any of these divergences requires updating the SDK call **and** the
corresponding entry in `KNOWN_DIVERGENCES`; the test will fail if the two drift
apart silently.

### Value-shape limitations

The alignment test deliberately checks names and arity only. It does not yet
prove that every SDK value encodes to the exact Soroban type expected by Rust
(for example `U256` vs string or `Address` vs string). Those conversions remain
covered by the contract integration tests and should be extended when the SDK
facades above are aligned.
