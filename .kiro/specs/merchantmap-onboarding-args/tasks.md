# Tasks: MerchantMap Onboarding Argument Fix

## Tasks

- [x] 1. Add category mapping constant and fix handleOnboarding
  - [x] 1.1 Add `BUSINESS_TYPE_TO_CATEGORY` constant in `MerchantMap.tsx`
  - [x] 1.2 Fix `createOnboardingRequest` call to pass all 11 args in correct order
  - [x] 1.3 Build `locationLatLng` as `"${lat},${lng}"` string from form fields
  - [x] 1.4 Improve error message to include SDK error reason

- [x] 2. Remove unsupported form state and controls
  - [x] 2.1 Remove `stellarAddress`, `acceptedTokens`, `dailyLimit`, `monthlyLimit` from form state
  - [x] 2.2 Remove `facilityName` and `contactPerson` from location sub-object in form state
  - [x] 2.3 Remove the corresponding JSX input controls from the form

- [x] 3. Add tests
  - [x] 3.1 Create `ui/src/__tests__/merchantOnboarding.test.tsx`
  - [x] 3.2 Test: valid submission calls `createOnboardingRequest` with correct 11 args
  - [x] 3.3 Test: `locationLatLng` built as `"lat,lng"` from separate fields
  - [x] 3.4 Test: category mapping for grocery→0, pharmacy→3, fuel_station→5, clothing→4
  - [x] 3.5 Test: SDK error shown to operator

## Task Dependency Graph

```json
{
  "waves": [
    { "tasks": [1.1, 2.1, 2.2] },
    { "tasks": [1.2, 1.3, 1.4, 2.3] },
    { "tasks": [3.1] },
    { "tasks": [3.2, 3.3, 3.4, 3.5] }
  ]
}
```
