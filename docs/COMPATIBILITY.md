# Dependency Compatibility Matrix

This document tracks the dependency versions used across the Stellar Disaster Relief
Payments platform (JavaScript/TypeScript SDK + React UI, and Rust/Soroban contracts)
and the compatibility rules that must be observed when upgrading them.

---

## 1. Rust / Soroban Contract Stack

| Crate | Version (Cargo.toml) | Notes |
|---|---|---|
| `soroban-sdk` | `22.0.0` | **Pin to exact version.** Must match the Soroban CLI and RPC node version used in deployment. All three must be in sync. |
| `soroban-token-sdk` | `22.0.0` | Must match `soroban-sdk` major version exactly. |
| `sha2` | `0.10.8` | Hashing library for on-chain identity factors and recovery codes. SHA-256 output must match the `crypto-js` SHA-256 output in the TypeScript SDK. |
| `serde` | `1.0` | Serialization; stable API — minor bumps acceptable. |
| `serde_json` | `1.0` | Same as `serde`. |
| `hex` | `0.4.3` | Hex encoding for hash output. Pin to minor version. |

### Soroban Version Alignment Rule

The `soroban-sdk` version in `Cargo.toml` **must** match the version of the
Soroban CLI (`soroban` binary) and the Soroban RPC node being targeted.
A mismatch causes XDR serialisation incompatibilities at contract invocation
time that are difficult to debug.

| Soroban SDK | Compatible Soroban CLI | Compatible Stellar Core |
|---|---|---|
| `22.x` | `22.x` | Protocol 22 (Stellar Core `v20.x`) |
| `21.x` | `21.x` | Protocol 21 |

> **Upgrade path:** When upgrading `soroban-sdk`, update `Cargo.toml`, rebuild
> the contract WASM, redeploy it, and verify the RPC node is running a
> compatible version before calling any contract functions from the SDK.

---

## 2. JavaScript / TypeScript SDK and UI Stack

### Package versions (`package.json`)

| Package | Declared Range | Resolved Version | Notes |
|---|---|---|---|
| `stellar-sdk` | `^12.0.0` | `12.3.0` | Bundles `@stellar/stellar-base@^12.1.1` internally. Do **not** declare a separate `stellar-base` dependency — see warning below. |
| `stellar-base` | `^10.0.0` | `10.0.2` | **⚠ MISMATCH — see warning below.** |
| `crypto-js` | `^4.2.0` | `4.2.0` | Used for client-side SHA-256 in recovery codes and offline QR signatures. Must use SHA-256 to align with contract `sha2` crate. |
| `qrcode` | `^1.5.3` | `1.5.4` | QR code generation. Stable; minor bumps acceptable. |
| `axios` | `^1.6.0` | — | HTTP client. Keep in sync with the `axios` version bundled by `stellar-sdk` (`^1.7.7` as of v12.3.0) to avoid duplicate installations. |
| `react` | `18.3.1` | `18.3.1` | Pinned exact version. |
| `react-dom` | `18.3.1` | `18.3.1` | Must match `react` exactly. |
| `typescript` | `^5.9.3` | — | Keep in sync with `@typescript-eslint/*` parser. |

### ⚠ stellar-base vs @stellar/stellar-base (Action Required)

`stellar-sdk@12.x` depends on `@stellar/stellar-base@^12.x` (the scoped package
under the `@stellar` npm org), **not** `stellar-base` (the legacy unscoped package).

The current `package.json` declares `"stellar-base": "^10.0.0"` as a direct
dependency alongside `"stellar-sdk": "^12.0.0"`. These resolve as two different
packages:

- `node_modules/stellar-base` → v10.0.2 (legacy, unscoped)
- `node_modules/@stellar/stellar-base` → v12.x (bundled by stellar-sdk)

**Risk:** If any SDK code imports from `stellar-base` directly (rather than
re-exporting through `stellar-sdk`), it may use a different XDR codec version
than `stellar-sdk` uses internally, causing serialisation mismatches when
constructing or parsing Stellar transactions and Soroban contract calls.

**Resolution:** Remove the explicit `stellar-base` declaration from
`package.json`. All required primitives (`Keypair`, `Address`, `Networks`, etc.)
are re-exported from `stellar-sdk` and will use the correct `@stellar/stellar-base`
version transitively. If any file imports directly from `stellar-base`, update
those imports to use `stellar-sdk` instead.

### Package version compatibility table

The table below documents which versions of the major packages are known to work
together correctly for on-chain contract calls and XDR serialisation:

| stellar-sdk | @stellar/stellar-base (internal) | soroban-sdk (Rust) | Node.js | TypeScript |
|---|---|---|---|---|
| `12.3.0` | `12.1.1+` | `22.0.0` | `18.x` / `20.x` | `5.x` |
| `12.0.0` | `12.1.1+` | `22.0.0` | `18.x` | `5.x` |
| `11.x` | `11.x` | `21.0.0` | `18.x` | `5.x` |

### Dev dependencies

| Package | Declared Range | Notes |
|---|---|---|
| `jest` | `^29.7.0` | Must stay in sync with `ts-jest`. |
| `ts-jest` | `^29.4.11` | Must match `jest` major version. |
| `@types/jest` | `^29.5.14` | Must match `jest` major version. |
| `@testing-library/react` | `16.3.0` | Must match React 18.x. |
| `@testing-library/jest-dom` | `6.6.3` | Compatible with jest 29.x. |
| `@typescript-eslint/eslint-plugin` | `^6.0.0` | Must stay in sync with `@typescript-eslint/parser`. |
| `@typescript-eslint/parser` | `^6.0.0` | Must match `@typescript-eslint/eslint-plugin`. |

---

## 3. Upgrade Checklist

When upgrading any Stellar-related dependency:

1. **stellar-sdk minor/patch bump** (`12.x → 12.y`)
   - Run `npm install stellar-sdk@<new-version>`.
   - Run `npm test` and verify all SDK unit tests and integration tests pass.
   - Check that the version of `@stellar/stellar-base` bundled by the new
     `stellar-sdk` has not introduced breaking XDR changes.
   - Update the compatibility table in this file.

2. **stellar-sdk major bump** (`12.x → 13.x`)
   - Review the stellar-sdk CHANGELOG for breaking XDR or API changes.
   - Update all direct imports in the SDK (`from 'stellar-sdk'`).
   - Rebuild and redeploy any Soroban contracts if the XDR protocol version changed.
   - Run the full test suite including integration tests.
   - Update the compatibility table in this file.

3. **soroban-sdk bump** (Rust)
   - Update `Cargo.toml`.
   - Rebuild the contract WASM: `cargo build --target wasm32-unknown-unknown --release`.
   - Verify the Soroban CLI version matches.
   - Redeploy the contract to testnet and smoke-test all SDK client methods.
   - Update the compatibility table in this file.

4. **crypto-js bump**
   - Verify the new version still produces identical SHA-256 hex digests for
     test vectors against the Rust `sha2` crate (see the test in
     `tests/__mocks__/crypto-js.ts`).
   - Run `npm test`.

5. **qrcode bump**
   - Verify QR payload generation and validation tests still pass.
   - Run `npm test`.

---

## 4. Known Risks

| Risk | Severity | Status |
|---|---|---|
| `stellar-base` (v10) declared alongside `stellar-sdk@12` which bundles `@stellar/stellar-base@12` | High | Open — see §2 warning above |
| `crypto-js` SHA-256 encoding must match Rust `sha2` crate hex output | Medium | Aligned (both produce lowercase hex) |
| `soroban-sdk` version must match RPC node and Soroban CLI | High | Documented — pin and verify per deployment |
| `axios` version declared in `package.json` may diverge from `stellar-sdk` internal `axios` | Low | Monitor; prefer removing direct `axios` dep and using the re-exported one |
</content>
</invoke>