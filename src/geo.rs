use soroban_sdk::{Env, String, Vec, f64};

/// Standardized geographic data representation and conversion utilities.
/// 
/// Internal representation: f64 degrees (WGS84)
/// - Latitude: [-90, 90]
/// - Longitude: [-180, 180]
/// 
/// Storage formats:
/// - Contract storage: GeoPoint (f64 lat, f64 lng)
/// - External APIs: String "lat,lng" or JSON
/// - Legacy migration: from_scaled_i64(i64) for 1e6 scaled integers

/// Scaling factor for legacy integer coordinate storage (1e6)
pub const COORD_SCALE_FACTOR: i64 = 1_000_000;

/// Maximum valid coordinate values
pub const MAX_LATITUDE: f64 = 90.0;
pub const MIN_LATITUDE: f64 = -90.0;
pub const MAX_LONGITUDE: f64 = 180.0;
pub const MIN_LONGITUDE: f64 = -180.0;

/// Earth's radius in kilometers (WGS84 mean radius)
pub const EARTH_RADIUS_KM: f64 = 6371.0;

/// Standardized geographic point using f64 degrees
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct GeoPoint {
    pub latitude: f64,
    pub longitude: f64,
}

impl GeoPoint {
    /// Create a new GeoPoint with validation
    pub fn new(latitude: f64, longitude: f64) -> Result<Self, String> {
        if latitude < MIN_LATITUDE || latitude > MAX_LATITUDE {
            return Err(String::from_str(&Env::default(), "Latitude out of range [-90, 90]"));
        }
        if longitude < MIN_LONGITUDE || longitude > MAX_LONGITUDE {
            return Err(String::from_str(&Env::default(), "Longitude out of range [-180, 180]"));
        }
        Ok(GeoPoint { latitude, longitude })
    }

    /// Create GeoPoint from scaled integer (1e6 = microdegrees)
    /// Used for migration from legacy i64 storage
    pub fn from_scaled_i64(lat_scaled: i64, lng_scaled: i64) -> Self {
        GeoPoint {
            latitude: lat_scaled as f64 / COORD_SCALE_FACTOR as f64,
            longitude: lng_scaled as f64 / COORD_SCALE_FACTOR as f64,
        }
    }

    /// Convert to scaled integer for legacy storage compatibility
    pub fn to_scaled_i64(&self) -> (i64, i64) {
        (
            (self.latitude * COORD_SCALE_FACTOR as f64).round() as i64,
            (self.longitude * COORD_SCALE_FACTOR as f64).round() as i64,
        )
    }

    /// Parse from string "lat,lng" format
    pub fn from_string(env: &Env, s: &String) -> Result<Self, String> {
        let str_val = s.to_string();
        let parts: Vec<&str> = str_val.split(',').collect();
        if parts.len() != 2 {
            return Err(String::from_str(env, "Invalid coordinate format, expected 'lat,lng'"));
        }
        let lat = parts[0].trim().parse::<f64>()
            .map_err(|_| String::from_str(env, "Invalid latitude"))?;
        let lng = parts[1].trim().parse::<f64>()
            .map_err(|_| String::from_str(env, "Invalid longitude"))?;
        Self::new(lat, lng)
    }

    /// Convert to string "lat,lng" format
    pub fn to_string(&self, env: &Env) -> String {
        String::from_str(env, &format!("{},{}", self.latitude, self.longitude))
    }

    /// Calculate distance to another point using Haversine formula (returns km)
    pub fn distance_to(&self, other: &GeoPoint) -> f64 {
        let r = EARTH_RADIUS_KM;
        let dlat = (other.latitude - self.latitude).to_radians();
        let dlon = (other.longitude - self.longitude).to_radians();
        let a = (dlat / 2.0).sin().powi(2)
            + self.latitude.to_radians().cos() * other.latitude.to_radians().cos()
            * (dlon / 2.0).sin().powi(2);
        let c = 2.0 * a.sqrt().atan2((1.0 - a).sqrt());
        r * c
    }

    /// Check if point is within radius (km) of another point
    pub fn is_within_radius(&self, center: &GeoPoint, radius_km: f64) -> bool {
        self.distance_to(center) <= radius_km
    }

    /// Calculate bounding box for a radius (returns min_lat, max_lat, min_lng, max_lng)
    pub fn bounding_box(&self, radius_km: f64) -> (f64, f64, f64, f64) {
        // 1 degree latitude ~= 111 km
        let lat_delta = radius_km / 111.0;
        // 1 degree longitude ~= 111 km * cos(lat)
        let lng_delta = radius_km / (111.0 * self.latitude.to_radians().cos().max(0.1));
        
        (
            (self.latitude - lat_delta).max(MIN_LATITUDE),
            (self.latitude + lat_delta).min(MAX_LATITUDE),
            (self.longitude - lng_delta).max(MIN_LONGITUDE),
            (self.longitude + lng_delta).min(MAX_LONGITUDE),
        )
    }
}

/// Geographic bounding box for spatial queries
#[derive(Clone, Copy, Debug)]
pub struct GeoBounds {
    pub min_lat: f64,
    pub max_lat: f64,
    pub min_lng: f64,
    pub max_lng: f64,
}

impl GeoBounds {
    pub fn new(min_lat: f64, max_lat: f64, min_lng: f64, max_lng: f64) -> Self {
        GeoBounds { min_lat, max_lat, min_lng, max_lng }
    }

    /// Create bounds from center point and radius
    pub fn from_radius(center: &GeoPoint, radius_km: f64) -> Self {
        let (min_lat, max_lat, min_lng, max_lng) = center.bounding_box(radius_km);
        GeoBounds::new(min_lat, max_lat, min_lng, max_lng)
    }

    /// Check if a point is within bounds
    pub fn contains(&self, point: &GeoPoint) -> bool {
        point.latitude >= self.min_lat && point.latitude <= self.max_lat
            && point.longitude >= self.min_lng && point.longitude <= self.max_lng
    }

    /// Check if bounds intersect with another bounds
    pub fn intersects(&self, other: &GeoBounds) -> bool {
        self.min_lat <= other.max_lat && self.max_lat >= other.min_lat
            && self.min_lng <= other.max_lng && self.max_lng >= other.min_lng
    }
}

/// Geofence zone with circular boundary
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

    /// Create from legacy scaled integer format
    pub fn from_scaled(env: &Env, zone_name: String, lat_scaled: i64, lng_scaled: i64, radius_meters: u32, is_safe: bool) -> Self {
        GeofenceZone {
            zone_name,
            center: GeoPoint::from_scaled_i64(lat_scaled, lng_scaled),
            radius_meters,
            is_safe,
        }
    }

    /// Convert to legacy scaled integer format
    pub fn to_scaled(&self) -> (String, i64, i64, u32, bool) {
        let (lat_scaled, lng_scaled) = self.center.to_scaled_i64();
        (self.zone_name.clone(), lat_scaled, lng_scaled, self.radius_meters, self.is_safe)
    }

    /// Check if a point is within this geofence
    pub fn contains(&self, point: &GeoPoint) -> bool {
        self.center.distance_to(point) <= (self.radius_meters as f64 / 1000.0)
    }

    /// Get radius in kilometers
    pub fn radius_km(&self) -> f64 {
        self.radius_meters as f64 / 1000.0
    }
}

/// Address/location string utilities
pub struct GeoFormatter;

impl GeoFormatter {
    /// Format GeoPoint as "lat, lng" (human readable)
    pub fn format_point(point: &GeoPoint, env: &Env) -> String {
        String::from_str(env, &format!("{:.6}, {:.6}", point.latitude, point.longitude))
    }

    /// Format GeoPoint as "lat,lng" (compact for storage/transmission)
    pub fn format_compact(point: &GeoPoint, env: &Env) -> String {
        String::from_str(env, &format!("{:.6},{:.6}", point.latitude, point.longitude))
    }

    /// Parse coordinate string (accepts "lat,lng" or "lat, lng")
    pub fn parse_point(env: &Env, s: &String) -> Result<GeoPoint, String> {
        GeoPoint::from_string(env, s)
    }
}

/// Migration helpers for legacy coordinate formats
pub struct GeoMigration;

impl GeoMigration {
    /// Convert legacy i64 (scaled by 1e6) to GeoPoint
    pub fn from_legacy_i64(lat_scaled: i64, lng_scaled: i64) -> GeoPoint {
        GeoPoint::from_scaled_i64(lat_scaled, lng_scaled)
    }

    /// Convert GeoPoint to legacy i64 (scaled by 1e6)
    pub fn to_legacy_i64(point: &GeoPoint) -> (i64, i64) {
        point.to_scaled_i64()
    }

    /// Convert legacy GeofenceZone to standardized format
    pub fn migrate_geofence(env: &Env, zone_name: String, lat_scaled: i64, lng_scaled: i64, radius_meters: u32, is_safe: bool) -> GeofenceZone {
        GeofenceZone::from_scaled(env, zone_name, lat_scaled, lng_scaled, radius_meters, is_safe)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_geopoint_creation() {
        let env = Env::default();
        let point = GeoPoint::new(18.5944, -72.3074).unwrap();
        assert!((point.latitude - 18.5944).abs() < 0.0001);
        assert!((point.longitude - (-72.3074)).abs() < 0.0001);
    }

    #[test]
    fn test_geopoint_validation() {
        let env = Env::default();
        // Invalid latitude
        assert!(GeoPoint::new(91.0, 0.0).is_err());
        assert!(GeoPoint::new(-91.0, 0.0).is_err());
        // Invalid longitude
        assert!(GeoPoint::new(0.0, 181.0).is_err());
        assert!(GeoPoint::new(0.0, -181.0).is_err());
    }

    #[test]
    fn test_scaled_conversion() {
        let point = GeoPoint::new(18.5944, -72.3074).unwrap();
        let (lat_scaled, lng_scaled) = point.to_scaled_i64();
        let restored = GeoPoint::from_scaled_i64(lat_scaled, lng_scaled);
        assert!((restored.latitude - point.latitude).abs() < 0.000001);
        assert!((restored.longitude - point.longitude).abs() < 0.000001);
    }

    #[test]
    fn test_haversine_distance() {
        // Port-au-Prince to Cap-Haïtien (~130 km)
        let p1 = GeoPoint::new(18.5944, -72.3074).unwrap();
        let p2 = GeoPoint::new(19.7589, -72.2028).unwrap();
        let distance = p1.distance_to(&p2);
        assert!((distance - 130.0).abs() < 10.0); // Within 10km tolerance
    }

    #[test]
    fn test_bounding_box() {
        let center = GeoPoint::new(18.5944, -72.3074).unwrap();
        let bounds = GeoBounds::from_radius(&center, 10.0); // 10km radius
        assert!(bounds.contains(&center));
        
        let nearby = GeoPoint::new(18.6, -72.3).unwrap();
        assert!(bounds.contains(&nearby));
        
        let far = GeoPoint::new(19.0, -72.0).unwrap();
        assert!(!bounds.contains(&far));
    }

    #[test]
    fn test_geofence_zone() {
        let env = Env::default();
        let center = GeoPoint::new(18.5944, -72.3074).unwrap();
        let zone = GeofenceZone::new(
            String::from_str(&env, "Camp Alpha"),
            center,
            5000, // 5km
            true
        );
        
        let inside = GeoPoint::new(18.595, -72.307).unwrap();
        let outside = GeoPoint::new(19.0, -72.0).unwrap();
        
        assert!(zone.contains(&inside));
        assert!(!zone.contains(&outside));
    }

    #[test]
    fn test_string_formatting() {
        let env = Env::default();
        let point = GeoPoint::new(18.5944, -72.3074).unwrap();
        let formatted = GeoFormatter::format_compact(&point, &env);
        let parsed = GeoFormatter::parse_point(&env, &formatted).unwrap();
        assert!((parsed.latitude - point.latitude).abs() < 0.000001);
        assert!((parsed.longitude - point.longitude).abs() < 0.000001);
    }
}