# Requirements Document

## Introduction

This feature formalizes and tests the geofence boundary inclusion semantics used throughout the disaster-relief payment platform. The `geo` module provides shared geographic primitives (`GeoPoint`, `GeofenceZone`) consumed by `BeneficiaryManager`, `MerchantNetwork`, and `SupplyChainTracker`. Consumers need predictable behavior when a beneficiary or shipment is exactly on a safe-zone boundary; the result must not depend on floating-point rounding accidents.

The current code already uses an inclusive (`<=`) comparison in both `GeofenceZone::contains()` and `GeoPoint::is_within_radius()`, and the doc comments and API reference already state this. The goal of this feature is to lock that behavior down with formal requirements and deterministic tests, and to resolve a unit mismatch between `GeofenceZone` (meters) and `AidRegistry::Trigger` (kilometers) so the documented unit for the configured radius matches the implementation in every module that touches geofencing.

## Glossary

- **GeofenceZone**: A circular geographic zone defined by a center `GeoPoint`, a `radius_meters` field (in meters), a `zone_name` label, and an `is_safe` flag. Defined in `src/geo.rs`.
- **GeoPoint**: A geographic coordinate pair (latitude, longitude) in f64 degrees (WGS84). Defined in `src/geo.rs`.
- **radius_meters**: The radius of a `GeofenceZone`, stored as a `u32` in meters. Converted to kilometers via `GeofenceZone::radius_km()` which divides by 1000.0.
- **radius_km**: A radius expressed in kilometers, used as the direct parameter to `GeoPoint::is_within_radius()` and by `AidRegistry::Trigger.geofence_radius_km`.
- **Haversine distance**: The great-circle distance between two `GeoPoint` values, computed using the Haversine formula with `EARTH_RADIUS_KM = 6371.0` km. Returned by `GeoPoint::distance_to()` in kilometers.
- **Inclusive boundary**: A comparison semantics where a point whose distance from the center equals exactly the configured radius is considered inside the zone. Implemented with `<=`.
- **AidRegistry::Trigger**: A struct in `src/aid_registry.rs` that stores geofence parameters for oracle-triggered fund releases. Uses `geofence_latitude: i64` (degrees × 1e6), `geofence_longitude: i64` (degrees × 1e6), and `geofence_radius_km: u64` (kilometers).
- **check_geofence**: A function on `BeneficiaryManager` that checks whether a current location falls inside any safe `GeofenceZone` associated with a beneficiary identity.
- **API reference**: The document at `docs/api-reference.md` that documents the public interface of all smart contract modules and the TypeScript SDK.

## Requirements

### Requirement 1: Inclusive Boundary for GeofenceZone::contains

**User Story:** As a consumer of the geo module, I want a point at exactly the configured radius to be considered inside the geofence, so that boundary cases produce deterministic results regardless of floating-point rounding.

#### Acceptance Criteria

1. WHEN a point's Haversine distance from the zone center equals exactly `radius_meters / 1000.0` km, THE GeofenceZone SHALL return `true` from `contains()`.
2. WHEN a point's Haversine distance from the zone center is less than `radius_meters / 1000.0` km, THE GeofenceZone SHALL return `true` from `contains()`.
3. WHEN a point's Haversine distance from the zone center is greater than `radius_meters / 1000.0` km, THE GeofenceZone SHALL return `false` from `contains()`.
4. WHEN the zone has a `radius_meters` of zero, THE GeofenceZone SHALL return `true` from `contains()` only for the center point itself and `false` for any other point.

### Requirement 2: Inclusive Boundary for GeoPoint::is_within_radius

**User Story:** As a consumer of the geo module, I want the standalone radius check helper to use the same inclusive boundary semantics as GeofenceZone, so that both code paths produce consistent results for the same point.

#### Acceptance Criteria

1. WHEN a point's Haversine distance from the center equals exactly `radius_km`, THE GeoPoint SHALL return `true` from `is_within_radius()`.
2. WHEN a point's Haversine distance from the center is less than `radius_km`, THE GeoPoint SHALL return `true` from `is_within_radius()`.
3. WHEN a point's Haversine distance from the center is greater than `radius_km`, THE GeoPoint SHALL return `false` from `is_within_radius()`.
4. FOR ALL points and all GeofenceZone configurations, `GeofenceZone::contains(point)` SHALL return the same boolean value as `point.is_within_radius(zone.center, zone.radius_km())`.

### Requirement 3: Radius Unit Conversion Correctness

**User Story:** As a developer integrating the geo module, I want the documented unit for the configured radius to match the implementation, so that callers do not accidentally compare meters against kilometers.

#### Acceptance Criteria

1. THE GeofenceZone SHALL store `radius_meters` in meters (u32).
2. THE GeofenceZone::radius_km() SHALL return `radius_meters as f64 / 1000.0`.
3. WHEN `radius_meters` is 1000, THE GeofenceZone::radius_km() SHALL return 1.0 within floating-point tolerance (|result - 1.0| < 1e-9).
4. WHEN `radius_meters` is 2000, THE GeofenceZone::radius_km() SHALL return 2.0 within floating-point tolerance (|result - 2.0| < 1e-9).
5. THE GeofenceZone::contains() SHALL compare the Haversine distance in kilometers against `radius_meters / 1000.0` km, not against `radius_meters` directly.

### Requirement 4: Cross-Module Unit Consistency Documentation

**User Story:** As a developer working across AidRegistry and the geo module, I want the unit difference between `GeofenceZone.radius_meters` (meters) and `AidRegistry::Trigger.geofence_radius_km` (kilometers) to be documented, so that I do not confuse the two representations.

#### Acceptance Criteria

1. THE API reference SHALL document that `GeofenceZone.radius_meters` is measured in meters.
2. THE API reference SHALL document that `AidRegistry::Trigger.geofence_radius_km` is measured in kilometers.
3. THE API reference SHALL document that `GeofenceZone::radius_km()` converts meters to kilometers and returns the equivalent value.
4. THE doc comment on `GeofenceZone` SHALL state that `radius_meters` is measured in meters (not kilometers).
5. THE doc comment on `AidRegistry::Trigger.geofence_radius_km` field SHALL state that the unit is kilometers.

### Requirement 5: Boundary Inclusion Documentation Agreement

**User Story:** As a consumer reading the API reference, I want the documented boundary semantics to match the actual implementation behavior, so that I can rely on the documentation for integration decisions.

#### Acceptance Criteria

1. THE API reference SHALL state that `GeofenceZone::contains()` uses an inclusive boundary (a point at exactly the configured radius is inside).
2. THE API reference SHALL state that `GeoPoint::is_within_radius()` uses an inclusive boundary (a point at exactly `radius_km` is inside).
3. THE API reference SHALL include a scenario table showing the result for a point at exactly the radius, a point just inside, and a point just outside.
4. THE doc comment on `GeofenceZone::contains()` SHALL state that the comparison is `distance_km <= radius_meters / 1000.0` and that the boundary is inclusive.
5. THE doc comment on `GeoPoint::is_within_radius()` SHALL state that the comparison is `distance <= radius_km` and that the boundary is inclusive.

### Requirement 6: Deterministic Boundary and Unit-Conversion Tests

**User Story:** As a developer maintaining the geo module, I want deterministic tests that verify the boundary inclusion semantics and unit conversion at specific known points, so that regressions are caught before deployment.

#### Acceptance Criteria

1. THE test suite SHALL include a test that constructs a point at approximately the configured radius and asserts that `contains()` returns `true` (inclusive boundary).
2. THE test suite SHALL include a test that constructs a point just inside the radius and asserts that `contains()` returns `true`.
3. THE test suite SHALL include a test that constructs a point just outside the radius and asserts that `contains()` returns `false`.
4. THE test suite SHALL include a test that verifies `radius_km()` returns the correct kilometer value for a given `radius_meters` value.
5. THE test suite SHALL include a test that verifies `contains()` and `is_within_radius()` agree for inside points, outside points, and the center point.
6. THE test suite SHALL include a test that verifies inclusive boundary behavior at a non-equatorial latitude.
7. THE test suite SHALL include a test that verifies a zero-radius geofence includes only the center point.
