# Offline QR, USSD, and reconciliation flows

This document describes the offline-access paths that matter most in a
disaster: beneficiary QR codes, merchant QR codes, USSD menus, portable
offline signing envelopes, and merchant offline payments. It states what the
current code actually guarantees, how records are reconciled, when they
expire, and which abuse-resistance controls are **not** yet implemented.

> **Status:** parts of this area are production-shaped (offline envelope
> signing, merchant volume limits, recovery-code expiry) and parts are
> prototypes (the USSD state machine, static QR payloads, on-chain offline
> payment verification). Treat the "Known gaps" section as a release blocker
> for any deployment that moves real value while disconnected.

## Actors and flows

| Flow | Entry point | Connectivity needed | Current role |
| --- | --- | --- | --- |
| Beneficiary identity QR | `BeneficiaryClient.generateBeneficiaryQRCode` | None to display | Identification and manual verification |
| Merchant shop QR | `MerchantNetwork.generate_shop_qr` | None to display | Share merchant ID/category/location |
| Transaction QR | `MerchantNetwork.generate_transaction_qr` | None to display | Share merchant, amount, transfer code, timestamp |
| USSD menu | `BeneficiaryClient.createUSSDSession` / `processUSSDInput` | None (simulator) | Feature-phone demo / integration seam |
| USSD merchant code | `MerchantNetwork.parse_ussd_code` | None to parse | Parse `*merchant_code*amount#` |
| Offline signing envelope | `OfflineSigner.serialize` / `sign` / `submit` | Sign offline; submit online | Air-gapped or low-connectivity approval |
| Merchant offline payment | `MerchantNetwork.process_offline_payment` | Capture offline; sync online | Record a payment for later reconciliation |

## Guarantees that exist today

### Offline signing envelopes

- `OfflineSigner.serialize` captures the transaction XDR, the network
  passphrase, a creation timestamp, and the public keys that have signed.
- `OfflineSigner.sign` refuses to sign an envelope for a different network and
  refuses to let the same public key sign twice.
- `OfflineSigner.importSignature` accepts an external Ed25519 signature only if
  it is exactly 64 bytes and the signer has not already signed.
- `OfflineSigner.decode` rejects malformed Base64/JSON and payloads missing
  `txXdr`, `networkPassphrase`, `createdAt`, or `signedBy`.
- Stellar transaction sequence numbers provide replay protection when the
  signed transaction is eventually submitted. A replayed transaction is
  rejected by the network.
- `createdAt` is an audit field. **It is not an expiry.**

### Merchant offline capture and sync

- `process_offline_payment` checks that the merchant exists, is active, and has
  `accepts_offline = true`.
- The record is written to temporary storage with `is_synced = false`.
- `sync_offline_transactions` processes each requested ID at most once
  (`is_synced` flips to `true`), adds the amount to the merchant's daily and
  monthly volume and pending settlement, and creates a transaction record with
  `payment_method = PAYMENT_OFFLINE`.
- Unknown transaction IDs are ignored; they do not panic the whole sync.
- A sync returns the number of records that actually transitioned to synced.

### Recovery and temporary credentials

- Recovery codes are created in sets of three with 30, 60, and 90-day expiry.
- A recovery code is single-use: `restore_access` marks it used and persists the
  updated list before changing the beneficiary wallet.
- Temporary credentials are created with a caller-supplied `expires_at`.
  **No function currently checks that timestamp**, so do not treat a temporary
  credential as automatically revoked.

### Online merchant limits

Online `process_payment` enforces the merchant's daily/monthly limits, token
allow-list, active status, and fraud detection. Those checks are **not**
currently applied when an offline payment is captured or synced.

## Expiry semantics

| Artifact | Expiry source | Enforced? | Notes |
| --- | --- | --- | --- |
| Recovery code | `RecoveryCode.expires_at` (30/60/90 days) | Yes | Single-use on success |
| Temporary credential | `expires_at` | No | Stored, but no consumer checks it |
| Emergency fund | `EmergencyFund.expires_at` | Yes | Cleanup marks inactive |
| Beneficiary/merchant QR | None | No | Payload timestamp is informational |
| Offline envelope | None (`createdAt` only) | No | Operators must enforce a TTL |
| Offline merchant payment | None | No | No capture/sync deadline on-chain |
| USSD session | None | No | Client-side state machine |

**Recommended operating policy until on-chain expiry exists:** accept offline
envelopes and merchant offline payments for at most **24 hours** after capture
(72 hours only for a declared communications blackout). Reject or escalate
anything older during reconciliation. Write the chosen window into the
deployment runbook and communicate it to merchants before distribution.

## Reconciliation

1. **Capture offline.** The merchant records merchant ID, beneficiary ID,
   amount, token, purpose, timestamp, and a receipt/signature. Give the
   beneficiary a copy (paper or SMS) with the same values.
2. **Upload in bounded batches.** Submit offline transaction IDs to
   `sync_offline_transactions` in batches small enough for one transaction.
   Keep batch size at or below 100 (see [batch-limits.md](batch-limits.md)).
3. **Deduplicate.** The on-chain `is_synced` flag prevents double-counting the
   same transaction ID. Re-uploading an already-synced ID is a no-op.
4. **Reconcile totals.** Compare the merchant's paper receipts with the synced
   transaction records and the increase in `pending_settlement`. Investigate
   any difference before settlement.
5. **Settle.** Offline transactions are created with `is_settled = false`.
   Settlement is a separate step; do not treat "synced" as "paid out".
6. **Handle collisions.** Offline IDs are derived from merchant ID and ledger
   timestamp. If two captures share both values, the later write can overwrite
   the earlier temporary record. Use a distinct receipt/nonce in the merchant
   app and reconcile counts, not just totals.

### Operator checklist

- [ ] Define the maximum offline age and per-merchant offline cap.
- [ ] Print or SMS a receipt with a unique receipt number.
- [ ] Sync at least daily; do not wait for the cap to expire.
- [ ] Reconcile count, amount, beneficiary, and merchant before settlement.
- [ ] Escalate duplicate receipts, unknown merchant IDs, or amounts over the
      merchant's online limit.
- [ ] Record the sync batch IDs and the operator who ran it.

## Abuse resistance: what exists and what does not

### Present

- Multi-signature approval for fund release and batch disbursement.
- Merchant daily/monthly limits and token allow-lists for online payments.
- Fraud-detection alerts for unusual merchant volume.
- Network passphrase checks and duplicate-signer rejection in offline
  envelopes.
- Stellar sequence-number replay protection at submission time.
- Single-use recovery codes with expiry.
- Merchant `accepts_offline` opt-in.

### Known gaps (do not rely on these as security controls)

- **Recovery codes are deterministic and the client/contract formats do not
  match.** The contract hashes `beneficiary_id + index`; the SDK generates a
  SHA-256 of `beneficiary_id_index_timestamp` and returns a hex string. A code
  shown by the SDK therefore cannot be used directly with the current
  `restore_access` argument type. Anyone who knows a beneficiary ID and the
  algorithm can also derive the contract-side hash. This is a demo-grade
  mechanism, not a production recovery system.
- **Temporary credential expiry is not enforced.** `temporary_credentials`
  records an `expires_at`, but no call site checks it or flips `is_active`.
  Revoke shared-device access explicitly instead of waiting for expiry.
- **Offline merchant payments are not signature-verified on-chain.**
  `process_offline_payment` stores the supplied `signature` string without
  checking it. A merchant or intermediary can submit an arbitrary record.
- **Offline payments bypass merchant limits and token checks.** Limits are
  enforced only in `process_payment`, at sync time nothing re-checks daily or
  monthly volume.
- **No on-chain expiry for offline envelopes or offline payments.** The
  `createdAt` field is audit-only, and `process_offline_payment` takes no
  capture deadline.
- **`sync_offline_transactions` does not authenticate the caller or verify
  that `offline_tx.merchant_id` matches the `merchant_id` argument.** A caller
  who can invoke the contract can attempt to sync another merchant's records.
- **Offline IDs can collide** because they use merchant ID and ledger
  timestamp only.
- **USSD is a simulator.** `createUSSDSession` / `processUSSDInput` are a local
  state machine with no PIN, OTP, server-side session, rate limit, or telco
  integration. `parse_ussd_code` only splits a string and defaults malformed
  amounts to zero.
- **Beneficiary QR contains PII and is not signed or expiring.** The JSON
  includes name, beneficiary ID, disaster ID, trust score, timestamp, and
  factor metadata. `validateBeneficiaryQRCode` checks only the type and that
  the beneficiary exists; it does not check freshness, signature, or
  revocation.
- **Static merchant QR has no signature or expiry.** It is public directory
  data, not a payment authorisation.
- **No offline spending-rule enforcement.** Conditional-transfer rules are not
  evaluated in the offline capture path.

## Deployment guidance

- Prefer offline **envelopes** over offline merchant payment records when the
  transaction must be authorised by the beneficiary: the envelope carries a
  real Stellar signature and sequence number; the merchant record does not.
- Keep offline envelopes short-lived and submit them as soon as connectivity
  returns.
- Use a paper/SMS receipt with a unique receipt number for every offline
  merchant payment.
- Run reconciliation in a secure location; treat merchant-submitted totals as
  claims until matched against beneficiary receipts.
- Do not advertise recovery codes or USSD as production-grade until the gaps
  above are closed.

## Source map

| Concern | Source |
| --- | --- |
| Offline envelope serialize/sign/import/decode | `sdk/src/offlineSigner.ts` |
| Beneficiary QR generation/validation | `sdk/src/beneficiaryClient.ts` |
| USSD session state machine | `sdk/src/beneficiaryClient.ts` |
| Recovery-code generation | `src/beneficiary_manager.rs` |
| Recovery-code restore and expiry | `src/beneficiary_manager.rs` |
| Merchant QR generation | `src/merchant_network.rs` |
| Offline payment capture/sync | `src/merchant_network.rs` |
| USSD code parsing | `src/merchant_network.rs` |
| Online payment limits/fraud checks | `src/merchant_network.rs` |
| Batch size bounds | `src/aid_registry.rs`, `sdk/src/aidClient.ts` |

## Follow-up work

1. Replace deterministic recovery codes with random, salted codes stored only
   as hashes, and align the SDK and contract formats.
2. Verify offline payment signatures on-chain, bind the merchant ID into the
   signed payload, and reject records whose signer is not the merchant.
3. Apply merchant limits, token checks, and spending rules at sync time.
4. Add an explicit `expires_at` to offline envelopes and offline payment
   records, and enforce it in `submit`/`sync`.
5. Authenticate `sync_offline_transactions` and verify each record belongs to
   the calling merchant.
6. Replace the USSD simulator with a telco-integrated gateway with PIN/OTP,
   server-side sessions, and rate limiting.
7. Sign beneficiary QR payloads, minimise PII, and add revocation/freshness
   checks.
