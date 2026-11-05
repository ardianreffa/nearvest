//! Living Tree NFT for NEARvest (NEP-171 + metadata, enumeration, approvals).
//!
//! - A tree is minted by an approved minter (the game server) when a seed is
//!   planted, directly to the player's account. The contract pays storage.
//! - Tree data (species, quality, stage, age, harvest count, birth date,
//!   parent) lives on-chain. Minters can update stage, age and harvest count.
//!   Species, quality, birth date and parent never change after minting.
//! - Token metadata is computed from the tree data on every read, so wallets
//!   always show the current stage image ("dynamic NFT").
//! - Trees stay transferable (for the P2P Market). Approvals are enabled so a
//!   market contract can sell a tree on the owner's behalf.
//! - When a tree dies it becomes a Memorial Tree: still owned and
//!   transferable as a collectible, but it can no longer be updated.

use std::collections::HashMap;

use near_contract_standards::non_fungible_token::approval::NonFungibleTokenApproval;
use near_contract_standards::non_fungible_token::core::{
    NonFungibleTokenCore, NonFungibleTokenResolver,
};
use near_contract_standards::non_fungible_token::enumeration::NonFungibleTokenEnumeration;
use near_contract_standards::non_fungible_token::events::NftMint;
use near_contract_standards::non_fungible_token::metadata::{
    NFTContractMetadata, NonFungibleTokenMetadataProvider, TokenMetadata, NFT_METADATA_SPEC,
};
use near_contract_standards::non_fungible_token::{NonFungibleToken, Token, TokenId};
use near_sdk::json_types::U128;
use near_sdk::serde_json;
use near_sdk::store::{IterableSet, LookupMap};
use near_sdk::{
    env, near, require, AccountId, BorshStorageKey, PanicOnDefault, Promise, PromiseOrValue,
};

#[derive(BorshStorageKey)]
#[near]
enum StorageKey {
    OwnerById,
    Enumeration,
    Approval,
    Trees,
    Minters,
}

/// Fruit species. New species are added at the end to keep stored data valid.
#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Species {
    Mango,
    Rambutan,
    Durian,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Quality {
    Common,
    Rare,
    Gold,
}

/// Growth stages, in order. Wilting can move a tree back one stage.
#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Stage {
    Seed,
    Sprout,
    Tree,
    Fruiting,
    Old,
}

impl Species {
    fn name(&self) -> &'static str {
        match self {
            Species::Mango => "Mango",
            Species::Rambutan => "Rambutan",
            Species::Durian => "Durian",
        }
    }
    fn slug(&self) -> &'static str {
        match self {
            Species::Mango => "mango",
            Species::Rambutan => "rambutan",
            Species::Durian => "durian",
        }
    }
}

impl Quality {
    fn name(&self) -> &'static str {
        match self {
            Quality::Common => "Common",
            Quality::Rare => "Rare",
            Quality::Gold => "Gold",
        }
    }
}

impl Stage {
    fn name(&self) -> &'static str {
        match self {
            Stage::Seed => "Seed",
            Stage::Sprout => "Sprout",
            Stage::Tree => "Tree",
            Stage::Fruiting => "Fruiting",
            Stage::Old => "Old",
        }
    }
    fn slug(&self) -> &'static str {
        match self {
            Stage::Seed => "seed",
            Stage::Sprout => "sprout",
            Stage::Tree => "tree",
            Stage::Fruiting => "fruiting",
            Stage::Old => "old",
        }
    }
}

/// On-chain data of one tree.
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct TreeData {
    pub species: Species,
    pub quality: Quality,
    pub stage: Stage,
    /// Age in game days.
    pub age_days: u32,
    pub harvest_count: u32,
    /// Block time at mint, in milliseconds since the Unix epoch.
    pub born_at_ms: u64,
    /// Token id of the tree this seed came from, if any (lineage).
    pub parent_id: Option<TokenId>,
    /// True once the tree has died and become a Memorial Tree.
    pub memorial: bool,
    pub memorial_at_ms: Option<u64>,
    pub updated_at_ms: u64,
}

/// A token together with its tree data, for game clients.
#[near(serializers = [json])]
pub struct TreeView {
    pub token_id: TokenId,
    pub owner_id: AccountId,
    pub tree: TreeData,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Contract {
    owner_id: AccountId,
    minters: IterableSet<AccountId>,
    tokens: NonFungibleToken,
    trees: LookupMap<TokenId, TreeData>,
    next_token_id: u64,
    /// When set, images are `{media_base_url}{species}_{stage}.png` (or
    /// `{species}_memorial.png`). When empty, placeholder images are used.
    media_base_url: Option<String>,
}

#[near]
impl Contract {
    #[init]
    pub fn new(owner_id: AccountId) -> Self {
        Self {
            owner_id: owner_id.clone(),
            minters: IterableSet::new(StorageKey::Minters),
            // No stored token metadata: it is computed from `trees` on read.
            tokens: NonFungibleToken::new(
                StorageKey::OwnerById,
                owner_id,
                None::<StorageKey>,
                Some(StorageKey::Enumeration),
                Some(StorageKey::Approval),
            ),
            trees: LookupMap::new(StorageKey::Trees),
            next_token_id: 1,
            media_base_url: None,
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
        self.owner_id = owner_id.clone();
        self.tokens.owner_id = owner_id;
    }

    /// Switch from placeholder images to real art, e.g. "https://nearvest.vercel.app/nft/".
    pub fn set_media_base_url(&mut self, media_base_url: Option<String>) {
        self.assert_owner();
        self.media_base_url = media_base_url;
    }

    // ---------- Minter ----------

    /// Mints a new tree (stage Seed) to `receiver_id` when a seed is planted.
    pub fn mint_tree(
        &mut self,
        receiver_id: AccountId,
        species: Species,
        quality: Quality,
        parent_id: Option<TokenId>,
    ) -> TreeView {
        self.assert_minter();
        if let Some(parent) = &parent_id {
            require!(self.trees.contains_key(parent), "Parent tree does not exist");
        }
        let token_id = self.next_token_id.to_string();
        self.next_token_id += 1;

        let now = now_ms();
        let tree = TreeData {
            species,
            quality,
            stage: Stage::Seed,
            age_days: 0,
            harvest_count: 0,
            born_at_ms: now,
            parent_id,
            memorial: false,
            memorial_at_ms: None,
            updated_at_ms: now,
        };
        self.trees.insert(token_id.clone(), tree.clone());
        // `None` refund: the contract (the game) pays for storage.
        self.tokens.internal_mint_with_refund(token_id.clone(), receiver_id.clone(), None, None);
        NftMint { owner_id: &receiver_id, token_ids: &[&token_id], memo: None }.emit();

        TreeView { token_id, owner_id: receiver_id, tree }
    }

    /// Updates the changing parts of a tree. Age and harvest count can only go up.
    pub fn update_tree(
        &mut self,
        token_id: TokenId,
        stage: Option<Stage>,
        age_days: Option<u32>,
        harvest_count: Option<u32>,
    ) -> TreeData {
        self.assert_minter();
        let mut tree = self.get_tree_or_panic(&token_id);
        require!(!tree.memorial, "Memorial trees cannot be updated");
        if let Some(stage) = stage {
            tree.stage = stage;
        }
        if let Some(age) = age_days {
            require!(age >= tree.age_days, "Age cannot go down");
            tree.age_days = age;
        }
        if let Some(count) = harvest_count {
            require!(count >= tree.harvest_count, "Harvest count cannot go down");
            tree.harvest_count = count;
        }
        tree.updated_at_ms = now_ms();
        self.trees.insert(token_id.clone(), tree.clone());
        emit_tree_event("tree_update", &token_id, &tree);
        tree
    }

    /// Turns a dead tree into a Memorial Tree. It keeps its history and stays
    /// transferable, but can no longer be updated or planted.
    pub fn make_memorial(&mut self, token_id: TokenId) -> TreeData {
        self.assert_minter();
        let mut tree = self.get_tree_or_panic(&token_id);
        require!(!tree.memorial, "Tree is already a memorial");
        let now = now_ms();
        tree.memorial = true;
        tree.memorial_at_ms = Some(now);
        tree.updated_at_ms = now;
        self.trees.insert(token_id.clone(), tree.clone());
        emit_tree_event("tree_memorial", &token_id, &tree);
        tree
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

    pub fn get_tree(&self, token_id: TokenId) -> Option<TreeView> {
        let owner_id = self.tokens.owner_by_id.get(&token_id)?;
        let tree = self.trees.get(&token_id)?.clone();
        Some(TreeView { token_id, owner_id, tree })
    }

    pub fn get_trees_for_owner(
        &self,
        account_id: AccountId,
        from_index: Option<U128>,
        limit: Option<u64>,
    ) -> Vec<TreeView> {
        self.tokens
            .nft_tokens_for_owner(account_id, from_index, limit)
            .into_iter()
            .filter_map(|t| self.get_tree(t.token_id))
            .collect()
    }
}

// ---------- Internal ----------

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

    fn get_tree_or_panic(&self, token_id: &TokenId) -> TreeData {
        self.trees.get(token_id).cloned().unwrap_or_else(|| env::panic_str("Tree not found"))
    }

    fn media_url(&self, tree: &TreeData) -> String {
        let state = if tree.memorial { "memorial" } else { tree.stage.slug() };
        match &self.media_base_url {
            Some(base) => format!("{}{}_{}.png", base, tree.species.slug(), state),
            None => {
                // Placeholder image until the real pixel art is ready.
                let (bg, fg) = if tree.memorial {
                    ("704214", "F5E6C8") // sepia
                } else {
                    match tree.quality {
                        Quality::Common => ("2E7D4F", "FFFFFF"),
                        Quality::Rare => ("8B5CF6", "FFFFFF"),
                        Quality::Gold => ("F5C542", "6B4A2F"),
                    }
                };
                let label = if tree.memorial { "Memorial" } else { tree.stage.name() };
                format!(
                    "https://placehold.co/512x512/{}/{}/png?text={}+{}",
                    bg,
                    fg,
                    tree.species.name(),
                    label
                )
            }
        }
    }

    fn token_metadata(&self, token_id: &TokenId, tree: &TreeData) -> TokenMetadata {
        let title = if tree.memorial {
            format!("Memorial {} {} #{}", tree.quality.name(), tree.species.name(), token_id)
        } else {
            format!("{} {} Tree #{}", tree.quality.name(), tree.species.name(), token_id)
        };
        let description = if tree.memorial {
            format!(
                "A Memorial Tree from the village of Tandur. It lived {} days and was harvested {} times.",
                tree.age_days, tree.harvest_count
            )
        } else {
            format!(
                "A living {} tree in the village of Tandur. Stage: {}. Age: {} days. Harvests: {}.",
                tree.species.name(),
                tree.stage.name(),
                tree.age_days,
                tree.harvest_count
            )
        };
        TokenMetadata {
            title: Some(title),
            description: Some(description),
            media: Some(self.media_url(tree)),
            media_hash: None,
            copies: Some(1),
            issued_at: Some(iso8601(tree.born_at_ms)),
            expires_at: None,
            starts_at: None,
            updated_at: Some(iso8601(tree.updated_at_ms)),
            extra: Some(serde_json::to_string(tree).unwrap()),
            reference: None,
            reference_hash: None,
        }
    }

    /// Fills in the computed metadata of a token returned by the standard library.
    fn with_metadata(&self, mut token: Token) -> Token {
        if let Some(tree) = self.trees.get(&token.token_id) {
            token.metadata = Some(self.token_metadata(&token.token_id, tree));
        }
        token
    }
}

fn now_ms() -> u64 {
    env::block_timestamp_ms()
}

fn emit_tree_event(event: &str, token_id: &str, tree: &TreeData) {
    env::log_str(&format!(
        r#"EVENT_JSON:{{"standard":"nearvest","version":"1.0.0","event":"{}","data":[{{"token_id":"{}","tree":{}}}]}}"#,
        event,
        token_id,
        serde_json::to_string(tree).unwrap()
    ));
}

/// Formats milliseconds since the Unix epoch as an ISO 8601 UTC date-time.
fn iso8601(ms: u64) -> String {
    let secs = ms / 1000;
    let (h, m, s) = ((secs / 3600) % 24, (secs / 60) % 60, secs % 60);
    // Civil-from-days algorithm (Howard Hinnant), valid for dates after 1970.
    let z = (secs / 86_400) as i64 + 719_468;
    let era = z / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = yoe + era * 400 + if month <= 2 { 1 } else { 0 };
    format!("{:04}-{:02}-{:02}T{:02}:{:02}:{:02}Z", year, month, day, h, m, s)
}

// ---------- NEP-171 core ----------

#[near]
impl NonFungibleTokenCore for Contract {
    #[payable]
    fn nft_transfer(
        &mut self,
        receiver_id: AccountId,
        token_id: TokenId,
        approval_id: Option<u64>,
        memo: Option<String>,
    ) {
        self.tokens.nft_transfer(receiver_id, token_id, approval_id, memo);
    }

    #[payable]
    fn nft_transfer_call(
        &mut self,
        receiver_id: AccountId,
        token_id: TokenId,
        approval_id: Option<u64>,
        memo: Option<String>,
        msg: String,
    ) -> PromiseOrValue<bool> {
        self.tokens.nft_transfer_call(receiver_id, token_id, approval_id, memo, msg)
    }

    fn nft_token(&self, token_id: TokenId) -> Option<Token> {
        self.tokens.nft_token(token_id).map(|t| self.with_metadata(t))
    }
}

#[near]
impl NonFungibleTokenResolver for Contract {
    #[private]
    fn nft_resolve_transfer(
        &mut self,
        previous_owner_id: AccountId,
        receiver_id: AccountId,
        token_id: TokenId,
        approved_account_ids: Option<HashMap<AccountId, u64>>,
    ) -> bool {
        self.tokens.nft_resolve_transfer(
            previous_owner_id,
            receiver_id,
            token_id,
            approved_account_ids,
        )
    }
}

// ---------- NEP-178 approvals (for the P2P Market) ----------

#[near]
impl NonFungibleTokenApproval for Contract {
    #[payable]
    fn nft_approve(
        &mut self,
        token_id: TokenId,
        account_id: AccountId,
        msg: Option<String>,
    ) -> Option<Promise> {
        self.tokens.nft_approve(token_id, account_id, msg)
    }

    #[payable]
    fn nft_revoke(&mut self, token_id: TokenId, account_id: AccountId) {
        self.tokens.nft_revoke(token_id, account_id);
    }

    #[payable]
    fn nft_revoke_all(&mut self, token_id: TokenId) {
        self.tokens.nft_revoke_all(token_id);
    }

    fn nft_is_approved(
        &self,
        token_id: TokenId,
        approved_account_id: AccountId,
        approval_id: Option<u64>,
    ) -> bool {
        self.tokens.nft_is_approved(token_id, approved_account_id, approval_id)
    }
}

// ---------- NEP-181 enumeration ----------

#[near]
impl NonFungibleTokenEnumeration for Contract {
    fn nft_total_supply(&self) -> U128 {
        self.tokens.nft_total_supply()
    }

    fn nft_tokens(&self, from_index: Option<U128>, limit: Option<u64>) -> Vec<Token> {
        self.tokens
            .nft_tokens(from_index, limit)
            .into_iter()
            .map(|t| self.with_metadata(t))
            .collect()
    }

    fn nft_supply_for_owner(&self, account_id: AccountId) -> U128 {
        self.tokens.nft_supply_for_owner(account_id)
    }

    fn nft_tokens_for_owner(
        &self,
        account_id: AccountId,
        from_index: Option<U128>,
        limit: Option<u64>,
    ) -> Vec<Token> {
        self.tokens
            .nft_tokens_for_owner(account_id, from_index, limit)
            .into_iter()
            .map(|t| self.with_metadata(t))
            .collect()
    }
}

// ---------- NEP-177 metadata ----------

#[near]
impl NonFungibleTokenMetadataProvider for Contract {
    fn nft_metadata(&self) -> NFTContractMetadata {
        NFTContractMetadata {
            spec: NFT_METADATA_SPEC.to_string(),
            name: "NEARvest Trees".to_string(),
            symbol: "TREE".to_string(),
            icon: None,
            base_uri: None,
            reference: None,
            reference_hash: None,
        }
    }
}

#[cfg(test)]
mod tests;
