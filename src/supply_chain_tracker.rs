use soroban_sdk::{contract, contractimpl, contracttype, Address, Env, Map, String, Vec};

#[contract]
pub struct SupplyChainTracker;

#[contracttype]
#[derive(Clone)]
pub struct Location {
    pub latitude_e6: i64,
    pub longitude_e6: i64,
    pub address: String,
    pub facility_name: String,
    pub contact_person: String,
}

#[contracttype]
#[derive(Clone)]
pub struct TemperatureRequirements {
    pub min_temp_x100: i64,
    pub max_temp_x100: i64,
    pub critical: bool,
}

#[contracttype]
#[derive(Clone)]
pub struct Checkpoint {
    pub id: String,
    pub location: Location,
    pub timestamp: u64,
    pub verified_by: Address,
    pub quantity_verified: i128,
    pub condition: String,
    pub photos: Vec<String>,
    pub notes: String,
    pub temperature_x100: Option<i64>,
}

#[contracttype]
#[derive(Clone)]
pub struct SupplyShipment {
    pub id: String,
    pub donor_id: String,
    pub supply_type: String,
    pub quantity: i128,
    pub unit: String,
    pub origin: Location,
    pub destination: Location,
    pub created_at: u64,
    pub estimated_arrival: u64,
    pub current_status: String,
    pub checkpoints: Vec<Checkpoint>,
    pub assigned_transporter: Option<Address>,
    pub has_temperature_requirements: bool,
    pub min_temp_x100: i64,
    pub max_temp_x100: i64,
    pub special_handling: Vec<String>,
}

#[contracttype]
#[derive(Clone)]
pub struct RecipientConfirmation {
    pub shipment_id: String,
    pub recipient_id: String,
    pub received_quantity: i128,
    pub received_at: u64,
    pub condition_report: String,
    pub confirmed_by: Address,
    pub photos: Vec<String>,
}

#[contracttype]
#[derive(Clone)]
pub struct CreateShipmentInput {
    pub donor_id: String,
    pub supply_type: String,
    pub quantity: i128,
    pub unit: String,
    pub origin: Location,
    pub destination: Location,
    pub estimated_arrival: u64,
    pub has_temperature_requirements: bool,
    pub min_temp_x100: i64,
    pub max_temp_x100: i64,
    pub special_handling: Vec<String>,
}

#[contracttype]
#[derive(Clone)]
pub struct AddCheckpointInput {
    pub location: Location,
    pub quantity_verified: i128,
    pub condition: String,
    pub photos: Vec<String>,
    pub notes: String,
    pub temperature_x100: Option<i64>,
}

#[contracttype]
#[derive(Clone)]
pub enum TrackerKey {
    Shipments,
    Confirmations,
}

#[contractimpl]
impl SupplyChainTracker {
    pub fn create_shipment(env: Env, donor: Address, shipment_id: String, input: CreateShipmentInput) {
        donor.require_auth();
        let sid = shipment_id.clone();

        let mut shipments: Map<String, SupplyShipment> = env
            .storage()
            .instance()
            .get(&TrackerKey::Shipments)
            .unwrap_or(Map::new(&env));

        if shipments.contains_key(shipment_id.clone()) {
            panic!("shipment exists");
        }

        shipments.set(
            shipment_id,
            SupplyShipment {
                id: sid,
                donor_id: input.donor_id,
                supply_type: input.supply_type,
                quantity: input.quantity,
                unit: input.unit,
                origin: input.origin,
                destination: input.destination,
                created_at: env.ledger().timestamp(),
                estimated_arrival: input.estimated_arrival,
                current_status: String::from_str(&env, "in_transit"),
                checkpoints: Vec::new(&env),
                assigned_transporter: None,
                has_temperature_requirements: input.has_temperature_requirements,
                min_temp_x100: input.min_temp_x100,
                max_temp_x100: input.max_temp_x100,
                special_handling: input.special_handling,
            },
        );

        env.storage().instance().set(&TrackerKey::Shipments, &shipments);
    }

    pub fn add_checkpoint(
        env: Env,
        verifier: Address,
        shipment_id: String,
        input: AddCheckpointInput,
    ) {
        verifier.require_auth();

        let mut shipments: Map<String, SupplyShipment> = env
            .storage()
            .instance()
            .get(&TrackerKey::Shipments)
            .unwrap_or(Map::new(&env));

        if let Some(mut shipment) = shipments.get(shipment_id.clone()) {
            if shipment.has_temperature_requirements {
                if let Some(temp) = input.temperature_x100 {
                    if temp < shipment.min_temp_x100 || temp > shipment.max_temp_x100 {
                        shipment.current_status = String::from_str(&env, "quality_hold");
                    }
                }
            }

            shipment.checkpoints.push_back(Checkpoint {
                id: String::from_str(&env, "checkpoint"),
                location: input.location,
                timestamp: env.ledger().timestamp(),
                verified_by: verifier,
                quantity_verified: input.quantity_verified,
                condition: input.condition,
                photos: input.photos,
                notes: input.notes,
                temperature_x100: input.temperature_x100,
            });
            shipments.set(shipment_id, shipment);
            env.storage().instance().set(&TrackerKey::Shipments, &shipments);
        }
    }

    pub fn assign_transporter(env: Env, donor: Address, shipment_id: String, transporter: Address) {
        donor.require_auth();

        let mut shipments: Map<String, SupplyShipment> = env
            .storage()
            .instance()
            .get(&TrackerKey::Shipments)
            .unwrap_or(Map::new(&env));

        if let Some(mut shipment) = shipments.get(shipment_id.clone()) {
            shipment.assigned_transporter = Some(transporter);
            shipments.set(shipment_id, shipment);
            env.storage().instance().set(&TrackerKey::Shipments, &shipments);
        }
    }

    pub fn confirm_delivery(
        env: Env,
        recipient: Address,
        shipment_id: String,
        recipient_id: String,
        received_quantity: i128,
        condition_report: String,
        photos: Vec<String>,
    ) {
        recipient.require_auth();
        let sid = shipment_id.clone();

        let mut shipments: Map<String, SupplyShipment> = env
            .storage()
            .instance()
            .get(&TrackerKey::Shipments)
            .unwrap_or(Map::new(&env));

        let mut confirmations: Map<String, RecipientConfirmation> = env
            .storage()
            .instance()
            .get(&TrackerKey::Confirmations)
            .unwrap_or(Map::new(&env));

        if let Some(mut shipment) = shipments.get(shipment_id.clone()) {
            shipment.current_status = String::from_str(&env, "delivered");
            shipments.set(shipment_id.clone(), shipment);

            confirmations.set(
                shipment_id,
                RecipientConfirmation {
                    shipment_id: sid,
                    recipient_id,
                    received_quantity,
                    received_at: env.ledger().timestamp(),
                    condition_report,
                    confirmed_by: recipient,
                    photos,
                },
            );

            env.storage().instance().set(&TrackerKey::Shipments, &shipments);
            env.storage().instance().set(&TrackerKey::Confirmations, &confirmations);
        }
    }

    pub fn get_shipment(env: Env, shipment_id: String) -> Option<SupplyShipment> {
        let shipments: Map<String, SupplyShipment> = env
            .storage()
            .instance()
            .get(&TrackerKey::Shipments)
            .unwrap_or(Map::new(&env));
        shipments.get(shipment_id)
    }

    pub fn get_shipment_history(
        env: Env,
        shipment_id: String,
    ) -> (Option<SupplyShipment>, Option<RecipientConfirmation>) {
        let shipments: Map<String, SupplyShipment> = env
            .storage()
            .instance()
            .get(&TrackerKey::Shipments)
            .unwrap_or(Map::new(&env));

        let confirmations: Map<String, RecipientConfirmation> = env
            .storage()
            .instance()
            .get(&TrackerKey::Confirmations)
            .unwrap_or(Map::new(&env));

        (shipments.get(shipment_id.clone()), confirmations.get(shipment_id))
    }

    pub fn track_by_location(env: Env, latitude_e6: i64, longitude_e6: i64, radius_e6: i64) -> Vec<SupplyShipment> {
        let shipments: Map<String, SupplyShipment> = env
            .storage()
            .instance()
            .get(&TrackerKey::Shipments)
            .unwrap_or(Map::new(&env));

        let mut out = Vec::new(&env);
        for (_, shipment) in shipments.iter() {
            if shipment.checkpoints.len() == 0 {
                continue;
            }
            if let Some(last) = shipment.checkpoints.get(shipment.checkpoints.len() - 1) {
                let dist = Self::distance(
                    latitude_e6,
                    longitude_e6,
                    last.location.latitude_e6,
                    last.location.longitude_e6,
                );
                if dist <= radius_e6 {
                    out.push_back(shipment);
                }
            }
        }

        out
    }

    pub fn get_active_shipments(env: Env) -> Vec<SupplyShipment> {
        let shipments: Map<String, SupplyShipment> = env
            .storage()
            .instance()
            .get(&TrackerKey::Shipments)
            .unwrap_or(Map::new(&env));

        let mut out = Vec::new(&env);
        for (_, shipment) in shipments.iter() {
            if shipment.current_status != String::from_str(&env, "delivered") {
                out.push_back(shipment);
            }
        }
        out
    }

    pub fn report_lost(env: Env, reporter: Address, shipment_id: String, reason: String) {
        reporter.require_auth();

        let mut shipments: Map<String, SupplyShipment> = env
            .storage()
            .instance()
            .get(&TrackerKey::Shipments)
            .unwrap_or(Map::new(&env));

        if let Some(mut shipment) = shipments.get(shipment_id.clone()) {
            shipment.current_status = String::from_str(&env, "lost");
            shipment.checkpoints.push_back(Checkpoint {
                id: String::from_str(&env, "lost"),
                location: shipment.destination.clone(),
                timestamp: env.ledger().timestamp(),
                verified_by: reporter,
                quantity_verified: 0,
                condition: String::from_str(&env, "lost"),
                photos: Vec::new(&env),
                notes: reason,
                temperature_x100: None,
            });
            shipments.set(shipment_id, shipment);
            env.storage().instance().set(&TrackerKey::Shipments, &shipments);
        }
    }

    pub fn get_shipments_by_donor(env: Env, donor_id: String) -> Vec<SupplyShipment> {
        let shipments: Map<String, SupplyShipment> = env
            .storage()
            .instance()
            .get(&TrackerKey::Shipments)
            .unwrap_or(Map::new(&env));

        let mut out = Vec::new(&env);
        for (_, shipment) in shipments.iter() {
            if shipment.donor_id == donor_id {
                out.push_back(shipment);
            }
        }
        out
    }

    pub fn get_temperature_alerts(env: Env) -> Vec<(String, String)> {
        let shipments: Map<String, SupplyShipment> = env
            .storage()
            .instance()
            .get(&TrackerKey::Shipments)
            .unwrap_or(Map::new(&env));

        let mut alerts = Vec::new(&env);
        for (id, shipment) in shipments.iter() {
            if shipment.has_temperature_requirements {
                if shipment.checkpoints.len() == 0 {
                    continue;
                }
                if let Some(last) = shipment.checkpoints.get(shipment.checkpoints.len() - 1) {
                    if let Some(temp) = last.temperature_x100 {
                        if temp < shipment.min_temp_x100 || temp > shipment.max_temp_x100 {
                            alerts.push_back((id, String::from_str(&env, "temperature breach")));
                        }
                    }
                }
            }
        }
        alerts
    }

    fn distance(lat1: i64, lon1: i64, lat2: i64, lon2: i64) -> i64 {
        let dlat = if lat2 >= lat1 { lat2 - lat1 } else { lat1 - lat2 };
        let dlon = if lon2 >= lon1 { lon2 - lon1 } else { lon1 - lon2 };
        dlat + dlon
    }
}
