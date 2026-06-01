#![no_std]
use soroban_sdk::{contract, contractimpl, Address, Env, Symbol, Vec, panic_with_error};

pub mod validation {
    use soroban_sdk::{Address, Env, Vec, panic_with_error};

    /// Panics if the address list is empty.
    pub fn require_non_empty_address_list(env: &Env, addresses: &Vec<Address>) {
        if addresses.is_empty() {
            panic_with_error!(env, "Address list must not be empty");
        }
    }

    /// Panics if the address list has fewer entries than `min_count`.
    pub fn require_min_address_count(env: &Env, addresses: &Vec<Address>, min_count: u32) {
        if (addresses.len() as u32) < min_count {
            panic_with_error!(env, "Insufficient addresses provided");
        }
    }
}

mod aid_registry;
mod beneficiary_manager;
mod merchant_network;
mod cash_transfer;
mod supply_chain_tracker;
mod anti_fraud;

pub use aid_registry::*;
pub use beneficiary_manager::*;
pub use merchant_network::*;
pub use cash_transfer::*;
pub use supply_chain_tracker::*;
pub use anti_fraud::*;

#[contract]
pub struct DisasterReliefPlatform;

#[contractimpl]
impl DisasterReliefPlatform {
    /// Initialize the disaster relief platform with admin addresses
    pub fn initialize(env: Env, admin: Address, ngo_signer: Address, gov_signer: Address, un_signer: Address) {
        // Store multi-sig signers for emergency fund release
        env.storage().instance().set(&Symbol::new(&env, "admin"), &admin);
        env.storage().instance().set(&Symbol::new(&env, "ngo_sig"), &ngo_signer);
        env.storage().instance().set(&Symbol::new(&env, "gov_sig"), &gov_signer);
        env.storage().instance().set(&Symbol::new(&env, "un_sig"), &un_signer);
        
        // Initialize contract state
        env.storage().instance().set(&Symbol::new(&env, "initialized"), &true);
    }

    /// Get platform configuration
    pub fn get_config(env: Env) -> Vec<Address> {
        let mut config = Vec::new(&env);
        
        if let Some(admin) = env.storage().instance().get(&Symbol::new(&env, "admin")) {
            config.push_back(admin);
        }
        if let Some(ngo) = env.storage().instance().get(&Symbol::new(&env, "ngo_sig")) {
            config.push_back(ngo);
        }
        if let Some(gov) = env.storage().instance().get(&Symbol::new(&env, "gov_sig")) {
            config.push_back(gov);
        }
        if let Some(un) = env.storage().instance().get(&Symbol::new(&env, "un_sig")) {
            config.push_back(un);
        }
        
        config
    }

    /// Check if platform is initialized
    pub fn is_initialized(env: Env) -> bool {
        env.storage().instance()
            .get(&Symbol::new(&env, "initialized"))
            .unwrap_or(false)
    }
}
