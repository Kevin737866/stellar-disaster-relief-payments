# Requirements Document

## Introduction

`EmergencyFundsClient.getFundStatus` in `sdk/src/emergencyFunds.ts` currently returns a fabricated `FundStatus` object with `status: 'active'`, all amounts set to `'0'`, and `beneficiaryCount: 0` — regardless of the actual on-chain state of the requested fund. Callers (e.g. `examples/hurricane-preparedness.ts`) read the returned fields and display them as real data, so there is no way to distinguish a genuine on-chain response from a placeholder.

This enhancement replaces the placeholder with an actual contract simulation call to `get_fund_status`, decodes the contract's 5-tuple response into the existing `FundStatus` interface, and throws typed, distinguishable errors when the fund is missing, the RPC fails, or the response cannot be decoded. The API never returns success-shaped placeholder data again.

## Glossary

- **EmergencyFundsClient**: The SDK client class in `sdk/src/emergencyFunds.ts` that manages emergency fund creation, triggers, disbursements, and status queries against the deployed `aid_registry` contract.
- **getFundStatus**: The method on `EmergencyFundsClient` that retrieves the current status and metrics of a fund. Signature: `async getFundStatus(fundId: string): Promise<FundStatus>`.
- **FundStatus**: The TypeScript interface returned by `getFundStatus`, containing `status` (string), `totalAmount` (string), `releasedAmount` (string), `availableAmount` (string), and `beneficiaryCount` (number).
- **Contract simulation call**: A read-only invocation of the contract via `contract.call("get_fund_status", nativeToScVal(fundId))` that returns the on-chain value without submitting a transaction.
- **Contract tuple**: The 5-element tuple returned by the on-chain `get_fund_status` function: `(String, U256, U256, U256, u64)` representing `(current_status, total_amount, released_amount, available_amount, beneficiary_count)`.
- **scValToNative**: A function from `stellar-sdk` that decodes a Soroban ScVal into a native JavaScript value. For tuple returns, it produces an array-like structure.
- **nativeToScVal**: A function from `stellar-sdk` that encodes a native JavaScript value into a Soroban ScVal for contract call arguments.
- **FundNotFoundError**: A typed error class in `sdk/src/errors.ts` (code: `FUND_NOT_FOUND`) thrown when the requested fund does not exist on-chain.
- **NetworkError**: A typed error class in `sdk/src/errors.ts` (code: `NETWORK_ERROR`) thrown when an RPC or network-level failure occurs.
- **Decode error**: An error thrown when `scValToNative` returns a value that cannot be mapped to the `FundStatus` interface (e.g. unexpected shape, missing elements, or non-numeric amount fields).
- **Placeholder return**: The current behavior where `getFundStatus` returns `{ status: 'active', totalAmount: '0', releasedAmount: '0', availableAmount: '0', beneficiaryCount: 0 }` without querying the contract.

## Requirements

### Requirement 1: Contract simulation call replaces placeholder

**User Story:** As a caller of `getFundStatus`, I want the method to query the deployed contract rather than returning a hardcoded placeholder, so that the returned status and amounts reflect the actual on-chain state of the fund.

#### Acceptance Criteria

1. WHEN `getFundStatus` is called with a valid `fundId`, THE method SHALL invoke `contract.call("get_fund_status", nativeToScVal(fundId))` on the contract identified by `this.contractId`.
2. THE `EmergencyFundsClient` SHALL import `scValToNative` and `nativeToScVal` from `stellar-sdk`.
3. THE method SHALL NOT return a hardcoded placeholder `FundStatus` with `status: 'active'` and zero-valued amounts under any circumstances.

### Requirement 2: Decoding the contract response into FundStatus

**User Story:** As a caller of `getFundStatus`, I want the decoded contract tuple mapped to the `FundStatus` interface, so that each field contains the value from the contract response.

#### Acceptance Criteria

1. WHEN the contract call succeeds, THE method SHALL decode the result using `scValToNative(result.result.retval)`.
2. WHEN the decoded result is a 5-element array-like structure, THE method SHALL map index 0 to `status` (as a string), index 1 to `totalAmount` (converted to string), index 2 to `releasedAmount` (converted to string), index 3 to `availableAmount` (converted to string), and index 4 to `beneficiaryCount` (converted to number).
3. WHEN the decoded U256/bigint amount values are converted to strings, THE method SHALL use `BigInt(...).toString()` or equivalent to preserve full numeric precision without floating-point loss.
4. WHEN the decoded result does not have at least 5 elements or the elements cannot be mapped to the expected types, THE method SHALL throw an error with a message indicating a decode failure.

### Requirement 3: Missing fund error handling

**User Story:** As a caller of `getFundStatus`, I want a missing fund to produce a distinguishable error, so that I can handle "fund not found" differently from network or decode failures.

#### Acceptance Criteria

1. WHEN the contract panics because the fund does not exist (manifesting as an error from `contract.call`), THE method SHALL catch the error and throw a `FundNotFoundError` with the `fundId` in the context.
2. THE `FundNotFoundError` SHALL be imported from `sdk/src/errors.ts`.
3. THE thrown `FundNotFoundError` SHALL include the `fundId` so callers can identify which fund was not found.

### Requirement 4: RPC and decode error handling

**User Story:** As a caller of `getFundStatus`, I want RPC failures and decode errors to produce distinguishable errors, so that I can diagnose whether the problem is network-level or a contract response format issue.

#### Acceptance Criteria

1. WHEN the contract call fails due to an RPC or network-level error (not a contract panic for a missing fund), THE method SHALL throw a `NetworkError` with the operation name `'get fund status'` and the original error message.
2. WHEN the decoded result cannot be mapped to `FundStatus` (decode failure), THE method SHALL throw an error with a message that clearly identifies the failure as a decode error and includes the `fundId`.
3. WHEN an error occurs that is neither a missing-fund panic nor a decode failure, THE method SHALL throw a `NetworkError` as the fallback, preserving the original error message and `fundId` in the context.

### Requirement 5: Test coverage

**User Story:** As a developer maintaining the SDK, I want tests covering successful, missing-fund, malformed-response, and RPC-failure scenarios, so that regressions in the `getFundStatus` implementation are caught automatically.

#### Acceptance Criteria

1. THE test suite SHALL include a test that mocks a successful contract call returning a 5-element tuple and asserts that the returned `FundStatus` fields match the decoded tuple values.
2. THE test suite SHALL include a test that mocks a contract call rejection simulating a missing fund (contract panic) and asserts that `FundNotFoundError` is thrown.
3. THE test suite SHALL include a test that mocks a contract call returning a malformed response (e.g. fewer than 5 elements or unexpected types) and asserts that a decode error is thrown.
4. THE test suite SHALL include a test that mocks an RPC failure (network error from `contract.call`) and asserts that `NetworkError` is thrown.
5. THE tests SHALL use the existing project patterns: `jest.mock('stellar-sdk', ...)` with mocked `scValToNative`, `nativeToScVal`, `Contract`, and a mock `server` object with `jest.fn()` methods.

## Out of scope

- Modifying the on-chain `get_fund_status` contract function signature or return type.
- Adding caching to `getFundStatus` (other SDK methods like `AidClient.getFund` use `ReadCache`, but adding cache here is a separate concern).
- Changing the `FundStatus` interface shape (adding or removing fields).
- Modifying the `EmergencyDeployer.tsx` UI component's local `getFundStatus` function, which derives status independently from `isActive`/`expiresAt` and is unrelated to the SDK method.
- Implementing transaction submission for `getFundStatus` (it is a read-only simulation call, not a write operation).

## Testing requirements

- Unit tests using `jest` with mocked `stellar-sdk` module, covering four scenarios:
  1. **Successful call**: Mock `contract.call` to return a result whose `retval` decodes to a 5-element tuple `[status, total, released, available, count]`. Assert the returned `FundStatus` maps each field correctly, including bigint-to-string conversion for amounts.
  2. **Missing fund**: Mock `contract.call` to reject with an error simulating a contract panic for a nonexistent fund. Assert `FundNotFoundError` is thrown with the correct `fundId`.
  3. **Malformed response**: Mock `contract.call` to return a result whose `retval` decodes to an unexpected structure (e.g. a 3-element array, or `undefined`). Assert a decode error is thrown.
  4. **RPC failure**: Mock `contract.call` to reject with a network-level error. Assert `NetworkError` is thrown.
- Tests shall use the existing mock patterns: `jest.mock('stellar-sdk', () => { ... })` with `scValToNative: jest.fn((v: any) => v?.value ?? v)` and `nativeToScVal: jest.fn((v: unknown) => v)`, matching the conventions in `sdk/src/contractAlignment.test.ts` and `sdk/src/__tests__/batchDisbursement.test.ts`.
- Test file shall be placed at `sdk/src/emergencyFunds.test.ts` following the naming convention of other SDK test files.
