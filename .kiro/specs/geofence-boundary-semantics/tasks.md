# Implementation Plan: Geofence Boundary Semantics

## Overview

This plan formalizes and tests the geofence boundary inclusion semantics for the geo module. The implementation is primarily documentation changes plus verification that the existing code and test suite satisfy all requirements. No behavioral code changes are needed.

## Tasks

- [ ] 1. Documentation: AidRegistry geofence_radius_km unit clarification
  - [ ] 1.1 Add doc comment to geofence_radius_km field on Trigger struct in src/aid_registry.rs stating the unit is kilometers
    - **Validates:** Requirement 4.5
  - [ ] 1.2 Add unit clarification note to add_trigger parameter table in docs/api-reference.md AidRegistry section
    - **Validates:** Requirement 4.2

- [ ] 2. Verify existing tests cover all acceptance criteria
  - [ ] 2.1 Verify test_geofence_boundary_exact_radius_inclusive exists and tests inclusive boundary at exact radius
    - **Validates:** Requirements 1.1, 2.1, 6.1
  - [ ] 2.2 Verify test_geofence_point_just_inside exists and tests point just inside radius
    - **Validates:** Requirements 1.2, 2.2, 6.2
  - [ ] 2.3 Verify test_geofence_point_just_outside exists and tests point just outside radius
    - **Validates:** Requirements 1.3, 2.3, 6.3
  - [ ] 2.4 Verify test_geofence_radius_unit_conversion exists and tests meter-to-km conversion
    - **Validates:** Requirements 3.2, 3.3, 3.4, 3.5, 6.4
  - [ ] 2.5 Verify test_contains_and_is_within_radius_agree exists and tests method agreement
    - **Validates:** Requirements 2.4, 6.5
  - [ ] 2.6 Verify test_geofence_zero_radius exists and tests zero-radius edge case
    - **Validates:** Requirements 1.4, 6.7
  - [ ] 2.7 Verify test_geofence_boundary_at_non_equatorial_latitude exists and tests boundary at latitude 45
    - **Validates:** Requirement 6.6

- [ ] 3. Verify documentation agreement
  - [ ] 3.1 Verify docs/api-reference.md Geofence Utilities section documents inclusive boundary with scenario table
    - **Validates:** Requirements 5.1, 5.3
  - [ ] 3.2 Verify docs/api-reference.md documents is_within_radius() as inclusive
    - **Validates:** Requirement 5.2
  - [ ] 3.3 Verify docs/api-reference.md documents radius_meters is in meters and radius_km() returns km
    - **Validates:** Requirements 4.1, 4.3
  - [ ] 3.4 Verify GeofenceZone doc comment states radius_meters is in meters
    - **Validates:** Requirement 4.4
  - [ ] 3.5 Verify GeofenceZone::contains() doc comment states inclusive comparison
    - **Validates:** Requirement 5.4
  - [ ] 3.6 Verify GeoPoint::is_within_radius() doc comment states inclusive comparison
    - **Validates:** Requirement 5.5

- [ ] 4. Run existing test suite
  - [ ] 4.1 Run cargo test and confirm all geofence boundary and unit-conversion tests pass
    - **Validates:** Requirement 6 (all sub-items)

## Notes

- No behavioral code changes are required. The existing implementation already uses inclusive comparisons.
- The existing test suite already contains all required boundary and unit-conversion tests.
- The main work is adding a doc comment to geofence_radius_km and a unit note in the API reference.
- The unit mismatch between radius_meters and geofence_radius_km is by design and requires only documentation.

## Task Dependency Graph

```json
{
  "waves": [
    {
      "tasks": [1.1, 1.2, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6]
    },
    {
      "tasks": [4.1]
    }
  ]
}
```

All tasks in wave 1 are independent. Wave 2 depends on wave 1 completion.
