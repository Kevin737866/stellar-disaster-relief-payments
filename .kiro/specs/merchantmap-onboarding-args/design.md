# Design: MerchantMap Onboarding Argument Fix

## Overview

Three changes to `ui/src/components/MerchantMap.tsx`:

1. **Fix the `createOnboardingRequest` call** — pass the correct eleven arguments; derive `category` from `businessType`; build `locationLatLng` from the form's latitude and longitude strings.
2. **Remove unsupported form controls** — drop `stellarAddress`, `dailyLimit`, `monthlyLimit`, `acceptedTokens`, `facilityName`, and `contactPerson` from form state and JSX.
3. **Improve error display** — include the SDK error reason in the failure message.

No changes to `merchantClient.ts` or any type definitions.

## The Bug

```typescript
// BEFORE — wrong position, wrong types
const request = merchantClient.createOnboardingRequest(
  onboardingForm.name,          // ✓ name: string
  onboardingForm.businessType,  // ✓ businessType: string
  location,                     // ✗ arg 3 must be category: number, not Location
  onboardingForm.contactInfo,   // ✗ arg 4 must be locationLatLng: string
  onboardingForm.stellarAddress // ✗ arg 5 must be locationAddress: string
  // args 6-11 missing entirely
);
```

## The Fix

```typescript
// AFTER — all 11 args, correct types
const lat = parseFloat(onboardingForm.location.latitude);
const lng = parseFloat(onboardingForm.location.longitude);
const locationLatLng = `${lat},${lng}`;
const category = BUSINESS_TYPE_TO_CATEGORY[onboardingForm.businessType] ?? 0;

const request = merchantClient.createOnboardingRequest(
  onboardingForm.name,
  onboardingForm.businessType,
  category,
  locationLatLng,
  onboardingForm.location.address,
  onboardingForm.location.city,
  onboardingForm.location.country,
  onboardingForm.location.postalCode,
  onboardingForm.contactInfo,
  [],    // vouchers — none collected by this form
  false  // emergencyFastTrack — not exposed by this form
);
```

## Category Mapping

Add a file-local constant in `MerchantMap.tsx`:

```typescript
const BUSINESS_TYPE_TO_CATEGORY: Record<string, number> = {
  grocery:       0, // food
  hardware:      0, // food (closest general)
  restaurant:    0, // food
  transport:     0, // general fallback
  communication: 0, // general fallback
  pharmacy:      3, // medical
  fuel_station:  5, // fuel
  clothing:      4, // clothing
};
```

Unknown values fall back to `0` via `?? 0`.

## Unsupported Fields

| Field | Current state | Action |
|---|---|---|
| `stellarAddress` | Collected, passed as arg 5 (wrong position) | Remove from form state and JSX |
| `acceptedTokens` | Collected, never passed to SDK | Remove from form state and JSX |
| `dailyLimit` | Collected, never passed to SDK | Remove from form state and JSX |
| `monthlyLimit` | Collected, never passed to SDK | Remove from form state and JSX |
| `location.facilityName` | In state, no matching field | Remove from form state and JSX |
| `location.contactPerson` | In state, no matching field | Remove from form state and JSX |

## Form State After Fix

```typescript
const [onboardingForm, setOnboardingForm] = useState({
  merchantId: '',
  name: '',
  businessType: 'grocery',
  contactInfo: '',
  location: {
    latitude: '',
    longitude: '',
    address: '',
    city: '',
    country: '',
    postalCode: '',
  }
});
```

## Error Handling

```typescript
} catch (error: any) {
  console.error('Failed to onboard merchant:', error);
  alert(`Failed to register merchant: ${error?.message ?? error}`);
}
```

## Files to Modify

| File | Change |
|---|---|
| `ui/src/components/MerchantMap.tsx` | Fix `handleOnboarding`, add category map, remove unsupported fields |
| `ui/src/__tests__/merchantOnboarding.test.tsx` | New test file |

## Testing Strategy

| Requirement | Test |
|---|---|
| 1.1 — all 11 args in order | Mock `createOnboardingRequest`, submit form, check call args |
| 1.2 — locationLatLng format | Assert arg[3] === `"${lat},${lng}"` |
| 2.1 — category mapping | 4 cases: grocery→0, pharmacy→3, fuel_station→5, clothing→4 |
| 4.2 — error shown to operator | Mock `registerMerchant` to reject; assert error text visible |
