use soroban_sdk::{
    contract, contractimpl, contracttype, Address, Env, String, Symbol, Vec,
};

#[contract]
pub struct SupplyChainTracker;

#[contracttype]
#[derive(Clone)]
pub struct ConditionSensor {
    pub temperature_x100: i64,
    pub humidity_x100: u32,
    pub shock_mg: u32,
    pub light_lux: u32,
}

#[contracttype]
#[derive(Clone)]
pub struct CustodyEvent {
    pub location: String,
    pub timestamp: u64,
    pub custodian: Address,
    pub condition: ConditionSensor,
    pub proof_hash: String,
}

#[contracttype]
#[derive(Clone)]
pub struct Shipment {
    pub id: String,
    pub contents: String,
    pub origin: String,
    pub destination: String,
    pub custody_chain: Vec<CustodyEvent>,
    pub status: String,
    pub expected_route: Vec<String>,
    pub sensor_types: Vec<String>,
    pub gps_anchor_interval_secs: u64,
    pub delay_threshold_secs: u64,
    pub min_temp_x100: Option<i64>,
    pub max_temp_x100: Option<i64>,
    pub requires_community_witness: bool,
    pub beneficiary_pin_hash: String,
    pub beneficiary_signature: Option<String>,
    pub qr_confirmation: Option<String>,
    pub community_witness_signatures: Vec<String>,
    pub delivery_photo_hash: Option<String>,
    pub anchor_count: u32,
}

#[contracttype]
#[derive(Clone)]
pub struct AnomalyAlert {
    pub id: u64,
    pub shipment_id: String,
    pub anomaly_type: String,
    pub details: String,
    pub proof_hash: String,
    pub timestamp: u64,
}

#[contracttype]
#[derive(Clone)]
pub struct OracleAnchor {
    pub timestamp: u64,
    pub location: String,
    pub packet_hash: String,
    pub seal_intact: bool,
    pub photo_hash: String,
}

#[contracttype]
#[derive(Clone)]
pub struct CreateShipmentInput {
    pub id: String,
    pub contents: String,
    pub origin: String,
    pub destination: String,
    pub expected_route: Vec<String>,
    pub sensor_types: Vec<String>,
    pub gps_anchor_interval_secs: u64,
    pub delay_threshold_secs: Option<u64>,
    pub min_temp_x100: Option<i64>,
    pub max_temp_x100: Option<i64>,
    pub requires_community_witness: bool,
    pub beneficiary_pin_hash: String,
}

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Shipment(String),
    ShipmentIds,
    CustodyEvent(String, u32),
    CustodyCount(String),
    Anomalies(String),
    OracleAnchors(String),
}

#[contractimpl]
impl SupplyChainTracker {
    pub fn create_shipment(env: Env, creator: Address, input: CreateShipmentInput) {
        creator.require_auth();

        if input.expected_route.len() == 0 {
            panic!("expected route required");
        }

        if env
            .storage()
            .persistent()
            .has(&DataKey::Shipment(input.id.clone()))
        {
            panic!("shipment exists");
        }

        if input.min_temp_x100.is_some() != input.max_temp_x100.is_some() {
            panic!("invalid temperature range");
        }

        let shipment = Shipment {
            id: input.id.clone(),
            contents: input.contents,
            origin: input.origin,
            destination: input.destination,
            custody_chain: Vec::new(&env),
            status: String::from_str(&env, "registered"),
            expected_route: input.expected_route,
            sensor_types: input.sensor_types,
            gps_anchor_interval_secs: if input.gps_anchor_interval_secs == 0 {
                1_800
            } else {
                input.gps_anchor_interval_secs
            },
            delay_threshold_secs: input.delay_threshold_secs.unwrap_or(86_400),
            min_temp_x100: input.min_temp_x100,
            max_temp_x100: input.max_temp_x100,
            requires_community_witness: input.requires_community_witness,
            beneficiary_pin_hash: input.beneficiary_pin_hash,
            beneficiary_signature: None,
            qr_confirmation: None,
            community_witness_signatures: Vec::new(&env),
            delivery_photo_hash: None,
            anchor_count: 0,
        };

        Self::save_shipment(&env, &shipment);
        Self::push_shipment_id(&env, &shipment.id);
    }

    #[allow(clippy::too_many_arguments)]
    pub fn transfer_custody(
        env: Env,
        custodian: Address,
        shipment_id: String,
        location: String,
        condition: ConditionSensor,
        proof_hash: String,
        gps_anchor_hash: String,
        seal_intact: bool,
        photo_hash: String,
    ) {
        custodian.require_auth();

        let mut shipment = Self::get_required_shipment(&env, &shipment_id);
        let now = env.ledger().timestamp();

        if let Some(last_event) = Self::last_event(&shipment) {
            if now > last_event.timestamp + shipment.delay_threshold_secs {
                Self::store_anomaly(
                    &env,
                    &shipment_id,
                    String::from_str(&env, "delay"),
                    String::from_str(&env, "Checkpoint delay exceeds threshold"),
                    proof_hash.clone(),
                );
            }
        }

        if !Self::route_contains(&shipment.expected_route, &location) {
            Self::store_anomaly(
                &env,
                &shipment_id,
                String::from_str(&env, "route_deviation"),
                String::from_str(&env, "Shipment left expected corridor"),
                proof_hash.clone(),
            );
        }

        if let (Some(min_temp), Some(max_temp)) = (shipment.min_temp_x100, shipment.max_temp_x100) {
            if condition.temperature_x100 < min_temp || condition.temperature_x100 > max_temp {
                shipment.status = String::from_str(&env, "quality_hold");
                Self::store_anomaly(
                    &env,
                    &shipment_id,
                    String::from_str(&env, "condition_breach"),
                    String::from_str(&env, "Temperature outside approved range"),
                    proof_hash.clone(),
                );
            }
        }

        if !seal_intact {
            Self::store_anomaly(
                &env,
                &shipment_id,
                String::from_str(&env, "seal_tamper"),
                String::from_str(&env, "Electronic seal integrity check failed"),
                proof_hash.clone(),
            );
        }

        if condition.shock_mg > 3_000 {
            Self::store_anomaly(
                &env,
                &shipment_id,
                String::from_str(&env, "shock_impact"),
                String::from_str(&env, "Shock threshold exceeded for fragile goods"),
                proof_hash.clone(),
            );
        }

        let event = CustodyEvent {
            location: location.clone(),
            timestamp: now,
            custodian,
            condition,
            proof_hash,
        };

        shipment.custody_chain.push_back(event.clone());
        Self::persist_custody_event(&env, &shipment_id, &event);
        Self::persist_oracle_anchor(
            &env,
            &shipment_id,
            OracleAnchor {
                timestamp: now,
                location,
                packet_hash: gps_anchor_hash,
                seal_intact,
                photo_hash,
            },
        );
        shipment.anchor_count += 1;

        if shipment.status != String::from_str(&env, "quality_hold") {
            shipment.status = String::from_str(&env, "in_transit");
        }

        Self::save_shipment(&env, &shipment);
    }

    #[allow(clippy::too_many_arguments)]
    pub fn verify_delivery(
        env: Env,
        beneficiary: Address,
        shipment_id: String,
        beneficiary_signature: String,
        qr_confirmation: String,
        pin_hash: String,
        witness_signatures: Vec<String>,
        delivery_photo_hash: String,
    ) {
        beneficiary.require_auth();

        let mut shipment = Self::get_required_shipment(&env, &shipment_id);

        if pin_hash != shipment.beneficiary_pin_hash {
            panic!("invalid beneficiary pin");
        }

        if qr_confirmation.len() == 0 {
            panic!("qr confirmation required");
        }

        if shipment.requires_community_witness && witness_signatures.len() < 3 {
            panic!("three witness signatures required");
        }

        if let Some(last_event) = Self::last_event(&shipment) {
            if last_event.location != shipment.destination {
                Self::store_anomaly(
                    &env,
                    &shipment_id,
                    String::from_str(&env, "destination_mismatch"),
                    String::from_str(&env, "Delivery confirmed outside destination geofence"),
                    beneficiary_signature.clone(),
                );
            }
        } else {
            panic!("cannot verify delivery without custody records");
        }

        shipment.status = String::from_str(&env, "delivered");
        shipment.beneficiary_signature = Some(beneficiary_signature);
        shipment.qr_confirmation = Some(qr_confirmation);
        shipment.community_witness_signatures = witness_signatures;
        shipment.delivery_photo_hash = Some(delivery_photo_hash);

        Self::save_shipment(&env, &shipment);
    }

    pub fn flag_anomaly(
        env: Env,
        reporter: Address,
        shipment_id: String,
        anomaly_type: String,
        details: String,
        proof_hash: String,
    ) {
        reporter.require_auth();

        let mut shipment = Self::get_required_shipment(&env, &shipment_id);
        shipment.status = String::from_str(&env, "anomaly_flagged");
        Self::save_shipment(&env, &shipment);

        Self::store_anomaly(&env, &shipment_id, anomaly_type, details, proof_hash);
    }

    #[allow(clippy::too_many_arguments)]
    pub fn ingest_iot_oracle_data(
        env: Env,
        oracle: Address,
        shipment_id: String,
        location: String,
        condition: ConditionSensor,
        proof_hash: String,
        gps_anchor_hash: String,
        seal_intact: bool,
        photo_hash: String,
    ) {
        oracle.require_auth();
        Self::transfer_custody(
            env,
            oracle,
            shipment_id,
            location,
            condition,
            proof_hash,
            gps_anchor_hash,
            seal_intact,
            photo_hash,
        );
    }

    pub fn get_shipment(env: Env, shipment_id: String) -> Option<Shipment> {
        env.storage()
            .persistent()
            .get(&DataKey::Shipment(shipment_id))
    }

    pub fn get_custody_chain(env: Env, shipment_id: String) -> Vec<CustodyEvent> {
        let count: u32 = env
            .storage()
            .persistent()
            .get(&DataKey::CustodyCount(shipment_id.clone()))
            .unwrap_or(0);

        let mut chain = Vec::new(&env);
        let mut idx = 0u32;
        while idx < count {
            if let Some(event) = env
                .storage()
                .persistent()
                .get(&DataKey::CustodyEvent(shipment_id.clone(), idx))
            {
                chain.push_back(event);
            }
            idx += 1;
        }
        chain
    }

    pub fn get_anomalies(env: Env, shipment_id: String) -> Vec<AnomalyAlert> {
        env.storage()
            .persistent()
            .get(&DataKey::Anomalies(shipment_id))
            .unwrap_or(Vec::new(&env))
    }

    pub fn get_oracle_anchors(env: Env, shipment_id: String) -> Vec<OracleAnchor> {
        env.storage()
            .persistent()
            .get(&DataKey::OracleAnchors(shipment_id))
            .unwrap_or(Vec::new(&env))
    }

    pub fn get_active_shipments(env: Env) -> Vec<Shipment> {
        let mut active = Vec::new(&env);
        let ids = Self::shipment_ids(&env);

        for id in ids.iter() {
            let stored: Option<Shipment> =
                env.storage().persistent().get(&DataKey::Shipment(id));
            if let Some(shipment) = stored {
                if shipment.status != String::from_str(&env, "delivered") {
                    active.push_back(shipment);
                }
            }
        }

        active
    }

    fn get_required_shipment(env: &Env, shipment_id: &String) -> Shipment {
        env.storage()
            .persistent()
            .get(&DataKey::Shipment(shipment_id.clone()))
            .unwrap_or_else(|| panic!("shipment not found"))
    }

    fn save_shipment(env: &Env, shipment: &Shipment) {
        env.storage()
            .persistent()
            .set(&DataKey::Shipment(shipment.id.clone()), shipment);
    }

    fn shipment_ids(env: &Env) -> Vec<String> {
        env.storage()
            .persistent()
            .get(&DataKey::ShipmentIds)
            .unwrap_or(Vec::new(env))
    }

    fn push_shipment_id(env: &Env, shipment_id: &String) {
        let mut ids = Self::shipment_ids(env);
        ids.push_back(shipment_id.clone());
        env.storage().persistent().set(&DataKey::ShipmentIds, &ids);
    }

    fn persist_custody_event(env: &Env, shipment_id: &String, event: &CustodyEvent) {
        let count: u32 = env
            .storage()
            .persistent()
            .get(&DataKey::CustodyCount(shipment_id.clone()))
            .unwrap_or(0);

        env.storage()
            .persistent()
            .set(&DataKey::CustodyEvent(shipment_id.clone(), count), event);
        env.storage()
            .persistent()
            .set(&DataKey::CustodyCount(shipment_id.clone()), &(count + 1));
    }

    fn persist_oracle_anchor(env: &Env, shipment_id: &String, anchor: OracleAnchor) {
        let mut anchors: Vec<OracleAnchor> = env
            .storage()
            .persistent()
            .get(&DataKey::OracleAnchors(shipment_id.clone()))
            .unwrap_or(Vec::new(env));
        anchors.push_back(anchor);
        env.storage()
            .persistent()
            .set(&DataKey::OracleAnchors(shipment_id.clone()), &anchors);
    }

    fn store_anomaly(
        env: &Env,
        shipment_id: &String,
        anomaly_type: String,
        details: String,
        proof_hash: String,
    ) {
        let mut anomalies: Vec<AnomalyAlert> = env
            .storage()
            .persistent()
            .get(&DataKey::Anomalies(shipment_id.clone()))
            .unwrap_or(Vec::new(env));

        let anomaly_id = env.ledger().sequence() as u64 + anomalies.len() as u64;
        anomalies.push_back(AnomalyAlert {
            id: anomaly_id,
            shipment_id: shipment_id.clone(),
            anomaly_type,
            details,
            proof_hash,
            timestamp: env.ledger().timestamp(),
        });

        env.storage()
            .persistent()
            .set(&DataKey::Anomalies(shipment_id.clone()), &anomalies);
    }

    fn last_event(shipment: &Shipment) -> Option<CustodyEvent> {
        if shipment.custody_chain.len() == 0 {
            None
        } else {
            shipment.custody_chain.get(shipment.custody_chain.len() - 1)
        }
    }

    fn route_contains(route: &Vec<String>, location: &String) -> bool {
        for checkpoint in route.iter() {
            if checkpoint == location.clone() {
                return true;
            }
        }
        false
    }

    pub fn get_config(env: Env) -> Vec<Symbol> {
        let mut out = Vec::new(&env);
        out.push_back(Symbol::new(&env, "persistent"));
        out.push_back(Symbol::new(&env, "iot_oracle_ingest"));
        out
    }
}
