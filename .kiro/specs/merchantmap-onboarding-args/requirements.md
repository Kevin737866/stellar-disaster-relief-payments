# Requirements: MerchantMap Onboarding Argument Fix

## Introduction

`MerchantMap.handleOnboarding` calls `merchantClient.createOnboardingRequest` with five arguments, passing a `Location` object in the third position. The SDK helper expects eleven arguments: a numeric `category` in the third position, followed by separate location strings and contact details. The mismatch means TypeScript would reject the call and the intended `MerchantOnboardingRequest` can never be constructed.

Additionally, the form collects `stellarAddress`, `acceptedTokens`, `dailyLimit`, and `monthlyLimit` values that do not appear in `MerchantOnboardingRequest`. Rendering them as editable fields implies they will be persisted, but they are silently discarded on submission.

The fix aligns `handleOnboarding` with the actual SDK signature, maps form fields to request fields correctly, and removes or annotates controls for values the current contract cannot store.

## Glossary

- **createOnboardingRequest**: SDK helper on `MerchantClient` that assembles a `MerchantOnboardingRequest` from eleven individual parameters.
- **MerchantOnboardingRequest**: The typed request object consumed by `registerMerchant`. Contains `category: number`, flat location strings (`locationLatLng`, `locationAddress`, `locationCity`, `locationCountry`, `locationPostalCode`), `contactInfo`, `acceptedTokens: string[]`, `vouchers: string[]`, and `emergencyFastTrack: boolean`.
- **category**: Numeric code for the merchant's business type. 0=food, 1=water, 2=shelter, 3=medical, 4=clothing, 5=fuel. Distinct from the form's string `businessType` field.
- **locationLatLng**: A `"lat,lng"` string expected by `registerMerchant`, e.g. `"18.4861,-69.9312"`.
- **unsupported field**: A form control whose value has no corresponding field in `MerchantOnboardingRequest` and is not sent to the contract (`stellarAddress`, `dailyLimit`, `monthlyLimit`).

## Requirements

### Requirement 1: Correct argument mapping

**User Story:** As an operator registering a merchant, I want form submission to build a valid `MerchantOnboardingRequest` without type errors, so that `registerMerchant` receives the data I entered.

#### Acceptance Criteria

1. WHEN `handleOnboarding` is called, THE component SHALL invoke `createOnboardingRequest` with all eleven parameters in the order specified by the SDK: `name`, `businessType`, `category` (number), `locationLatLng` ("lat,lng" string), `locationAddress`, `locationCity`, `locationCountry`, `locationPostalCode`, `contactInfo`, `vouchers`, `emergencyFastTrack`.
2. THE `locationLatLng` argument SHALL be constructed as `"${latitude},${longitude}"` from the form's separate latitude and longitude fields.
3. THE `category` argument SHALL be derived from the form's `businessType` string using a deterministic mapping (see Requirement 2).
4. THE component SHALL pass no `Location` object to `createOnboardingRequest`.

### Requirement 2: Category mapping

**User Story:** As an operator, I want the form's business-type selection to correspond to the correct numeric category the contract expects, so the merchant is registered under the right category.

#### Acceptance Criteria

1. THE component SHALL map form `businessType` strings to numeric category codes: `grocery`→0, `pharmacy`→3, `hardware`→0, `fuel_station`→5, `clothing`→4, `restaurant`→0, `transport`→0, `communication`→0, with any unrecognised value defaulting to 0.
2. WHEN `createOnboardingRequest` is called, THE `category` parameter SHALL be a `number`, not a string.

### Requirement 3: Unsupported fields

**User Story:** As an operator, I want the form to be honest about which fields will be persisted on-chain, so I do not enter data expecting it to be saved when it will not be.

#### Acceptance Criteria

1. THE `stellarAddress` input SHALL be removed from the onboarding form because `MerchantOnboardingRequest` has no such field.
2. THE `dailyLimit` and `monthlyLimit` inputs SHALL be removed from the onboarding form because `MerchantOnboardingRequest` has no such fields; these values are set by the contract based on `emergencyFastTrack`.
3. THE `acceptedTokens` input SHALL be removed; `createOnboardingRequest` hardcodes `['XLM']` and the contract does not accept a custom list at registration time.
4. THE `facilityName` and `contactPerson` location sub-fields SHALL be removed from form state and JSX because they are not sent to the contract.
5. WHEN any of the above fields are removed, THE rest of the form SHALL continue to function correctly.

### Requirement 4: Success and failure feedback

**User Story:** As an operator, I want clear feedback after submitting the form, so I know whether registration succeeded or what went wrong.

#### Acceptance Criteria

1. WHEN `registerMerchant` resolves successfully, THE component SHALL close the form, reset form state, and display a success message.
2. WHEN `registerMerchant` rejects, THE component SHALL display an error message that includes the rejection reason from the SDK error.
3. THE loading state SHALL be shown during submission and cleared on both success and failure.

### Requirement 5: Test coverage

**User Story:** As a developer, I want tests that verify the corrected argument mapping and error handling, so regressions are caught automatically.

#### Acceptance Criteria

1. THE test suite SHALL include a test that submits the form with valid values and asserts `createOnboardingRequest` is called with the correct eleven arguments in the correct order.
2. THE test suite SHALL include a test that verifies `locationLatLng` is built as `"lat,lng"` from the separate latitude and longitude form fields.
3. THE test suite SHALL include a test for each category mapping: `grocery`→0, `pharmacy`→3, `fuel_station`→5, `clothing`→4.
4. THE test suite SHALL include a test that simulates an SDK registration error and asserts the error message is shown to the operator.

## Out of scope

- Adding new contract fields to `MerchantOnboardingRequest`.
- Changing `createOnboardingRequest` to accept a `Location` object.
- Supporting multi-token registration at the contract level.
