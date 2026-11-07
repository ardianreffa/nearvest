//! $PANEN — the NEARvest harvest memecoin (NEP-141).
//!
//! Mechanics enforced by this contract:
//! - Fair launch: no pre-mint, 0% team. Tokens are only created by approved
//!   minter accounts (the game server and Mr. Darto), managed by the owner.
//! - Burn: any holder can burn their own tokens (used by the Shop: 100% of
//!   spending is burned).
//! - Seasons (halving): every time the total amount ever minted passes a
//!   threshold, harvest rewards minted through `mint_reward` are halved.
//!   Rewards never drop below 1/8 of the original amount.
//! - Village Stats views: total minted, total burned, circulating supply,
//!   current season.
//! - TaniBot budgets (agent wallets): a player links their TaniBot account
//!   (`set_bot` by the player, then `bot_accept` by the bot). A linked bot can
//!   only burn (Shop purchases) up to its daily limit; it can never transfer
//!   tokens. Only its player can change the limit or take the budget back
//!   (`bot_withdraw`). The limit is enforced here, not by the AI or the server.

use near_contract_standards::fungible_token::events::{FtBurn, FtMint};
use near_contract_standards::fungible_token::metadata::{
    FungibleTokenMetadata, FungibleTokenMetadataProvider, FT_METADATA_SPEC,
};
use near_contract_standards::fungible_token::{
    FungibleToken, FungibleTokenCore, FungibleTokenResolver,
};
use near_contract_standards::storage_management::{
    StorageBalance, StorageBalanceBounds, StorageManagement,
};
use near_sdk::json_types::U128;
use near_sdk::store::IterableSet;
use near_sdk::borsh::{BorshDeserialize, BorshSerialize};
use near_sdk::{
    assert_one_yocto, env, near, require, AccountId, BorshStorageKey, NearToken, PanicOnDefault,
    PromiseOrValue,
};

/// 1 PANEN expressed in the smallest unit (18 decimals).
pub const ONE_PANEN: u128 = 1_000_000_000_000_000_000;

/// Rewards can be halved at most 3 times: the floor is 1/8 of the base reward.
pub const MAX_HALVINGS: u32 = 3;

/// Default season thresholds (total ever minted, in whole PANEN).
/// Season 1 lasts until 100k PANEN are minted, season 2 until 200k, season 3
/// until 400k, and season 4 (the 1/8 floor) after that. The owner can change
/// these at any time with `set_season_thresholds`.
pub const DEFAULT_THRESHOLDS: [u128; 3] = [100_000, 200_000, 400_000];

/// Data URL icon for wallets: a small mint-green pixel seedling.
const ICON: &str = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 8 8' shape-rendering='crispEdges'%3E%3Crect width='8' height='8' fill='%2300EC97'/%3E%3Crect x='3' y='3' width='2' height='4' fill='%236B4A2F'/%3E%3Crect x='1' y='1' width='3' height='2' fill='%232E7D4F'/%3E%3Crect x='4' y='1' width='3' height='2' fill='%232E7D4F'/%3E%3C/svg%3E";

#[derive(BorshStorageKey)]
#[near]
enum StorageKey {
    Accounts,
    Minters,
}

#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq)]
pub struct SeasonInfo {
    /// Current season, starting at 1.
    pub season: u32,
    /// Base rewards are divided by this number (1, 2, 4 or 8).
    pub reward_divisor: u32,
    /// Total minted at which the next season starts, if any.
    pub next_season_at: Option<U128>,
    /// All thresholds (total ever minted, smallest units).
    pub thresholds: Vec<U128>,
}

#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq)]
pub struct VillageStats {
    pub total_minted: U128,
    pub total_burned: U128,
    pub circulating_supply: U128,
    pub season: SeasonInfo,
}

/// Nanoseconds in one day. Bot days start at 00:00 UTC (= 07:00 WIB, the village day).
const DAY_NS: u64 = 86_400_000_000_000;

/// Bot records live under their own storage keys (`bot:<account>`), outside the
/// contract struct, so upgrading the contract keeps the old state readable as is.
const BOT_KEY_PREFIX: &[u8] = b"bot:";

/// A TaniBot linked to its player. Stored with Borsh.
#[derive(BorshSerialize, BorshDeserialize, Clone, Debug, PartialEq)]
#[borsh(crate = "near_sdk::borsh")]
pub struct BotRecord {
    /// The player who owns the bot: the only one who can set the limit or withdraw.
    pub owner_id: AccountId,
    /// The bot confirmed the link (`bot_accept`). Until then no bot rule applies.
    pub accepted: bool,
    /// Most the bot may burn per UTC day, in smallest units.
    pub daily_limit: u128,
    /// UTC day number of `spent_today`.
    pub day: u64,
    pub spent_today: u128,
}

#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq)]
pub struct BotInfo {
    pub owner_id: AccountId,
    pub accepted: bool,
    pub daily_limit: U128,
    pub spent_today: U128,
    pub remaining_today: U128,
    pub balance: U128,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Contract {
    owner_id: AccountId,
    minters: IterableSet<AccountId>,
    token: FungibleToken,
    total_minted: u128,
    total_burned: u128,
    /// Ascending list of total-minted thresholds that start a new season.
    season_thresholds: Vec<u128>,
}

#[near]
impl Contract {
    /// Deploys the token with zero supply. Nothing is minted here (fair launch).
    #[init]
    pub fn new(owner_id: AccountId) -> Self {
        Self {
            owner_id,
            minters: IterableSet::new(StorageKey::Minters),
            token: FungibleToken::new(StorageKey::Accounts),
            total_minted: 0,
            total_burned: 0,
            season_thresholds: DEFAULT_THRESHOLDS.iter().map(|t| t * ONE_PANEN).collect(),
        }
    }

    // ---------- Owner ----------

    pub fn add_minter(&mut self, account_id: AccountId) {
        self.assert_owner();
        self.minters.insert(account_id);
    }

    pub fn remove_minter(&mut self, account_id: AccountId) {
        self.assert_owner();
        self.minters.remove(&account_id);
    }

    pub fn set_owner(&mut self, owner_id: AccountId) {
        self.assert_owner();
        self.owner_id = owner_id;
    }

    /// Thresholds are "total ever minted" values in smallest units and must be
    /// strictly ascending.
    pub fn set_season_thresholds(&mut self, thresholds: Vec<U128>) {
        self.assert_owner();
        let values: Vec<u128> = thresholds.into_iter().map(|t| t.0).collect();
        require!(
            values.windows(2).all(|w| w[0] < w[1]),
            "Thresholds must be strictly ascending"
        );
        self.season_thresholds = values;
    }

    // ---------- Minter ----------

    /// Mints a harvest reward. The Season rule is applied: `base_amount` is
    /// divided by 1, 2, 4 or 8 depending on the current season.
    /// Returns the amount actually minted.
    pub fn mint_reward(
        &mut self,
        account_id: AccountId,
        base_amount: U128,
        memo: Option<String>,
    ) -> U128 {
        self.assert_minter();
        let amount = base_amount.0 / self.reward_divisor() as u128;
        self.internal_mint(&account_id, amount, memo.as_deref());
        U128(amount)
    }

    /// Mints an exact amount without the Season rule (for example the
    /// welcome pack or daily check-in, which stay the same in every season).
    pub fn mint(&mut self, account_id: AccountId, amount: U128, memo: Option<String>) -> U128 {
        self.assert_minter();
        self.internal_mint(&account_id, amount.0, memo.as_deref());
        amount
    }

    // ---------- Holders ----------

    /// Burns the caller's own tokens. Used when spending in the Shop.
    pub fn burn(&mut self, amount: U128, memo: Option<String>) {
        let account_id = env::predecessor_account_id();
        require!(amount.0 > 0, "Amount must be positive");
        // A linked TaniBot may only burn within its daily limit.
        if let Some(mut bot) = self.bot(&account_id).filter(|b| b.accepted) {
            let day = today();
            if bot.day != day {
                bot.day = day;
                bot.spent_today = 0;
            }
            let spent = bot.spent_today + amount.0;
            require!(spent <= bot.daily_limit, "TaniBot daily spending limit reached");
            bot.spent_today = spent;
            self.save_bot(&account_id, &bot);
        }
        self.token.internal_withdraw(&account_id, amount.0);
        self.total_burned += amount.0;
        FtBurn { owner_id: &account_id, amount, memo: memo.as_deref() }.emit();
    }

    // ---------- TaniBot budgets ----------

    /// Called by the PLAYER (needs 1 yoctoNEAR, so only a full access key can do
    /// it): links `bot_id` as their TaniBot with a daily spending limit, or
    /// changes the limit of their bot. A bot already linked to another player
    /// cannot be taken over.
    #[payable]
    pub fn set_bot(&mut self, bot_id: AccountId, daily_limit: U128) {
        assert_one_yocto();
        let owner_id = env::predecessor_account_id();
        require!(bot_id != owner_id, "A player cannot be their own bot");
        require!(!self.bot(&owner_id).is_some_and(|b| b.accepted), "A bot cannot own a bot");
        let record = match self.bot(&bot_id) {
            Some(mut r) if r.accepted => {
                require!(r.owner_id == owner_id, "This bot belongs to another player");
                r.daily_limit = daily_limit.0;
                r
            }
            // New, or only claimed but never accepted: a pending claim cannot block the real player.
            _ => BotRecord { owner_id, accepted: false, daily_limit: daily_limit.0, day: 0, spent_today: 0 },
        };
        self.save_bot(&bot_id, &record);
        env::log_str(&format!(
            r#"EVENT_JSON:{{"standard":"nearvest","version":"1.0.0","event":"bot_set","data":[{{"bot_id":"{}","owner_id":"{}","daily_limit":"{}"}}]}}"#,
            bot_id, record.owner_id, record.daily_limit
        ));
    }

    /// Called by the BOT account: confirms the link created by its player. This
    /// consent step stops anyone from claiming someone else's account as a bot.
    pub fn bot_accept(&mut self, owner_id: AccountId) {
        let bot_id = env::predecessor_account_id();
        let mut record = self.bot(&bot_id).unwrap_or_else(|| env::panic_str("No player has linked this bot"));
        require!(record.owner_id == owner_id, "This bot was linked by another player");
        record.accepted = true;
        if !self.token.accounts.contains_key(&bot_id) {
            self.token.internal_register_account(&bot_id);
        }
        self.save_bot(&bot_id, &record);
    }

    /// Called by the PLAYER (1 yoctoNEAR): moves budget from their bot back to them.
    #[payable]
    pub fn bot_withdraw(&mut self, bot_id: AccountId, amount: U128) {
        assert_one_yocto();
        let owner_id = env::predecessor_account_id();
        let record = self.bot(&bot_id).unwrap_or_else(|| env::panic_str("Not a bot"));
        require!(record.owner_id == owner_id, "Only the bot's player can withdraw");
        // Without the bot's consent the "owner" has no power over the account.
        require!(record.accepted, "This bot has not accepted its player");
        require!(amount.0 > 0, "Amount must be positive");
        if !self.token.accounts.contains_key(&owner_id) {
            self.token.internal_register_account(&owner_id);
        }
        self.token.internal_transfer(&bot_id, &owner_id, amount.0, Some("TaniBot budget returned".to_string()));
    }

    pub fn bot_info(&self, bot_id: AccountId) -> Option<BotInfo> {
        self.bot(&bot_id).map(|r| {
            let spent = if r.day == today() { r.spent_today } else { 0 };
            BotInfo {
                owner_id: r.owner_id.clone(),
                accepted: r.accepted,
                daily_limit: U128(r.daily_limit),
                spent_today: U128(spent),
                remaining_today: U128(r.daily_limit.saturating_sub(spent)),
                balance: self.token.ft_balance_of(bot_id.clone()),
            }
        })
    }

    // ---------- Views ----------

    pub fn get_owner(&self) -> AccountId {
        self.owner_id.clone()
    }

    pub fn get_minters(&self) -> Vec<AccountId> {
        self.minters.iter().cloned().collect()
    }

    pub fn is_minter(&self, account_id: AccountId) -> bool {
        self.minters.contains(&account_id)
    }

    pub fn season_info(&self) -> SeasonInfo {
        let passed = self.thresholds_passed();
        SeasonInfo {
            season: passed + 1,
            reward_divisor: self.reward_divisor(),
            next_season_at: self.season_thresholds.get(passed as usize).map(|t| U128(*t)),
            thresholds: self.season_thresholds.iter().map(|t| U128(*t)).collect(),
        }
    }

    pub fn village_stats(&self) -> VillageStats {
        VillageStats {
            total_minted: U128(self.total_minted),
            total_burned: U128(self.total_burned),
            circulating_supply: U128(self.token.total_supply),
            season: self.season_info(),
        }
    }
}

// ---------- Internal ----------

fn bot_key(account_id: &AccountId) -> Vec<u8> {
    [BOT_KEY_PREFIX, account_id.as_bytes()].concat()
}

fn today() -> u64 {
    env::block_timestamp() / DAY_NS
}

impl Contract {
    fn assert_owner(&self) {
        require!(env::predecessor_account_id() == self.owner_id, "Only the owner can do this");
    }

    fn assert_minter(&self) {
        require!(
            self.minters.contains(&env::predecessor_account_id()),
            "Only an approved minter can do this"
        );
    }

    fn bot(&self, account_id: &AccountId) -> Option<BotRecord> {
        env::storage_read(&bot_key(account_id)).map(|bytes| {
            BotRecord::try_from_slice(&bytes).unwrap_or_else(|_| env::panic_str("Corrupt bot record"))
        })
    }

    fn save_bot(&mut self, account_id: &AccountId, record: &BotRecord) {
        env::storage_write(&bot_key(account_id), &near_sdk::borsh::to_vec(record).unwrap());
    }

    /// Linked TaniBots can never send tokens (their budget goes back via `bot_withdraw`).
    fn assert_not_bot(&self, account_id: &AccountId) {
        require!(
            !self.bot(account_id).is_some_and(|b| b.accepted),
            "A TaniBot cannot transfer tokens"
        );
    }

    fn thresholds_passed(&self) -> u32 {
        self.season_thresholds.iter().filter(|t| self.total_minted >= **t).count() as u32
    }

    fn reward_divisor(&self) -> u32 {
        1 << self.thresholds_passed().min(MAX_HALVINGS)
    }

    fn internal_mint(&mut self, account_id: &AccountId, amount: u128, memo: Option<&str>) {
        require!(amount > 0, "Amount must be positive");
        let season_before = self.thresholds_passed();
        // The game pays storage for new players: register them automatically.
        if !self.token.accounts.contains_key(account_id) {
            self.token.internal_register_account(account_id);
        }
        self.token.internal_deposit(account_id, amount);
        self.total_minted += amount;
        FtMint { owner_id: account_id, amount: U128(amount), memo }.emit();

        let season_after = self.thresholds_passed();
        if season_after > season_before {
            env::log_str(&format!(
                r#"EVENT_JSON:{{"standard":"nearvest","version":"1.0.0","event":"season_start","data":[{{"season":{},"reward_divisor":{}}}]}}"#,
                season_after + 1,
                self.reward_divisor()
            ));
        }
    }
}

// ---------- NEP-141 core ----------

#[near]
impl FungibleTokenCore for Contract {
    #[payable]
    fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>) {
        self.assert_not_bot(&env::predecessor_account_id());
        self.token.ft_transfer(receiver_id, amount, memo)
    }

    #[payable]
    fn ft_transfer_call(
        &mut self,
        receiver_id: AccountId,
        amount: U128,
        memo: Option<String>,
        msg: String,
    ) -> PromiseOrValue<U128> {
        self.assert_not_bot(&env::predecessor_account_id());
        self.token.ft_transfer_call(receiver_id, amount, memo, msg)
    }

    fn ft_total_supply(&self) -> U128 {
        self.token.ft_total_supply()
    }

    fn ft_balance_of(&self, account_id: AccountId) -> U128 {
        self.token.ft_balance_of(account_id)
    }
}

#[near]
impl FungibleTokenResolver for Contract {
    #[private]
    fn ft_resolve_transfer(
        &mut self,
        sender_id: AccountId,
        receiver_id: AccountId,
        amount: U128,
    ) -> U128 {
        let (used_amount, burned_amount) =
            self.token.internal_ft_resolve_transfer(&sender_id, receiver_id, amount);
        // Tokens returned to an account that unregistered in the meantime are burned.
        self.total_burned += burned_amount;
        used_amount.into()
    }
}

// ---------- NEP-145 storage management ----------

#[near]
impl StorageManagement for Contract {
    #[payable]
    fn storage_deposit(
        &mut self,
        account_id: Option<AccountId>,
        registration_only: Option<bool>,
    ) -> StorageBalance {
        self.token.storage_deposit(account_id, registration_only)
    }

    #[payable]
    fn storage_withdraw(&mut self, amount: Option<NearToken>) -> StorageBalance {
        self.token.storage_withdraw(amount)
    }

    #[payable]
    fn storage_unregister(&mut self, force: Option<bool>) -> bool {
        self.assert_not_bot(&env::predecessor_account_id());
        if let Some((_account_id, balance)) = self.token.internal_storage_unregister(force) {
            // A forced unregister burns the remaining balance.
            self.total_burned += balance;
            true
        } else {
            false
        }
    }

    fn storage_balance_bounds(&self) -> StorageBalanceBounds {
        self.token.storage_balance_bounds()
    }

    fn storage_balance_of(&self, account_id: AccountId) -> Option<StorageBalance> {
        self.token.storage_balance_of(account_id)
    }
}

// ---------- NEP-148 metadata ----------

#[near]
impl FungibleTokenMetadataProvider for Contract {
    fn ft_metadata(&self) -> FungibleTokenMetadata {
        FungibleTokenMetadata {
            spec: FT_METADATA_SPEC.to_string(),
            name: "Panen".to_string(),
            symbol: "PANEN".to_string(),
            icon: Some(ICON.to_string()),
            reference: None,
            reference_hash: None,
            decimals: 18,
        }
    }
}

#[cfg(test)]
mod tests;
