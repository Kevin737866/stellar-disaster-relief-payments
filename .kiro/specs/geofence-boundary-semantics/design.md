# Design Document: Geofence Boundary Semantics

## Overview

This design formalizes the geofence boundary inclusion semantics for the `geo` module (`src/geo.rs`) and ensures public documentation (`docs/api-reference.md`) agrees with the implementation. The feature covers three concerns: (1) the inclusive `<=` comparison in `GeofenceZone::contains()` and `GeoPoint::is_within_radius()`, (2) the meter-to-kilometer unit conversion via `radius_km()`, and (3) the unit mismatch between `GeofenceZone.radius_meters` (meters) and `AidRegistry::Trigger.geofence_radius_km` (kilometers).

## Architecture

```
src/geo.rs
├── GeofenceZone (radius_meters: u32, inclusive boundary)
│   ├── contains() → distance_to() <= radius_meters / 1000.0
│   └── radius_km() → radius_meters as f64 / 1000.0
├── GeoPoint
│   ├── distance_to() → Haversine (EARTH_RADIUS_KM = 6371.0)
│   └── is_within_radius() → distance_to() <= radius_km
│
src/beneficiary_manager.rs
├── BeneficiaryIdentity.geofence_zones: Vec<GeofenceZone>
└── check_geofence() → iterates zones, calls zone.contains()
│
src/aid_registry.rs
├── Trigger.geofence_radius_km: u64  ← DIFFERENT UNIT (km, not meters)
│
src/merchant_network.rs
└── find_nearby_merchants() → distance_to() <= radius_km (f64 param)
│
src/supply_chain_tracker.rs
└── track_by_location() → distance_to() <= radius_km (f64 param)
│
docs/api-reference.md
└── "Geofence Utilities (geo module)" section
│
sdk/src/types.ts
├── GeofenceZone interface (radiusMeters: number)
└── latitude/longitude scaled by 1e6
```

The key design observation: `GeofenceZone` stores radius in **meters** (`u32`), while `AidRegistry::Trigger` stores radius in **kilometers** (`u64`). This is intentional — `AidRegistry::Trigger` geofences are configured via oracle triggers and the parameter is passed directly in km, whereas `GeofenceZone` is used for beneficiary safe zones where meter-level precision matters. The `radius_km()` helper bridges the two. This mismatch must be documented clearly but does not require a code change.

## Components and Interfaces

### GeofenceZone (src/geo.rs)

The central component. Stores radius in meters as `u32`. The `contains()` method performs an inclusive `<=` comparison between the Haversine distance (in km) and `radius_meters / 1000.0` (in km). The `radius_km()` helper converts meters to kilometers for interoperability with callers that work in km.

**No behavioral code changes required.** The current implementation already satisfies all behavioral requirements:
- `contains()` uses `self.center.distance_to(point) <= (self.radius_meters as f64 / 1000.0)` — inclusive `<=`.
- `radius_km()` returns `self.radius_meters as f64 / 1000.0`.

### GeoPoint (src/geo.rs)

The coordinate primitive. The `is_within_radius()` method performs an inclusive `<=` comparison between the Haversine distance and the provided `radius_km` parameter.

**No behavioral code changes required.** `is_within_radius()` uses `self.distance_to(center) <= radius_km` — inclusive `<=`.

### AidRegistry::Trigger (src/aid_registry.rs)

Stores geofence parameters for oracle-triggered fund releases. Uses `geofence_latitude: i64` (degrees × 1e6), `geofence_longitude: i64` (degrees × 1e6), and `geofence_radius_km: u64` (kilometers).

**Documentation change required:** Add a doc comment on the `geofence_radius_km` field stating the unit is kilometers, to match the existing documentation on `GeofenceZone.radius_meters` which states the unit is meters.

### API Reference (docs/api-reference.md)

The "Geofence Utilities (geo module)" section already documents the inclusive boundary, the scenario table, and the meter unit. The AidRegistry section's `add_trigger` parameter table lists `geofence_radius_km` but does not note the unit.

**Documentation change required:** Add a unit clarification note to the `add_trigger` parameter table in the AidRegistry section, noting `geofence_radius_km` is in kilometers (distinct from `GeofenceZone.radius_meters` which is in meters).

## Data Models

### GeofenceZone

```rust
pub struct GeofenceZone {
    pub zone_name: String,
    pub center: GeoPoint,        // f64 degrees (WGS84)
    pub radius_meters: u32,      // meters, not kilometers
    pub is_safe: bool,
}
```

- `radius_meters`: Stored as `u32` in meters. Converted to km via `radius_km()` (divides by 1000.0).
- `contains()` compares Haversine distance (km) against `radius_meters / 1000.0` (km). Inclusive `<=`.

### GeoPoint

```rust
pub struct GeoPoint {
    pub latitude: f64,   // [-90, 90]
    pub longitude: f64,  // [-180, 180]
}
```

- `distance_to()`: Haversine formula, returns km. Uses `EARTH_RADIUS_KM = 6371.0`.
- `is_within_radius()`: `distance_to(center) <= radius_km`. Inclusive `<=`.

### AidRegistry::Trigger (geofence fields only)

```rust
pub struct Trigger {
    // ...
    pub geofence_latitude: i64,   // degrees × 1e6
    pub geofence_longitude: i64,  // degrees × 1e6
    pub geofence_radius_km: u64,  // kilometers, NOT meters
    // ...
}
```

- Unit mismatch: `Trigger.geofence_radius_km` is in **kilometers**, while `GeofenceZone.radius_meters` is in **meters**. The `radius_km()` helper bridges the two. This is by design — oracle triggers use km, beneficiary safe zones use meters for precision.

### SDK TypeScript GeofenceZone (sdk/src/types.ts)

```typescript
export interface GeofenceZone {
  zoneName: string;
  latitude: number;       // Scaled by 1e6 for precision
  longitude: number;
  radiusMeters: number;
  isSafe: boolean;
}
```

- `radiusMeters` correctly reflects the on-chain meter unit. No change needed.

## Error Handling

No new error conditions are introduced by this feature. The geofence boundary logic is a pure boolean function with no failure modes — it always returns `true` or `false`. The `GeoPoint::new()` constructor can fail with an error string for out-of-range coordinates, but this is existing behavior and not modified by this feature.

## Correctness Properties

### Property 1: Inclusive Boundary

**Validates: Requirements 1.1, 1.2, 1.3, 2.1, 2.2, 2.3**

**Property:** For any `GeofenceZone` with center `c` and `radius_meters = r`, and any point `p`:
- If `distance_to(c, p) < r/1000.0` km → `contains(p) == true`
- If `distance_to(c, p) == r/1000.0` km → `contains(p) == true` (inclusive)
- If `distance_to(c, p) > r/1000.0` km → `contains(p) == false`

**How to test:** Deterministic example tests with points placed at known fractional offsets of the radius along the equator (where 1° longitude ≈ 111 km). The existing tests use 99%, 100%, and 101% of the radius offset. This is sufficient because the boundary behavior is a single `<=` comparison on f64 values — random fuzzing would only re-test f64 comparison, not our logic.

**Test type:** Example tests (not property-based). The behavior is a single `<=` comparison; 100 random iterations would not find more bugs than 3 carefully chosen points (inside, exact, outside). The Haversine formula itself is a well-known mathematical function, not our custom logic.

### Property 2: Method Agreement

**Validates: Requirements 2.4**

**Property:** For all `GeofenceZone` configurations and all points `p`:
```
zone.contains(p) == p.is_within_radius(zone.center, zone.radius_km())
```

**How to test:** The existing `test_contains_and_is_within_radius_agree` test checks this for inside, outside, and center points. This is sufficient because both methods use the identical `distance_to() <= threshold` comparison — the only difference is how the threshold is computed (`radius_meters / 1000.0` vs `radius_km()`), and `radius_km()` is defined as exactly `radius_meters as f64 / 1000.0`.

**Test type:** Example test with representative points. The agreement is a direct consequence of the definitions (`radius_km()` == `radius_meters / 1000.0`), so property-based testing would only re-test the division.

### Property 3: Unit Conversion Correctness

**Validates: Requirements 3.2, 3.3, 3.4, 3.5**

**Property:** `GeofenceZone::radius_km()` returns `radius_meters as f64 / 1000.0` for all `radius_meters: u32` values.

**How to test:** Specific examples (`1000 → 1.0`, `2000 → 2.0`) plus the unit conversion test that verifies a point at 1.9 km is inside a 2 km zone and a point at 2.1 km is outside. This verifies the conversion is used correctly in the comparison.

**Test type:** Example tests. The conversion is a single division by 1000.0; property-based testing on random u32 values would only re-test f64 division, not our logic.

### Property 4: Zero-Radius Edge Case

**Validates: Requirements 1.4**

**Property:** A `GeofenceZone` with `radius_meters = 0` returns `true` from `contains()` only for the center point (distance 0) and `false` for any point with distance > 0.

**How to test:** Construct a zero-radius zone, assert center is inside, assert a point at (0.001, 0.0) is outside.

**Test type:** Edge-case example test. This is a boundary condition that tests the `0 <= 0` case.

## Testing Strategy

| Requirement | Test Name | Type |
|---|---|---|
| 1.1, 2.1 | `test_geofence_boundary_exact_radius_inclusive` | Example |
| 1.2, 2.2 | `test_geofence_point_just_inside` | Example |
| 1.3, 2.3 | `test_geofence_point_just_outside` | Example |
| 1.4 | `test_geofence_zero_radius` | Edge case |
| 2.4 | `test_contains_and_is_within_radius_agree` | Example (consistency) |
| 3.2–3.5 | `test_geofence_radius_unit_conversion` | Example |
| 6.6 | `test_geofence_boundary_at_non_equatorial_latitude` | Example |

### Why not property-based testing

The geofence boundary logic is a single `<=` comparison between two f64 values (Haversine distance and the converted radius). The decision to include or exclude a point depends entirely on this comparison, which is:

1. **Not our code** — f64 comparison is a hardware/LLVM operation, not application logic we could break.
2. **Not input-dependent in a meaningful way** — the comparison `a <= b` produces the same boolean for any `a` and `b` of the same relative ordering; generating 100 random pairs would not find bugs that 3 carefully chosen pairs (a < b, a == b, a > b) don't also find.
3. **Low cost but zero marginal value** — 100 iterations test the same `<=` operator 100 times.

The Haversine formula itself is a well-known mathematical function. Testing it with random inputs against a reference implementation would be testing the formula's correctness, not our boundary semantics. The existing example tests use real-world coordinates (Port-au-Prince, equator, latitude 45°) that verify the formula works at different latitudes.

## Files to Modify

### `docs/api-reference.md`
- Add a unit clarification note to the `add_trigger` parameter table in the AidRegistry section, noting `geofence_radius_km` is in kilometers (distinct from `GeofenceZone.radius_meters` which is in meters).

### `src/aid_registry.rs`
- Add a doc comment on the `geofence_radius_km` field of the `Trigger` struct stating the unit is kilometers.

### `src/geo.rs`
- No code changes required. Existing implementation and tests already satisfy all behavioral requirements.
- Verify all existing tests pass (run `cargo test`).

### `sdk/src/types.ts`
- No changes required. The `GeofenceZone` interface already documents `radiusMeters: number`.
- The `emergencyFunds.ts` already uses `geofenceRadiusKm: number` which correctly reflects the km unit.
