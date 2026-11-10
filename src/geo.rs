use soroban_sdk::{Env, String, f64};

/// Standardized geographic data representation and conversion utilities.
///
/// Internal representation: f64 degrees (WGS84)
/// - Latitude: finite values in [-90.0, 90.0]
/// - Longitude: finite values in [-180.0, 180.0]
///
/// Storage & serialization formats:
/// - Contract storage: `GeoPoint` (f64 lat, f64 lng)
/// - External APIs: decimal degree string `"lat,lng"` (whitespace trimmed)
/// - Legacy migration: `from_scaled_i64(i64, i64)` for 1e6 microdegree integers
///
/// Boundary semantics:
/// - Spatial radius checks (`is_within_radius` and `GeofenceZone::contains`) are
///   **inclusive** of the boundary within `BOUNDARY_EPSILON_KM` (1e-9 km) so
///   exact-radius points do not fail from floating-point rounding.
/// - `GeoBounds` represents antimeridian-crossing longitude intervals by
///   wrapping `min_lng` and `max_lng` into `[-180, 180]` with `min_lng > max_lng`,
///   representing `[min_lng, 180.0] U [-180.0, max_lng]`.

/// Scaling factor for legacy integer coordinate storage (1e6)
pub const COORD_SCALE_FACTOR: i64 = 1_000_000;

/// Maximum valid coordinate values
pub const MAX_LATITUDE: f64 = 90.0;
pub const MIN_LATITUDE: f64 = -90.0;
pub const MAX_LONGITUDE: f64 = 180.0;
pub const MIN_LONGITUDE: f64 = -180.0;

/// Earth's radius in kilometers (WGS84 mean radius)
pub const EARTH_RADIUS_KM: f64 = 6371.0;

/// Tolerance in kilometers (1 nanometer) applied to inclusive boundary checks
/// so exact-boundary coordinates are unaffected by Haversine ULP rounding.
pub const BOUNDARY_EPSILON_KM: f64 = 1e-9;

fn validate_radius_km(radius_km: f64) -> Result<f64, String> {
    if !radius_km.is_finite() || radius_km < 0.0 {
        return Err(String::from_str(&Env::default(), "Radius must be finite and non-negative"));
    }
    Ok(radius_km)
}

fn wrap_longitude(lng: f64) -> f64 {
    let mut wrapped = ((lng + 180.0).rem_euclid(360.0)) - 180.0;
    if wrapped == -180.0 && lng > 0.0 {
        wrapped = 180.0;
    }
    if wrapped == 0.0 {
        0.0
    } else {
        wrapped
    }
}

/// Standardized geographic point using f64 degrees
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct GeoPoint {
    pub latitude: f64,
    pub longitude: f64,
}

impl GeoPoint {
    /// Create a new GeoPoint with finite and range validation
    pub fn new(latitude: f64, longitude: f64) -> Result<Self, String> {
        if !latitude.is_finite() || latitude < MIN_LATITUDE || latitude > MAX_LATITUDE {
            return Err(String::from_str(
                &Env::default(),
                "Latitude must be finite and within [-90, 90]",
            ));
        }
        if !longitude.is_finite() || longitude < MIN_LONGITUDE || longitude > MAX_LONGITUDE {
            return Err(String::from_str(
                &Env::default(),
                "Longitude must be finite and within [-180, 180]",
            ));
        }
        let clean_lat = if latitude == 0.0 { 0.0 } else { latitude };
        let clean_lng = if longitude == 0.0 { 0.0 } else { longitude };
        Ok(GeoPoint {
            latitude: clean_lat,
            longitude: clean_lng,
        })
    }

    /// Create validated GeoPoint from scaled integers (1e6 = microdegrees).
    /// Used for migration from legacy i64 storage.
    pub fn from_scaled_i64(lat_scaled: i64, lng_scaled: i64) -> Result<Self, String> {
        Self::new(
            lat_scaled as f64 / COORD_SCALE_FACTOR as f64,
            lng_scaled as f64 / COORD_SCALE_FACTOR as f64,
        )
    }

    /// Convert to scaled integer for legacy storage compatibility
    pub fn to_scaled_i64(&self) -> (i64, i64) {
        (
            (self.latitude * COORD_SCALE_FACTOR as f64).round() as i64,
            (self.longitude * COORD_SCALE_FACTOR as f64).round() as i64,
        )
    }

    /// Parse from `"lat,lng"` (or `"lat, lng"`) decimal degree string
    pub fn from_string(env: &Env, s: &String) -> Result<Self, String> {
        let str_val = s.to_string();
        let mut parts = str_val.split(',');
        let raw_lat = match parts.next() {
            Some(p) => p.trim(),
            None => return Err(String::from_str(env, "Invalid coordinate format, expected 'lat,lng'")),
        };
        let raw_lng = match parts.next() {
            Some(p) => p.trim(),
            None => return Err(String::from_str(env, "Invalid coordinate format, expected 'lat,lng'")),
        };
        if parts.next().is_some() || raw_lat.is_empty() || raw_lng.is_empty() {
            return Err(String::from_str(env, "Invalid coordinate format, expected 'lat,lng'"));
        }
        let lat = raw_lat
            .parse::<f64>()
            .map_err(|_| String::from_str(env, "Invalid latitude"))?;
        let lng = raw_lng
            .parse::<f64>()
            .map_err(|_| String::from_str(env, "Invalid longitude"))?;
        Self::new(lat, lng)
    }

    /// Convert to canonical `"lat,lng"` string format
    pub fn to_string(&self, env: &Env) -> String {
        let lat = if self.latitude == 0.0 { 0.0 } else { self.latitude };
        let lng = if self.longitude == 0.0 { 0.0 } else { self.longitude };
        String::from_str(env, &format!("{},{}", lat, lng))
    }

    /// Calculate distance to another point using Haversine formula (returns km)
    pub fn distance_to(&self, other: &GeoPoint) -> f64 {
        let r = EARTH_RADIUS_KM;
        let dlat = (other.latitude - self.latitude).to_radians();
        let dlon = (other.longitude - self.longitude).to_radians();
        let a = (dlat / 2.0).sin().powi(2)
            + self.latitude.to_radians().cos()
                * other.latitude.to_radians().cos()
                * (dlon / 2.0).sin().powi(2);
        let a_clamped = a.min(1.0).max(0.0);
        let c = 2.0 * a_clamped.sqrt().atan2((1.0 - a_clamped).sqrt());
        r * c
    }

    /// Check if point is within radius (km) of `center` (inclusive boundary semantics).
    /// Zero radius matches only the same coordinate (within `BOUNDARY_EPSILON_KM`).
    /// Returns an error if `radius_km` is negative, NaN, or infinite.
    pub fn is_within_radius(&self, center: &GeoPoint, radius_km: f64) -> Result<bool, String> {
        let valid_radius = validate_radius_km(radius_km)?;
        Ok(self.distance_to(center) <= valid_radius + BOUNDARY_EPSILON_KM)
    }

    /// Calculate bounding box `(min_lat, max_lat, min_lng, max_lng)` for `radius_km`.
    /// When the box crosses the antimeridian (+/-180), `min_lng > max_lng` represents the
    /// wrapped union `[min_lng, 180.0] U [-180.0, max_lng]`.
    pub fn bounding_box(&self, radius_km: f64) -> Result<(f64, f64, f64, f64), String> {
        let valid_radius = validate_radius_km(radius_km)?;
        // 1 degree latitude ~= 111 km
        let lat_delta = valid_radius / 111.0;
        // 1 degree longitude ~= 111 km * cos(lat)
        let lng_delta = valid_radius / (111.0 * self.latitude.to_radians().cos().max(0.1));

        let min_lat = (self.latitude - lat_delta).max(MIN_LATITUDE);
        let max_lat = (self.latitude + lat_delta).min(MAX_LATITUDE);

        let (min_lng, max_lng) = if lng_delta >= 180.0 {
            (MIN_LONGITUDE, MAX_LONGITUDE)
        } else {
            let raw_min = self.longitude - lng_delta;
            let raw_max = self.longitude + lng_delta;
            if raw_min < MIN_LONGITUDE || raw_max > MAX_LONGITUDE {
                (wrap_longitude(raw_min), wrap_longitude(raw_max))
            } else {
                (raw_min, raw_max)
            }
        };

        Ok((min_lat, max_lat, min_lng, max_lng))
    }
}

/// Geographic bounding box for spatial queries.
///
/// When `min_lng > max_lng`, the longitude span wraps across the antimeridian
/// (`[min_lng, 180.0] U [-180.0, max_lng]`).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct GeoBounds {
    pub min_lat: f64,
    pub max_lat: f64,
    pub min_lng: f64,
    pub max_lng: f64,
}

impl GeoBounds {
    pub fn new(min_lat: f64, max_lat: f64, min_lng: f64, max_lng: f64) -> Self {
        GeoBounds {
            min_lat,
            max_lat,
            min_lng,
            max_lng,
        }
    }

    /// Create bounds from center point and non-negative finite radius in km
    pub fn from_radius(center: &GeoPoint, radius_km: f64) -> Result<Self, String> {
        let (min_lat, max_lat, min_lng, max_lng) = center.bounding_box(radius_km)?;
        Ok(GeoBounds::new(min_lat, max_lat, min_lng, max_lng))
    }

    /// Returns true when the longitude interval crosses the antimeridian (+/-180)
    pub fn wraps_antimeridian(&self) -> bool {
        self.min_lng > self.max_lng
    }

    /// Split longitude interval into one (non-wrapping) or two (antimeridian-wrapping) `[lo, hi]` spans
    fn lng_segments(&self) -> [(f64, f64); 2] {
        if self.wraps_antimeridian() {
            [(self.min_lng, MAX_LONGITUDE), (MIN_LONGITUDE, self.max_lng)]
        } else {
            [(self.min_lng, self.max_lng), (self.min_lng, self.max_lng)]
        }
    }

    /// Check if a point is within bounds (inclusive of boundaries and antimeridian wrap)
    pub fn contains(&self, point: &GeoPoint) -> bool {
        let lat_ok = point.latitude >= self.min_lat && point.latitude <= self.max_lat;
        if !lat_ok {
            return false;
        }
        if self.wraps_antimeridian() {
            point.longitude >= self.min_lng || point.longitude <= self.max_lng
        } else {
            point.longitude >= self.min_lng && point.longitude <= self.max_lng
        }
    }

    /// Check if bounds intersect with another bounds (supports antimeridian wrap)
    pub fn intersects(&self, other: &GeoBounds) -> bool {
        if self.min_lat > other.max_lat || self.max_lat < other.min_lat {
            return false;
        }
        let segs_a = self.lng_segments();
        let segs_b = other.lng_segments();
        for (a_lo, a_hi) in segs_a.iter() {
            for (b_lo, b_hi) in segs_b.iter() {
                if a_lo <= b_hi && a_hi >= b_lo {
                    return true;
                }
            }
        }
        false
    }
}

/// Geofence zone with circular boundary (`radius_meters` stored in meters)
#[derive(Clone, Debug)]
pub struct GeofenceZone {
    pub zone_name: String,
    pub center: GeoPoint,
    pub radius_meters: u32,
    pub is_safe: bool,
}

impl GeofenceZone {
    /// Create a new geofence zone
    pub fn new(zone_name: String, center: GeoPoint, radius_meters: u32, is_safe: bool) -> Self {
        GeofenceZone {
            zone_name,
            center,
            radius_meters,
            is_safe,
        }
    }

    /// Create validated zone from legacy scaled integer format
    pub fn from_scaled(
        _env: &Env,
        zone_name: String,
        lat_scaled: i64,
        lng_scaled: i64,
        radius_meters: u32,
        is_safe: bool,
    ) -> Result<Self, String> {
        let center = GeoPoint::from_scaled_i64(lat_scaled, lng_scaled)?;
        Ok(GeofenceZone {
            zone_name,
            center,
            radius_meters,
            is_safe,
        })
    }

    /// Convert to legacy scaled integer format
    pub fn to_scaled(&self) -> (String, i64, i64, u32, bool) {
        let (lat_scaled, lng_scaled) = self.center.to_scaled_i64();
        (
            self.zone_name.clone(),
            lat_scaled,
            lng_scaled,
            self.radius_meters,
            self.is_safe,
        )
    }

    /// Check if a point is within this geofence (inclusive boundary: `distance <= radius_km + BOUNDARY_EPSILON_KM`).
    pub fn contains(&self, point: &GeoPoint) -> bool {
        self.center.distance_to(point) <= self.radius_km() + BOUNDARY_EPSILON_KM
    }

    /// Get radius in kilometers
    pub fn radius_km(&self) -> f64 {
        self.radius_meters as f64 / 1000.0
    }
}

/// Address/location string utilities
pub struct GeoFormatter;

impl GeoFormatter {
    /// Format GeoPoint as `"lat, lng"` (human readable, 6 decimal places)
    pub fn format_point(point: &GeoPoint, env: &Env) -> String {
        String::from_str(env, &format!("{:.6}, {:.6}", point.latitude, point.longitude))
    }

    /// Format GeoPoint as `"lat,lng"` (compact, 6 decimal places)
    pub fn format_compact(point: &GeoPoint, env: &Env) -> String {
        String::from_str(env, &format!("{:.6},{:.6}", point.latitude, point.longitude))
    }

    /// Parse coordinate string (accepts `"lat,lng"` or `"lat, lng"`)
    pub fn parse_point(env: &Env, s: &String) -> Result<GeoPoint, String> {
        GeoPoint::from_string(env, s)
    }
}

/// Migration helpers for legacy coordinate formats
pub struct GeoMigration;

impl GeoMigration {
    /// Convert legacy i64 (scaled by 1e6) to validated GeoPoint
    pub fn from_legacy_i64(lat_scaled: i64, lng_scaled: i64) -> Result<GeoPoint, String> {
        GeoPoint::from_scaled_i64(lat_scaled, lng_scaled)
    }

    /// Convert GeoPoint to legacy i64 (scaled by 1e6)
    pub fn to_legacy_i64(point: &GeoPoint) -> (i64, i64) {
        point.to_scaled_i64()
    }

    /// Convert legacy GeofenceZone to validated standardized format
    pub fn migrate_geofence(
        env: &Env,
        zone_name: String,
        lat_scaled: i64,
        lng_scaled: i64,
        radius_meters: u32,
        is_safe: bool,
    ) -> Result<GeofenceZone, String> {
        GeofenceZone::from_scaled(env, zone_name, lat_scaled, lng_scaled, radius_meters, is_safe)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_geopoint_creation() {
        let point = GeoPoint::new(18.5944, -72.3074).unwrap();
        assert!((point.latitude - 18.5944).abs() < 0.0001);
        assert!((point.longitude - (-72.3074)).abs() < 0.0001);
    }

    #[test]
    fn test_geopoint_validation_extrema_and_non_finite() {
        // Out of range
        assert!(GeoPoint::new(91.0, 0.0).is_err());
        assert!(GeoPoint::new(-91.0, 0.0).is_err());
        assert!(GeoPoint::new(0.0, 181.0).is_err());
        assert!(GeoPoint::new(0.0, -181.0).is_err());

        // Non-finite coordinates (#287)
        assert!(GeoPoint::new(f64::NAN, 0.0).is_err());
        assert!(GeoPoint::new(0.0, f64::NAN).is_err());
        assert!(GeoPoint::new(f64::INFINITY, 0.0).is_err());
        assert!(GeoPoint::new(f64::NEG_INFINITY, 0.0).is_err());
        assert!(GeoPoint::new(0.0, f64::INFINITY).is_err());
        assert!(GeoPoint::new(0.0, f64::NEG_INFINITY).is_err());

        // Valid extrema remain accepted
        assert!(GeoPoint::new(90.0, 180.0).is_ok());
        assert!(GeoPoint::new(-90.0, -180.0).is_ok());
        assert!(GeoPoint::new(90.0, -180.0).is_ok());
        assert!(GeoPoint::new(-90.0, 180.0).is_ok());
    }

    #[test]
    fn test_scaled_conversion_and_validation() {
        let point = GeoPoint::new(18.5944, -72.3074).unwrap();
        let (lat_scaled, lng_scaled) = point.to_scaled_i64();
        let restored = GeoPoint::from_scaled_i64(lat_scaled, lng_scaled).unwrap();
        assert!((restored.latitude - point.latitude).abs() < 0.000001);
        assert!((restored.longitude - point.longitude).abs() < 0.000001);

        // Boundaries and negative scaled coordinates (#289)
        let boundary = GeoPoint::from_scaled_i64(-90_000_000, 180_000_000).unwrap();
        assert_eq!(boundary.latitude, -90.0);
        assert_eq!(boundary.longitude, 180.0);

        // Out-of-range scaled values fail explicitly
        assert!(GeoPoint::from_scaled_i64(90_000_001, 0).is_err());
        assert!(GeoPoint::from_scaled_i64(-90_000_001, 0).is_err());
        assert!(GeoPoint::from_scaled_i64(0, 180_000_001).is_err());
        assert!(GeoMigration::from_legacy_i64(0, -180_000_001).is_err());

        let env = Env::default();
        assert!(GeoMigration::migrate_geofence(
            &env,
            String::from_str(&env, "Bad"),
            95_000_000,
            0,
            500,
            true
        )
        .is_err());
    }

    #[test]
    fn test_haversine_distance() {
        // Port-au-Prince to Cap-Haitien (~130 km)
        let p1 = GeoPoint::new(18.5944, -72.3074).unwrap();
        let p2 = GeoPoint::new(19.7589, -72.2028).unwrap();
        let distance = p1.distance_to(&p2);
        assert!((distance - 130.0).abs() < 10.0);
    }

    #[test]
    fn test_bounding_box_and_antimeridian_wrap() {
        // Ordinary non-wrapping bounds (#288)
        let center = GeoPoint::new(18.5944, -72.3074).unwrap();
        let bounds = GeoBounds::from_radius(&center, 10.0).unwrap();
        assert!(!bounds.wraps_antimeridian());
        assert!(bounds.contains(&center));
        let nearby = GeoPoint::new(18.6, -72.3).unwrap();
        assert!(bounds.contains(&nearby));
        let far = GeoPoint::new(19.0, -72.0).unwrap();
        assert!(!bounds.contains(&far));

        // Centered just west of +180 includes nearby point across -180
        let east_center = GeoPoint::new(0.0, 179.9).unwrap();
        let east_bounds = GeoBounds::from_radius(&east_center, 50.0).unwrap();
        assert!(east_bounds.wraps_antimeridian());
        let across_west = GeoPoint::new(0.0, -179.9).unwrap();
        let far_mid = GeoPoint::new(0.0, 0.0).unwrap();
        assert!(east_bounds.contains(&east_center));
        assert!(east_bounds.contains(&across_west));
        assert!(!east_bounds.contains(&far_mid));

        // Symmetric case centered just east of -180 includes point at +179.9
        let west_center = GeoPoint::new(0.0, -179.9).unwrap();
        let west_bounds = GeoBounds::from_radius(&west_center, 50.0).unwrap();
        assert!(west_bounds.wraps_antimeridian());
        let across_east = GeoPoint::new(0.0, 179.9).unwrap();
        assert!(west_bounds.contains(&across_east));
        assert!(east_bounds.intersects(&west_bounds));
    }

    #[test]
    fn test_radius_validation() {
        let p1 = GeoPoint::new(18.5944, -72.3074).unwrap();
        let same = GeoPoint::new(18.5944, -72.3074).unwrap();
        let other = GeoPoint::new(18.6044, -72.3074).unwrap();

        // Valid positive radius
        assert!(p1.is_within_radius(&other, 5.0).unwrap());
        assert!(p1.bounding_box(5.0).is_ok());
        assert!(GeoBounds::from_radius(&p1, 5.0).is_ok());

        // Zero radius matches only exact same point
        assert!(p1.is_within_radius(&same, 0.0).unwrap());
        assert!(!p1.is_within_radius(&other, 0.0).unwrap());
        assert!(p1.bounding_box(0.0).is_ok());
        assert!(GeoBounds::from_radius(&p1, 0.0).is_ok());

        // Negative and non-finite radii are rejected across all public helpers (#290)
        for bad in [-1.0, -0.001, f64::NAN, f64::INFINITY, f64::NEG_INFINITY] {
            assert!(p1.is_within_radius(&other, bad).is_err());
            assert!(p1.bounding_box(bad).is_err());
            assert!(GeoBounds::from_radius(&p1, bad).is_err());
        }
    }

    #[test]
    fn test_geofence_zone_and_exact_boundary_semantics() {
        let env = Env::default();
        let center = GeoPoint::new(0.0, 0.0).unwrap();
        let zone = GeofenceZone::new(
            String::from_str(&env, "Camp Alpha"),
            center,
            5000, // 5 km
            true,
        );
        assert_eq!(zone.radius_km(), 5.0);

        // Compute exact latitude offset corresponding to 5.0 km on the prime meridian
        let exact_deg = (5.0 / EARTH_RADIUS_KM).to_degrees();
        let on_boundary = GeoPoint::new(exact_deg, 0.0).unwrap();
        let inside = GeoPoint::new(exact_deg * 0.99, 0.0).unwrap();
        let outside = GeoPoint::new(exact_deg * 1.01, 0.0).unwrap();

        // Inclusive boundary semantics (#292)
        assert!(zone.contains(&inside));
        assert!(zone.contains(&on_boundary));
        assert!(on_boundary.is_within_radius(&center, 5.0).unwrap());
        assert!(!zone.contains(&outside));
    }

    #[test]
    fn test_string_round_trip_and_parser_table() {
        let env = Env::default();
        let valid_cases = [
            (0.0, 0.0),
            (-0.0, 0.0),
            (18.5944, -72.3074),
            (-33.8688, 151.2093),
            (90.0, 180.0),
            (-90.0, -180.0),
        ];
        for (lat, lng) in valid_cases {
            let point = GeoPoint::new(lat, lng).unwrap();
            let serialized = point.to_string(&env);
            let parsed = GeoPoint::from_string(&env, &serialized).unwrap();
            assert!((parsed.latitude - point.latitude).abs() < 1e-9);
            assert!((parsed.longitude - point.longitude).abs() < 1e-9);

            let compact = GeoFormatter::format_compact(&point, &env);
            let compact_parsed = GeoFormatter::parse_point(&env, &compact).unwrap();
            assert!((compact_parsed.latitude - point.latitude).abs() < 1e-6);
            assert!((compact_parsed.longitude - point.longitude).abs() < 1e-6);
        }

        // Whitespace tolerance
        let spaced = String::from_str(&env, "  18.5944 ,  -72.3074  ");
        let parsed_spaced = GeoPoint::from_string(&env, &spaced).unwrap();
        assert!((parsed_spaced.latitude - 18.5944).abs() < 1e-9);
        assert!((parsed_spaced.longitude - (-72.3074)).abs() < 1e-9);

        // Malformed and non-numeric inputs (#291)
        let invalid_cases = [
            "",
            "18.5944",
            "18.5944,",
            ", -72.3074",
            "18.5944,-72.3074,10",
            "abc,-72.3074",
            "18.5944,xyz",
            "NaN,0",
            "inf,0",
            "95.0,0.0",
        ];
        for bad in invalid_cases {
            assert!(GeoPoint::from_string(&env, &String::from_str(&env, bad)).is_err());
        }
    }
}
