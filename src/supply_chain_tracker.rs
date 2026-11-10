use soroban_sdk::{contract, contractimpl, Address, Env, Symbol, String, Vec, Map, U256};

use crate::rbac::{self, ROLE_NGO, ROLE_TRANSPORTER, ROLE_RECIPIENT};
use crate::geo::{GeoPoint, GeoBounds, GeoFormatter};

#[contract]
pub struct SupplyChainTracker;

#[derive(Clone)]
pub struct AuthorizedRecipient {
    pub address: Address,
    pub recipient_id: String,
}

#[derive(Clone)]
pub struct DeliveryException {
    pub shipment_id: String,
    pub recorded_by: Address,
    pub missing_quantity: U256,
    pub reason: String,
    pub recorded_at: u64,
}

#[derive(Clone)]
pub struct SupplyShipment {
    pub id: String,
    pub donor_id: String,
    pub supply_type: String,
    pub quantity: U256,
    pub total_received_quantity: U256,
    pub unit: String,
    pub origin: Location,
    pub destination: Location,
    pub created_at: u64,
    pub estimated_arrival: u64,
    pub current_status: String,
    pub checkpoints: Vec<Checkpoint>,
    pub assigned_transporter: Option<Address>,
    pub temperature_requirements: Option<TemperatureRequirements>,
    pub special_handling: Vec<String>,
    /// Explicit recipient authorization policy (supports single or group deliveries).
    pub authorized_recipients: Vec<AuthorizedRecipient>,
    /// Authorized shortage/loss closure exceptions recorded by the shipment creator.
    pub delivery_exceptions: Vec<DeliveryException>,
    /// The address that created this shipment (used for ownership checks).
    pub creator: Address,
}

/// Location with geographic coordinates and descriptive info
/// Uses standardized GeoPoint for coordinates
#[derive(Clone)]
pub struct Location {
    pub coordinates: GeoPoint,
    pub address: String,
    pub facility_name: String,
    pub contact_person: String,
}

impl Location {
    /// Create a new Location with coordinates
    pub fn new(latitude: f64, longitude: f64, address: String, facility_name: String, contact_person: String, env: &Env) -> Result<Self, String> {
        let coordinates = GeoPoint::new(latitude, longitude)?;
        Ok(Location { coordinates, address, facility_name, contact_person })
    }

    /// Create from legacy string format "lat,lng"
    pub fn from_string(lat_lng: String, address: String, facility_name: String, contact_person: String, env: &Env) -> Result<Self, String> {
        let coordinates = GeoPoint::from_string(env, &lat_lng)?;
        Ok(Location { coordinates, address, facility_name, contact_person })
    }

    /// Get latitude
    pub fn latitude(&self) -> f64 {
        self.coordinates.latitude
    }

    /// Get longitude
    pub fn longitude(&self) -> f64 {
        self.coordinates.longitude
    }

    /// Distance to another location (km)
    pub fn distance_to(&self, other: &Location) -> f64 {
        self.coordinates.distance_to(&other.coordinates)
    }
}

#[derive(Clone)]
pub struct Checkpoint {
    pub id: String,
    pub location: Location,
    pub timestamp: u64,
    pub verified_by: Address,
    pub quantity_verified: U256,
    pub condition: String,
    pub photos: Vec<String>,
    pub notes: String,
    pub temperature: Option<f64>,
}

#[derive(Clone)]
pub struct TemperatureRequirements {
    pub min_temp: f64,
    pub max_temp: f64,
    pub critical: bool,
}

#[derive(Clone)]
pub struct RecipientConfirmation {
    pub shipment_id: String,
    pub recipient_id: String,
    pub received_quantity: U256,
    pub cumulative_received_quantity: U256,
    pub remaining_quantity: U256,
    pub is_partial: bool,
    pub received_at: u64,
    pub condition_report: String,
    pub confirmed_by: Address,
    pub photos: Vec<String>,
}

#[contractimpl]
impl SupplyChainTracker {
    /// Create a new supply shipment.
    ///
    /// **Required role:** NGO
    /// 
    /// Coordinates are passed as lat,lng strings for standardized geographic representation.
    pub fn create_shipment(
        env: Env,
        donor: Address,
        shipment_id: String,
        donor_id: String,
        supply_type: String,
        quantity: U256,
        unit: String,
        origin_lat_lng: String,
        origin_address: String,
        origin_facility: String,
        origin_contact: String,
        destination_lat_lng: String,
        destination_address: String,
        destination_facility: String,
        destination_contact: String,
        estimated_arrival: u64,
        temperature_requirements: Option<TemperatureRequirements>,
        special_handling: Vec<String>,
    ) {
        donor.require_auth();
        rbac::require_role(&env, &donor, ROLE_NGO);

        let shipments_key = Symbol::new(&env, "shipments");
        let mut shipments: Map<String, SupplyShipment> = env
            .storage()
            .instance()
            .get(&shipments_key)
            .unwrap_or(Map::new(&env));

        if shipments.contains_key(shipment_id.clone()) {
            panic!("Shipment already exists");
        }

        // Create standardized locations
        let origin = Location::from_string(origin_lat_lng, origin_address, origin_facility, origin_contact, &env)
            .unwrap_or_else(|_| panic!("Invalid origin coordinates"));
        let destination = Location::from_string(destination_lat_lng, destination_address, destination_facility, destination_contact, &env)
            .unwrap_or_else(|_| panic!("Invalid destination coordinates"));

        let shipment = SupplyShipment {
            id: shipment_id.clone(),
            donor_id,
            supply_type,
            quantity,
            total_received_quantity: U256::from_u64(&env, 0),
            unit,
            origin,
            destination,
            created_at: env.ledger().timestamp(),
            estimated_arrival,
            current_status: String::from_str(&env, "in_transit"),
            checkpoints: Vec::new(&env),
            assigned_transporter: None,
            temperature_requirements,
            special_handling,
            authorized_recipients: Vec::new(&env),
            delivery_exceptions: Vec::new(&env),
            creator: donor,
        };

        shipments.set(shipment_id, shipment);
        env.storage().instance().set(&shipments_key, &shipments);
    }

    /// Add a checkpoint to a shipment's journey.
    ///
    /// **Required role:** NGO
    /// 
    /// Location is passed as lat,lng string with address/facility/contact for standardized geographic representation.
    pub fn add_checkpoint(
        env: Env,
        verifier: Address,
        shipment_id: String,
        location_lat_lng: String,
        location_address: String,
        location_facility: String,
        location_contact: String,
        quantity_verified: U256,
        condition: String,
        photos: Vec<String>,
        notes: String,
        temperature: Option<f64>,
    ) {
        verifier.require_auth();
        rbac::require_role(&env, &verifier, ROLE_NGO);

        let shipments_key = Symbol::new(&env, "shipments");
        let mut shipments: Map<String, SupplyShipment> = env
            .storage()
            .instance()
            .get(&shipments_key)
            .unwrap_or(Map::new(&env));

        let mut shipment = match shipments.get(shipment_id.clone()) {
            Some(s) => s,
            None => panic!("Shipment not found"),
        };

        if let (Some(temp_req), Some(current_temp)) =
            (&shipment.temperature_requirements, temperature)
        {
            if temp_req.critical
                && (current_temp < temp_req.min_temp || current_temp > temp_req.max_temp)
            {
                panic!("Temperature outside required range");
            }
        }

        let checkpoint_id = format!("cp_{}_{}", shipment_id, env.ledger().timestamp());
        let checkpoint = Checkpoint {
            id: checkpoint_id,
            location: Location::from_string(
                location_lat_lng,
                location_address,
                location_facility,
                location_contact,
                &env
            ).unwrap_or_else(|_| panic!("Invalid checkpoint coordinates")),
            timestamp: env.ledger().timestamp(),
            verified_by: verifier,
            quantity_verified,
            condition,
            photos,
            notes,
            temperature,
        };

        shipment.checkpoints.push_back(checkpoint);
        if shipment.checkpoints.len() > 2 {
            shipment.current_status = String::from_str(&env, "at_checkpoint");
        }

        shipments.set(shipment_id, shipment);
        env.storage().instance().set(&shipments_key, &shipments);
    }

    /// Assign a transporter to a shipment.
    ///
    /// Only the shipment creator (NGO) may assign a transporter.
    pub fn assign_transporter(
        env: Env,
        donor: Address,
        shipment_id: String,
        transporter: Address,
    ) {
        donor.require_auth();
        rbac::require_role(&env, &donor, ROLE_NGO);

        // Ensure the assigned transporter is a registered transporter.
        if !rbac::has_role(&env, &transporter, ROLE_TRANSPORTER) {
            panic!("Unauthorized: transporter does not hold ROLE_TRANSPORTER");
        }

        let shipments_key = Symbol::new(&env, "shipments");
        let mut shipments: Map<String, SupplyShipment> = env
            .storage()
            .instance()
            .get(&shipments_key)
            .unwrap_or(Map::new(&env));

        if let Some(mut shipment) = shipments.get(shipment_id.clone()) {
            // Only the original creator may reassign the transporter.
            if shipment.creator != donor {
                panic!("Unauthorized: caller is not the shipment creator");
            }
            shipment.assigned_transporter = Some(transporter);
            shipments.set(shipment_id, shipment);
            env.storage().instance().set(&shipments_key, &shipments);
        }
    }

    /// Configure authorized intended recipient(s) for a shipment.
    ///
    /// **Required role:** NGO (and must be the original shipment creator).
    /// Supports both single-recipient and group deliveries by registering one or more
    /// `(Address, recipient_id)` pairs bound to the shipment.
    pub fn configure_recipient_policy(
        env: Env,
        donor: Address,
        shipment_id: String,
        authorized_recipients: Vec<(Address, String)>,
    ) {
        donor.require_auth();
        rbac::require_role(&env, &donor, ROLE_NGO);

        if authorized_recipients.is_empty() {
            panic!("Authorized recipient policy must include at least one recipient");
        }
        let mut policy = Vec::new(&env);
        for (address, recipient_id) in authorized_recipients.iter() {
            if recipient_id.is_empty() {
                panic!("Authorized recipient_id must not be empty");
            }
            policy.push_back(AuthorizedRecipient { address, recipient_id });
        }

        let shipments_key = Symbol::new(&env, "shipments");
        let mut shipments: Map<String, SupplyShipment> = env
            .storage()
            .instance()
            .get(&shipments_key)
            .unwrap_or(Map::new(&env));

        let mut shipment = match shipments.get(shipment_id.clone()) {
            Some(s) => s,
            None => panic!("Shipment not found"),
        };

        if shipment.creator != donor {
            panic!("Unauthorized: caller is not the shipment creator");
        }

        shipment.authorized_recipients = policy;
        shipments.set(shipment_id, shipment);
        env.storage().instance().set(&shipments_key, &shipments);
    }

    /// Confirm full or partial delivery.
    ///
    /// Enforces:
    /// 1. Caller holds `ROLE_RECIPIENT` and authenticates.
    /// 2. Shipment has a configured `authorized_recipients` policy and `(recipient, recipient_id)`
    ///    matches an entry in that policy.
    /// 3. `received_quantity > 0` and `received_quantity <= remaining_quantity`.
    /// 4. Partial deliveries set status to `"partially_delivered"` and accumulate toward
    ///    `shipment.quantity`; status becomes `"delivered"` only when total received equals
    ///    declared quantity (or when closed via `record_delivery_exception`).
    pub fn confirm_delivery(
        env: Env,
        recipient: Address,
        shipment_id: String,
        recipient_id: String,
        received_quantity: U256,
        condition_report: String,
        photos: Vec<String>,
    ) {
        recipient.require_auth();

        // Require recipient to hold the recipient role for confirmation.
        rbac::require_role(&env, &recipient, ROLE_RECIPIENT);

        let shipments_key = Symbol::new(&env, "shipments");
        let mut shipments: Map<String, SupplyShipment> = env
            .storage()
            .instance()
            .get(&shipments_key)
            .unwrap_or(Map::new(&env));

        let mut shipment = match shipments.get(shipment_id.clone()) {
            Some(s) => s,
            None => panic!("Shipment not found"),
        };

        if shipment.current_status == String::from_str(&env, "delivered")
            || shipment.current_status == String::from_str(&env, "lost")
        {
            panic!("Shipment delivery already completed or closed");
        }

        if shipment.authorized_recipients.is_empty() {
            panic!("Recipient policy not configured for shipment");
        }

        let mut is_authorized_recipient = false;
        for policy_entry in shipment.authorized_recipients.iter() {
            if policy_entry.address == recipient && policy_entry.recipient_id == recipient_id {
                is_authorized_recipient = true;
                break;
            }
        }
        if !is_authorized_recipient {
            panic!("Unauthorized: recipient does not match shipment recipient policy");
        }

        let zero = U256::from_u64(&env, 0);
        if received_quantity <= zero {
            panic!("Received quantity must be greater than zero");
        }

        let outstanding = shipment.quantity.clone() - shipment.total_received_quantity.clone();
        if received_quantity > outstanding {
            panic!("Received quantity exceeds outstanding shipment quantity");
        }

        let new_total = shipment.total_received_quantity.clone() + received_quantity.clone();
        let remaining = shipment.quantity.clone() - new_total.clone();
        let is_partial = remaining > zero;

        let confirmation = RecipientConfirmation {
            shipment_id: shipment_id.clone(),
            recipient_id,
            received_quantity,
            cumulative_received_quantity: new_total.clone(),
            remaining_quantity: remaining,
            is_partial,
            received_at: env.ledger().timestamp(),
            condition_report,
            confirmed_by: recipient,
            photos,
        };

        let confirmations_key = Symbol::new(&env, "confirmations");
        let mut confirmations: Map<String, RecipientConfirmation> = env
            .storage()
            .instance()
            .get(&confirmations_key)
            .unwrap_or(Map::new(&env));
        confirmations.set(shipment_id.clone(), confirmation.clone());
        env.storage().instance().set(&confirmations_key, &confirmations);

        let history_key = Symbol::new(&env, "conf_hist");
        let mut history_map: Map<String, Vec<RecipientConfirmation>> = env
            .storage()
            .instance()
            .get(&history_key)
            .unwrap_or(Map::new(&env));
        let mut shipment_history = history_map.get(shipment_id.clone()).unwrap_or(Vec::new(&env));
        shipment_history.push_back(confirmation);
        history_map.set(shipment_id.clone(), shipment_history);
        env.storage().instance().set(&history_key, &history_map);

        shipment.total_received_quantity = new_total;
        shipment.current_status = if is_partial {
            String::from_str(&env, "partially_delivered")
        } else {
            String::from_str(&env, "delivered")
        };
        shipments.set(shipment_id, shipment);
        env.storage().instance().set(&shipments_key, &shipments);
    }

    /// Record an authorized shortage/delivery exception and mark a partial shipment as delivered.
    ///
    /// **Required role:** NGO (original shipment creator).
    pub fn record_delivery_exception(
        env: Env,
        donor: Address,
        shipment_id: String,
        reason: String,
    ) {
        donor.require_auth();
        rbac::require_role(&env, &donor, ROLE_NGO);

        let shipments_key = Symbol::new(&env, "shipments");
        let mut shipments: Map<String, SupplyShipment> = env
            .storage()
            .instance()
            .get(&shipments_key)
            .unwrap_or(Map::new(&env));

        let mut shipment = match shipments.get(shipment_id.clone()) {
            Some(s) => s,
            None => panic!("Shipment not found"),
        };

        if shipment.creator != donor {
            panic!("Unauthorized: caller is not the shipment creator");
        }
        if shipment.current_status == String::from_str(&env, "delivered")
            || shipment.current_status == String::from_str(&env, "lost")
        {
            panic!("Shipment delivery already completed or closed");
        }

        let missing_quantity = shipment.quantity.clone() - shipment.total_received_quantity.clone();
        shipment.delivery_exceptions.push_back(DeliveryException {
            shipment_id: shipment_id.clone(),
            recorded_by: donor,
            missing_quantity,
            reason,
            recorded_at: env.ledger().timestamp(),
        });
        shipment.current_status = String::from_str(&env, "delivered");
        shipments.set(shipment_id, shipment);
        env.storage().instance().set(&shipments_key, &shipments);
    }

    /// Retrieve all partial/final delivery confirmations recorded for a shipment.
    pub fn get_delivery_confirmations(env: Env, shipment_id: String) -> Vec<RecipientConfirmation> {
        let history_key = Symbol::new(&env, "conf_hist");
        let history_map: Map<String, Vec<RecipientConfirmation>> = env
            .storage()
            .instance()
            .get(&history_key)
            .unwrap_or(Map::new(&env));
        history_map.get(shipment_id).unwrap_or(Vec::new(&env))
    }

    /// Report a shipment as lost.
    ///
    /// Any authenticated address may report a loss (the reporter signs).
    pub fn report_lost(env: Env, reporter: Address, shipment_id: String, reason: String) {
        reporter.require_auth();

        let shipments_key = Symbol::new(&env, "shipments");
        let mut shipments: Map<String, SupplyShipment> = env
            .storage()
            .instance()
            .get(&shipments_key)
            .unwrap_or(Map::new(&env));

        if let Some(mut shipment) = shipments.get(shipment_id.clone()) {
            shipment.current_status = String::from_str(&env, "lost");
            let loss_checkpoint = Checkpoint {
                id: format!("loss_{}", shipment_id),
                location: shipment.destination.clone(),
                timestamp: env.ledger().timestamp(),
                verified_by: reporter,
                quantity_verified: U256::from_u64(0),
                condition: String::from_str(&env, "lost"),
                photos: Vec::new(&env),
                notes: reason,
                temperature: None,
            };
            shipment.checkpoints.push_back(loss_checkpoint);
            shipments.set(shipment_id, shipment);
            env.storage().instance().set(&shipments_key, &shipments);
        }
    }

    // ── Read-only helpers ────────────────────────────────────────────────────

    pub fn get_shipment(env: Env, shipment_id: String) -> Option<SupplyShipment> {
        let shipments_key = Symbol::new(&env, "shipments");
        let shipments: Map<String, SupplyShipment> = env
            .storage()
            .instance()
            .get(&shipments_key)
            .unwrap_or(Map::new(&env));
        shipments.get(shipment_id)
    }

    pub fn get_shipment_history(
        env: Env,
        shipment_id: String,
    ) -> (Option<SupplyShipment>, Option<RecipientConfirmation>) {
        let shipments_key = Symbol::new(&env, "shipments");
        let shipments: Map<String, SupplyShipment> = env
            .storage()
            .instance()
            .get(&shipments_key)
            .unwrap_or(Map::new(&env));
        let confirmations_key = Symbol::new(&env, "confirmations");
        let confirmations: Map<String, RecipientConfirmation> = env
            .storage()
            .instance()
            .get(&confirmations_key)
            .unwrap_or(Map::new(&env));
        (
            shipments.get(shipment_id.clone()),
            confirmations.get(shipment_id),
        )
    }

    pub fn get_active_shipments(env: Env) -> Vec<SupplyShipment> {
        let shipments_key = Symbol::new(&env, "shipments");
        let shipments: Map<String, SupplyShipment> = env
            .storage()
            .instance()
            .get(&shipments_key)
            .unwrap_or(Map::new(&env));
        let mut active = Vec::new(&env);
        for (_, shipment) in shipments.iter() {
            if shipment.current_status != String::from_str(&env, "delivered")
                && shipment.current_status != String::from_str(&env, "lost")
            {
                active.push_back(shipment);
            }
        }
        active
    }

    pub fn get_shipments_by_donor(env: Env, donor_id: String) -> Vec<SupplyShipment> {
        let shipments_key = Symbol::new(&env, "shipments");
        let shipments: Map<String, SupplyShipment> = env
            .storage()
            .instance()
            .get(&shipments_key)
            .unwrap_or(Map::new(&env));
        let mut result = Vec::new(&env);
        for (_, shipment) in shipments.iter() {
            if shipment.donor_id == donor_id {
                result.push_back(shipment);
            }
        }
        result
    }

    pub fn track_by_location(
        env: Env,
        latitude: f64,
        longitude: f64,
        radius_km: f64,
    ) -> Vec<SupplyShipment> {
        let center = GeoPoint::new(latitude, longitude).unwrap();
        let bounds = GeoBounds::from_radius(&center, radius_km);
        
        let shipments_key = Symbol::new(&env, "shipments");
        let shipments: Map<String, SupplyShipment> = env
            .storage()
            .instance()
            .get(&shipments_key)
            .unwrap_or(Map::new(&env));
        let mut nearby = Vec::new(&env);
        
        for (_, shipment) in shipments.iter() {
            if let Some(latest) = shipment.checkpoints.get(shipment.checkpoints.len() - 1) {
                let checkpoint_point = &latest.location.coordinates;
                if bounds.contains(checkpoint_point) {
                    // Double-check with exact distance
                    if center.distance_to(checkpoint_point) <= radius_km {
                        nearby.push_back(shipment);
                    }
                }
            }
        }
        nearby
    }

    pub fn get_temperature_alerts(env: Env) -> Vec<(String, String)> {
        let shipments_key = Symbol::new(&env, "shipments");
        let shipments: Map<String, SupplyShipment> = env
            .storage()
            .instance()
            .get(&shipments_key)
            .unwrap_or(Map::new(&env));
        let mut alerts = Vec::new(&env);
        for (shipment_id, shipment) in shipments.iter() {
            if let Some(temp_req) = &shipment.temperature_requirements {
                if let Some(latest) =
                    shipment.checkpoints.get(shipment.checkpoints.len() - 1)
                {
                    if let Some(current_temp) = latest.temperature {
                        if current_temp < temp_req.min_temp || current_temp > temp_req.max_temp {
                            let alert_msg = format!(
                                "Temperature breach: {}°C (required: {}-{}°C)",
                                current_temp, temp_req.min_temp, temp_req.max_temp
                            );
                            alerts.push_back((
                                shipment_id.clone(),
                                String::from_str(&env, &alert_msg),
                            ));
                        }
                    }
                }
            }
        }
        alerts
    }
}
