# Design Document: Emergency Fund Status From Contract

## Overview

This design replaces the placeholder return in `EmergencyFundsClient.getFundStatus` with an actual contract simulation call. The method will call `contract.call("get_fund_status", nativeToScVal(fundId))`, decode the result via `scValToNative(result.result.retval)`, map the 5-element tuple to the `FundStatus` interface, and throw typed, distinguishable errors for missing funds, RPC failures, and decode errors.

The change is localized to `sdk/src/emergencyFunds.ts` (the `getFundStatus` method and the import statement) and a new test file `sdk/src/emergencyFunds.test.ts`. No other SDK methods, contract functions, or UI components are modified.

## Architecture

```
sdk/src/emergencyFunds.ts
├── EmergencyFundsClient
│   ├── constructor(contractId, signingKey, server, networkPassphrase)
│   └── getFundStatus(fundId)  ← MODIFIED
│       ├── new Contract(this.contractId)
│       ├── contract.call("get_fund_status", nativeToScVal(fundId))
│       ├── scValToNative(result.result.retval) → [status, total, released, available, count]
│       ├── Map tuple → FundStatus (BigInt → string for amounts)
│       └── Error handling:
│           ├── Contract panic (missing fund) → FundNotFoundError
│           ├── Decode failure → Error (decode message)
│           └── RPC/network failure → NetworkError
│
sdk/src/errors.ts
├── FundNotFoundError  (code: FUND_NOT_FOUND)  ← imported by getFundStatus
├── NetworkError      (code: NETWORK_ERROR)   ← imported by getFundStatus (existing)
└── ErrorCode enum
│
sdk/src/emergencyFunds.test.ts  ← NEW
├── Mock stellar-sdk (scValToNative, nativeToScVal, Contract, etc.)
├── Test: successful call → correct FundStatus mapping
├── Test: missing fund → FundNotFoundError
├── Test: malformed response → decode error
└── Test: RPC failure → NetworkError
│
src/aid_registry.rs (on-chain contract — NOT MODIFIED)
└── get_fund_status(env, fund_id) → (String, U256, U256, U256, u64)
    └── Panics if fund doesn't exist (unwrap_or_panic_with)
```

## Components and Interfaces

### EmergencyFundsClient.getFundStatus (modified)

**Current implementation:**

```typescript
async getFundStatus(fundId: string): Promise<FundStatus> {
  try {
    const contract = new Contract(this.contractId) as any;
    // Note: This would typically use contract.call() in a simulation
    // For now, returning a placeholder structure
    return {
      status: 'active',
      totalAmount: '0',
      releasedAmount: '0',
      availableAmount: '0',
      beneficiaryCount: 0,
    };
  } catch (error: any) {
    throw new NetworkError('get fund status', error.message, { fundId });
  }
}
```

**New implementation:**

```typescript
async getFundStatus(fundId: string): Promise<FundStatus> {
  try {
    const contract = new Contract(this.contractId) as any;
    const result = await contract.call("get_fund_status", nativeToScVal(fundId));
    const decoded = scValToNative(result.result.retval);

    // Validate decoded shape: expect a 5-element array-like structure
    if (!Array.isArray(decoded) || decoded.length < 5) {
      throw new Error(
        `Failed to decode fund status: unexpected response shape for fund '${fundId}'`
      );
    }

    return {
      status: String(decoded[0]),
      totalAmount: BigInt(decoded[1]).toString(),
      releasedAmount: BigInt(decoded[2]).toString(),
      availableAmount: BigInt(decoded[3]).toString(),
      beneficiaryCount: Number(decoded[4]),
    };
  } catch (error: any) {
    // If the error is already a FundNotFoundError, rethrow as-is
    if (error instanceof FundNotFoundError) {
      throw error;
    }
    // If the error message indicates a missing fund (contract panic),
    // throw FundNotFoundError
    if (error.message && (
      error.message.includes('unwrap_or_panic') ||
      error.message.includes('not found') ||
      error.message.includes('does not exist')
    )) {
      throw new FundNotFoundError(fundId, { originalError: error.message });
    }
    // If the error is a decode error we threw above, rethrow as-is
    if (error.message && error.message.includes('Failed to decode fund status')) {
      throw error;
    }
    // Fallback: treat as network/RPC error
    throw new NetworkError('get fund status', error.message, { fundId });
  }
}
```

**Import changes:**

The existing import from `stellar-sdk` must add `scValToNative` and `nativeToScVal`:

```typescript
import {
  Address,
  Contract,
  Signer,
  Networks,
  TransactionBuilder,
  FeeBumpTransaction,
  Operation,
  xdr,
  Keypair,
  BASE_FEE,
  scValToNative,      // ← ADD
  nativeToScVal,       // ← ADD
} from 'stellar-sdk';
```

The existing import from `./errors` must add `FundNotFoundError`:

```typescript
import {
  FundCreationError,
  TriggerExecutionError,
  InsufficientApprovalsError,
  UnauthorizedApproverError,
  AllocationError,
  AllocationBelowMinimumError,
  AllocationExceedsMaximumError,
  NetworkError,
  ValidationError,
  UnauthorizedError,
  FundNotFoundError,   // ← ADD
} from './errors';
```

### Contract call pattern

The `contract.call("get_fund_status", ...)` pattern follows the same convention used by `AidClient.getFund` in `sdk/src/aidClient.ts`:

```typescript
// AidClient.getFund (existing pattern)
const result = await this.contract.call("get_fund", nativeToScVal(fundId));
return scValToNative(result.result.retval);
```

The key difference is that `AidClient` stores `this.contract` as a class member, while `EmergencyFundsClient` constructs `new Contract(this.contractId)` locally in each method. The `getFundStatus` implementation follows the existing `EmergencyFundsClient` pattern of constructing the contract locally.

### Error classification logic

The contract's `get_fund_status` panics when the fund does not exist (via `unwrap_or_panic_with(&env)`). This panic manifests as an error thrown by `contract.call()`. The error message from the Stellar SDK typically contains context about the failed operation.

The classification logic checks the error message for indicators of a missing fund and maps those to `FundNotFoundError`. If the message does not match known missing-fund patterns and is not a decode error we threw ourselves, the fallback is `NetworkError`. This ensures all three error types remain distinguishable:

| Error source | Detection | Thrown type |
|---|---|---|
| Contract panic (missing fund) | Error message contains `unwrap_or_panic`, `not found`, or `does not exist` | `FundNotFoundError` |
| Decode failure | We threw it ourselves (`"Failed to decode fund status"` in message) | `Error` (rethrown) |
| RPC / network failure | Fallback (neither of the above) | `NetworkError` |

## Data Models

### FundStatus (unchanged interface)

```typescript
export interface FundStatus {
  status: string;
  totalAmount: string;
  releasedAmount: string;
  availableAmount: string;
  beneficiaryCount: number;
}
```

### Contract tuple (on-chain return type)

```rust
// src/aid_registry.rs
pub fn get_fund_status(env: Env, fund_id: String) -> (String, U256, U256, U256, u64)
```

| Index | Rust type | JS decoded type | FundStatus field | Conversion |
|---|---|---|---|---|
| 0 | `String` | `string` | `status` | `String(decoded[0])` |
| 1 | `U256` | `bigint` | `totalAmount` | `BigInt(decoded[1]).toString()` |
| 2 | `U256` | `bigint` | `releasedAmount` | `BigInt(decoded[2]).toString()` |
| 3 | `U256` | `bigint` | `availableAmount` | `BigInt(decoded[3]).toString()` |
| 4 | `u64` | `number` | `beneficiaryCount` | `Number(decoded[4])` |

### Error types used

```typescript
// sdk/src/errors.ts

class FundNotFoundError extends StellarDisasterReliefError {
  constructor(fundId: string, context?: Record<string, any>) {
    super(ErrorCode.FUND_NOT_FOUND,
      `Fund with ID '${fundId}' not found or does not exist`,
      { fundId, ...context });
  }
}

class NetworkError extends StellarDisasterReliefError {
  constructor(operation: string, reason: string, context?: Record<string, any>) {
    super(ErrorCode.NETWORK_ERROR,
      `Network error during ${operation}: ${reason}`,
      { operation, reason, ...context });
  }
}
```

## Error Handling

### Missing fund (contract panic)

The on-chain `get_fund_status` uses `unwrap_or_panic_with(&env)` when the fund ID is not found in storage. This causes the contract to panic, and the Stellar SDK throws an error from `contract.call()`. The error message may contain strings like `"unwrap_or_panic"`, `"not found"`, or `"does not exist"`.

**Handling:** Catch the error, inspect the message for missing-fund indicators, and throw `FundNotFoundError` with the `fundId` in context.

### RPC error

Network-level failures (timeout, connection refused, server unreachable) cause `contract.call()` to reject with an error that does not contain missing-fund indicators.

**Handling:** The catch-all fallback throws `NetworkError` with the operation name `'get fund status'`, the original error message, and `{ fundId }` in context.

### Decode error

If `scValToNative` returns a value that is not a 5-element array, or if `BigInt()` or `Number()` conversion fails on the tuple elements, the method throws an `Error` with a message containing `"Failed to decode fund status"`.

**Handling:** The error is thrown inside the `try` block and caught by the `catch` block. Since the message contains `"Failed to decode fund status"`, it is rethrown as-is rather than being wrapped in a `NetworkError`.

## Correctness Properties

### Property 1: Returned values originate from the contract response

**Validates: Requirements 1.1, 1.3, 2.1, 2.2**

**Property:** For any call to `getFundStatus(fundId)` that succeeds, every field of the returned `FundStatus` (`status`, `totalAmount`, `releasedAmount`, `availableAmount`, `beneficiaryCount`) is derived from the decoded contract response tuple, not from a hardcoded constant.

**How to test:** Mock `contract.call` to return a result whose `retval` decodes to a known 5-tuple. Assert each `FundStatus` field equals the corresponding decoded tuple element. Use distinct non-zero values to ensure the placeholder is not accidentally returned.

**Test type:** Example test with specific values.

### Property 2: Amount fields preserve full precision via string conversion

**Validates: Requirement 2.3**

**Property:** The `totalAmount`, `releasedAmount`, and `availableAmount` fields in the returned `FundStatus` are string representations of the decoded U256/bigint values, preserving full numeric precision without floating-point loss.

**How to test:** Mock the contract to return a large U256 value (e.g. `9007199254740993n`, which exceeds `Number.MAX_SAFE_INTEGER`). Assert the returned string matches `BigInt(...).toString()` exactly, not a floating-point approximation.

**Test type:** Edge-case example test.

### Property 3: Missing funds produce FundNotFoundError

**Validates: Requirements 3.1, 3.2, 3.3**

**Property:** When the contract panics because the fund does not exist, `getFundStatus` throws `FundNotFoundError` (not `NetworkError` or a generic `Error`), and the error's context includes the `fundId`.

**How to test:** Mock `contract.call` to reject with an error simulating a contract panic. Assert the thrown error is an instance of `FundNotFoundError` and that `error.context.fundId` matches the requested fund ID.

**Test type:** Example test.

### Property 4: RPC failures produce NetworkError

**Validates: Requirements 4.1, 4.3**

**Property:** When `contract.call` fails due to an RPC or network-level error that is not a contract panic for a missing fund, `getFundStatus` throws `NetworkError` with the operation name and `fundId` in context.

**How to test:** Mock `contract.call` to reject with a generic `Error('Connection refused')`. Assert the thrown error is an instance of `NetworkError` with `code === ErrorCode.NETWORK_ERROR` and `context.fundId` matching.

**Test type:** Example test.

### Property 5: Decode errors are distinguishable from other errors

**Validates: Requirements 2.4, 4.2**

**Property:** When the decoded contract response does not have the expected 5-element shape, `getFundStatus` throws an `Error` with a message containing `"Failed to decode fund status"`, which is distinguishable from `FundNotFoundError` and `NetworkError`.

**How to test:** Mock `contract.call` to return a result whose `retval` decodes to a 3-element array. Assert the thrown error message contains `"Failed to decode fund status"` and that the error is not an instance of `FundNotFoundError` or `NetworkError`.

**Test type:** Example test.

## Testing Strategy

| Requirement | Test Name | Type |
|---|---|---|
| 1.1, 1.3, 2.1, 2.2 | `getFundStatus returns decoded contract values on success` | Example |
| 2.3 | `getFundStatus preserves bigint precision in amount fields` | Edge case |
| 3.1, 3.2, 3.3 | `getFundStatus throws FundNotFoundError for missing fund` | Example |
| 4.1, 4.3 | `getFundStatus throws NetworkError on RPC failure` | Example |
| 2.4, 4.2 | `getFundStatus throws decode error for malformed response` | Example |
| 1.2 | `scValToNative and nativeToScVal are imported from stellar-sdk` | Import verification (covered by test compilation) |
| 5.1–5.5 | All tests use jest.mock stellar-sdk pattern | Test infrastructure |

### Test mock setup

Tests follow the existing `sdk/src/__tests__/batchDisbursement.test.ts` pattern:

```typescript
jest.mock('stellar-sdk', () => {
  const actual = jest.requireActual('stellar-sdk');
  return {
    ...actual,
    Contract: jest.fn().mockImplementation(() => ({
      call: jest.fn(),
    })),
    nativeToScVal: jest.fn((v: unknown) => v),
    scValToNative: jest.fn((v: any) => v?.value ?? v),
    Address: jest.fn().mockImplementation((addr: string) => ({ toScVal: () => addr })),
    Networks: { TESTNET: 'Test SDF Network ; September 2015', ... },
    BASE_FEE: '100',
  };
});
```

Each test configures the mock `contract.call` return value or rejection to simulate the desired scenario.

## Files to Modify

### `sdk/src/emergencyFunds.ts`

- Add `scValToNative` and `nativeToScVal` to the import from `stellar-sdk`.
- Add `FundNotFoundError` to the import from `./errors`.
- Replace the body of `getFundStatus` with the contract simulation call, decode, mapping, and error handling logic described above.

### `sdk/src/emergencyFunds.test.ts` (new file)

- Create a new test file with `jest.mock('stellar-sdk', ...)` setup.
- Add four test cases covering: successful call, missing fund, malformed response, and RPC failure.
- Follow the naming and structure conventions of `sdk/src/__tests__/batchDisbursement.test.ts`.
