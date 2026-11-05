//! Player account factory, deployed on `nearvest.testnet`.
//!
//! On NEAR only `nearvest.testnet` itself can create `<name>.nearvest.testnet`.
//! This tiny contract lets the game server account (`creator_id`, e.g.
//! `game.nearvest.testnet`) create player sub-accounts without holding the
//! main account's full access key.
//!
//! The creator attaches the NEAR that funds the new account's storage; it is
//! forwarded in full. If creation fails (for example the name is taken), the
//! deposit is refunded to the creator.

use near_sdk::{
    env, near, require, AccountId, Gas, NearToken, PanicOnDefault, Promise, PromiseError,
    PublicKey,
};

/// Minimum NEAR a new player account must receive (covers account + key storage).
pub const MIN_DEPOSIT: NearToken = NearToken::from_millinear(2);

/// Names that players cannot take.
pub const RESERVED: [&str; 14] = [
    "game", "panen", "pohon", "garden", "market", "bot", "admin", "owner", "nearvest", "darto",
    "tanibot", "lumbung", "judge", "system",
];

const CALLBACK_GAS: Gas = Gas::from_tgas(10);

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Contract {
    /// The only account allowed to create players (the game server).
    creator_id: AccountId,
    players_created: u64,
}

#[near]
impl Contract {
    #[init]
    pub fn new(creator_id: AccountId) -> Self {
        Self { creator_id, players_created: 0 }
    }

    /// Only this contract's own account (`nearvest.testnet`) can change the creator.
    pub fn set_creator(&mut self, creator_id: AccountId) {
        require!(
            env::predecessor_account_id() == env::current_account_id(),
            "Only the factory account can change the creator"
        );
        self.creator_id = creator_id;
    }

    /// Creates `<name>.<this account>` with `public_key` as its full access key.
    #[payable]
    pub fn create_player(&mut self, name: String, public_key: PublicKey) -> Promise {
        let creator = env::predecessor_account_id();
        require!(creator == self.creator_id, "Only the game server can create players");
        let deposit = env::attached_deposit();
        require!(deposit >= MIN_DEPOSIT, "Attach at least 0.002 NEAR");
        assert_valid_name(&name);

        let account_id: AccountId = format!("{}.{}", name, env::current_account_id())
            .parse()
            .unwrap_or_else(|_| env::panic_str("Invalid account name"));

        Promise::new(account_id.clone())
            .create_account()
            .transfer(deposit)
            .add_full_access_key(public_key)
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(CALLBACK_GAS)
                    .on_player_created(account_id, creator, deposit),
            )
    }

    #[private]
    pub fn on_player_created(
        &mut self,
        account_id: AccountId,
        creator: AccountId,
        deposit: NearToken,
        #[callback_result] result: Result<(), PromiseError>,
    ) -> bool {
        if result.is_ok() {
            self.players_created += 1;
            env::log_str(&format!(
                r#"EVENT_JSON:{{"standard":"nearvest","version":"1.0.0","event":"player_created","data":[{{"account_id":"{}"}}]}}"#,
                account_id
            ));
            true
        } else {
            // Name taken or other failure: give the deposit back.
            let _ = Promise::new(creator).transfer(deposit);
            false
        }
    }

    pub fn get_creator(&self) -> AccountId {
        self.creator_id.clone()
    }

    pub fn players_created(&self) -> u64 {
        self.players_created
    }

    /// Lets the game check a name before trying to create it.
    pub fn is_valid_name(&self, name: String) -> bool {
        name_error(&name).is_none()
    }
}

fn assert_valid_name(name: &str) {
    if let Some(err) = name_error(name) {
        env::panic_str(err);
    }
}

/// Rules: 2-32 chars, lowercase letters and digits, single '-' or '_' between
/// them (no dots, so players cannot create deeper sub-accounts), not reserved.
pub fn name_error(name: &str) -> Option<&'static str> {
    if name.len() < 2 || name.len() > 32 {
        return Some("Name must be 2-32 characters");
    }
    let bytes = name.as_bytes();
    let is_alnum = |b: u8| b.is_ascii_lowercase() || b.is_ascii_digit();
    if !is_alnum(bytes[0]) || !is_alnum(bytes[bytes.len() - 1]) {
        return Some("Name must start and end with a letter or digit");
    }
    let mut prev_sep = false;
    for &b in bytes {
        if is_alnum(b) {
            prev_sep = false;
        } else if b == b'-' || b == b'_' {
            if prev_sep {
                return Some("Name cannot have two separators in a row");
            }
            prev_sep = true;
        } else {
            return Some("Use only lowercase letters, digits, '-' or '_'");
        }
    }
    if RESERVED.contains(&name) {
        return Some("This name is reserved");
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::VMContextBuilder;
    use near_sdk::testing_env;

    fn game() -> AccountId {
        "game.nearvest.testnet".parse().unwrap()
    }

    fn ctx(predecessor: &str, deposit: NearToken) {
        testing_env!(VMContextBuilder::new()
            .current_account_id("nearvest.testnet".parse().unwrap())
            .predecessor_account_id(predecessor.parse().unwrap())
            .attached_deposit(deposit)
            .build());
    }

    fn key() -> PublicKey {
        "ed25519:6E8sCci9badyRkXb3JoRpBj5p8C6Tw41ELDZoiihKEtp".parse().unwrap()
    }

    #[test]
    fn name_rules() {
        assert_eq!(name_error("ardian"), None);
        assert_eq!(name_error("budi-99"), None);
        assert_eq!(name_error("a_b"), None);
        assert!(name_error("a").is_some());
        assert!(name_error("Ardian").is_some());
        assert!(name_error("ardian.bot").is_some());
        assert!(name_error("-ardian").is_some());
        assert!(name_error("ar--dian").is_some());
        assert!(name_error("game").is_some());
        assert!(name_error(&"x".repeat(33)).is_some());
    }

    #[test]
    fn creator_can_create_player() {
        ctx("nearvest.testnet", NearToken::from_yoctonear(0));
        let mut c = Contract::new(game());
        ctx("game.nearvest.testnet", NearToken::from_millinear(3));
        let _ = c.create_player("ardian".into(), key());
    }

    #[test]
    #[should_panic(expected = "Only the game server can create players")]
    fn stranger_cannot_create_player() {
        ctx("nearvest.testnet", NearToken::from_yoctonear(0));
        let mut c = Contract::new(game());
        ctx("evil.testnet", NearToken::from_millinear(3));
        let _ = c.create_player("ardian".into(), key());
    }

    #[test]
    #[should_panic(expected = "Attach at least 0.002 NEAR")]
    fn deposit_is_required() {
        ctx("nearvest.testnet", NearToken::from_yoctonear(0));
        let mut c = Contract::new(game());
        ctx("game.nearvest.testnet", NearToken::from_millinear(1));
        let _ = c.create_player("ardian".into(), key());
    }

    #[test]
    #[should_panic(expected = "This name is reserved")]
    fn reserved_names_are_rejected() {
        ctx("nearvest.testnet", NearToken::from_yoctonear(0));
        let mut c = Contract::new(game());
        ctx("game.nearvest.testnet", NearToken::from_millinear(3));
        let _ = c.create_player("panen".into(), key());
    }

    #[test]
    #[should_panic(expected = "Only the factory account can change the creator")]
    fn only_self_can_change_creator() {
        ctx("nearvest.testnet", NearToken::from_yoctonear(0));
        let mut c = Contract::new(game());
        ctx("game.nearvest.testnet", NearToken::from_yoctonear(0));
        c.set_creator("evil.testnet".parse().unwrap());
    }
}
