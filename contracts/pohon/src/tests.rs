use super::*;
use near_sdk::test_utils::{get_logs, VMContextBuilder};
use near_sdk::{testing_env, NearToken};

fn owner() -> AccountId {
    "nearvest.testnet".parse().unwrap()
}
fn server() -> AccountId {
    "server.nearvest.testnet".parse().unwrap()
}
fn ardian() -> AccountId {
    "ardian.nearvest.testnet".parse().unwrap()
}
fn budi() -> AccountId {
    "budi.nearvest.testnet".parse().unwrap()
}

/// 2026-11-06T00:00:00Z in nanoseconds.
const NOV_6_NS: u64 = 1_793_923_200_000_000_000;

fn call(account: &AccountId, yocto: u128, timestamp_ns: u64) {
    let ctx = VMContextBuilder::new()
        .current_account_id("pohon.nearvest.testnet".parse().unwrap())
        .predecessor_account_id(account.clone())
        .signer_account_id(account.clone())
        .attached_deposit(NearToken::from_yoctonear(yocto))
        .block_timestamp(timestamp_ns)
        .build();
    testing_env!(ctx);
}

fn call_as(account: &AccountId) {
    call(account, 0, NOV_6_NS);
}

fn setup() -> Contract {
    call_as(&owner());
    let mut c = Contract::new(owner());
    c.add_minter(server());
    c
}

fn mint_durian(c: &mut Contract) -> TokenId {
    call_as(&server());
    c.mint_tree(ardian(), Species::Durian, Quality::Rare, None).token_id
}

#[test]
fn minter_mints_tree_to_player() {
    let mut c = setup();
    let id = mint_durian(&mut c);
    assert_eq!(id, "1");
    assert!(get_logs().iter().any(|l| l.contains("nft_mint")));

    let token = c.nft_token(id.clone()).unwrap();
    assert_eq!(token.owner_id, ardian());
    let meta = token.metadata.unwrap();
    assert_eq!(meta.title.unwrap(), "Rare Durian Tree #1");
    assert!(meta.media.unwrap().contains("Durian+Seed"));
    assert_eq!(meta.issued_at.unwrap(), "2026-11-06T00:00:00Z");

    let tree = c.get_tree(id).unwrap().tree;
    assert_eq!(tree.stage, Stage::Seed);
    assert_eq!(tree.age_days, 0);
    assert_eq!(tree.harvest_count, 0);
    assert_eq!(tree.born_at_ms, NOV_6_NS / 1_000_000);
    assert_eq!(tree.parent_id, None);
    assert!(!tree.memorial);
    assert_eq!(c.nft_total_supply().0, 1);
    assert_eq!(c.nft_supply_for_owner(ardian()).0, 1);
}

#[test]
#[should_panic(expected = "Only an approved minter can do this")]
fn non_minter_cannot_mint() {
    let mut c = setup();
    call_as(&ardian());
    c.mint_tree(ardian(), Species::Durian, Quality::Gold, None);
}

#[test]
#[should_panic(expected = "Only an approved minter can do this")]
fn tree_owner_cannot_update_own_tree() {
    let mut c = setup();
    let id = mint_durian(&mut c);
    call_as(&ardian());
    c.update_tree(id, Some(Stage::Fruiting), None, None);
}

#[test]
#[should_panic(expected = "Only the owner can do this")]
fn only_owner_can_add_minters() {
    let mut c = setup();
    call_as(&server());
    c.add_minter(ardian());
}

#[test]
fn metadata_follows_stage_updates() {
    let mut c = setup();
    let id = mint_durian(&mut c);
    call(&server(), 0, NOV_6_NS + 86_400_000_000_000);
    let tree = c.update_tree(id.clone(), Some(Stage::Fruiting), Some(5), Some(2));
    assert_eq!(tree.stage, Stage::Fruiting);
    assert!(get_logs().iter().any(|l| l.contains("tree_update")));

    let meta = c.nft_token(id).unwrap().metadata.unwrap();
    assert!(meta.media.unwrap().contains("Durian+Fruiting"));
    assert_eq!(meta.updated_at.unwrap(), "2026-11-07T00:00:00Z");
    assert!(meta.description.unwrap().contains("Harvests: 2"));
    assert!(meta.extra.unwrap().contains(r#""stage":"fruiting""#));
}

#[test]
fn wilting_can_move_stage_back() {
    let mut c = setup();
    let id = mint_durian(&mut c);
    call_as(&server());
    c.update_tree(id.clone(), Some(Stage::Tree), None, None);
    let tree = c.update_tree(id, Some(Stage::Sprout), None, None);
    assert_eq!(tree.stage, Stage::Sprout);
}

#[test]
#[should_panic(expected = "Harvest count cannot go down")]
fn harvest_count_cannot_go_down() {
    let mut c = setup();
    let id = mint_durian(&mut c);
    call_as(&server());
    c.update_tree(id.clone(), None, None, Some(3));
    c.update_tree(id, None, None, Some(2));
}

#[test]
fn media_base_url_switches_to_real_art() {
    let mut c = setup();
    let id = mint_durian(&mut c);
    call_as(&owner());
    c.set_media_base_url(Some("https://nearvest.example/nft/".into()));
    let meta = c.nft_token(id).unwrap().metadata.unwrap();
    assert_eq!(meta.media.unwrap(), "https://nearvest.example/nft/durian_seed.png");
}

#[test]
fn lineage_records_parent() {
    let mut c = setup();
    let parent = mint_durian(&mut c);
    call_as(&server());
    let child = c.mint_tree(budi(), Species::Durian, Quality::Gold, Some(parent.clone()));
    assert_eq!(child.token_id, "2");
    assert_eq!(child.tree.parent_id, Some(parent));
}

#[test]
#[should_panic(expected = "Parent tree does not exist")]
fn parent_must_exist() {
    let mut c = setup();
    call_as(&server());
    c.mint_tree(ardian(), Species::Mango, Quality::Common, Some("99".into()));
}

#[test]
fn owner_can_transfer_tree() {
    let mut c = setup();
    let id = mint_durian(&mut c);
    call(&ardian(), 1, NOV_6_NS);
    c.nft_transfer(budi(), id.clone(), None, None);
    assert_eq!(c.nft_token(id.clone()).unwrap().owner_id, budi());
    assert_eq!(c.nft_supply_for_owner(ardian()).0, 0);
    assert_eq!(c.get_trees_for_owner(budi(), None, None)[0].token_id, id);
    assert!(get_logs().iter().any(|l| l.contains("nft_transfer")));
}

#[test]
#[should_panic]
fn stranger_cannot_transfer_tree() {
    let mut c = setup();
    let id = mint_durian(&mut c);
    call(&budi(), 1, NOV_6_NS);
    c.nft_transfer(budi(), id, None, None);
}

#[test]
#[should_panic(expected = "Requires attached deposit of exactly 1 yoctoNEAR")]
fn transfer_requires_one_yocto() {
    let mut c = setup();
    let id = mint_durian(&mut c);
    call(&ardian(), 0, NOV_6_NS);
    c.nft_transfer(budi(), id, None, None);
}

#[test]
fn memorial_tree_keeps_history_and_stays_transferable() {
    let mut c = setup();
    let id = mint_durian(&mut c);
    call_as(&server());
    c.update_tree(id.clone(), Some(Stage::Old), Some(30), Some(12));
    let tree = c.make_memorial(id.clone());
    assert!(tree.memorial);
    assert_eq!(tree.harvest_count, 12);

    let meta = c.nft_token(id.clone()).unwrap().metadata.unwrap();
    assert_eq!(meta.title.unwrap(), "Memorial Rare Durian #1");
    assert!(meta.media.unwrap().contains("Memorial"));

    call(&ardian(), 1, NOV_6_NS);
    c.nft_transfer(budi(), id.clone(), None, None);
    assert_eq!(c.nft_token(id).unwrap().owner_id, budi());
}

#[test]
#[should_panic(expected = "Memorial trees cannot be updated")]
fn memorial_tree_cannot_be_updated() {
    let mut c = setup();
    let id = mint_durian(&mut c);
    call_as(&server());
    c.make_memorial(id.clone());
    c.update_tree(id, Some(Stage::Fruiting), None, None);
}

#[test]
fn iso8601_formats_dates() {
    assert_eq!(iso8601(0), "1970-01-01T00:00:00Z");
    assert_eq!(iso8601(1_793_923_200_000), "2026-11-06T00:00:00Z");
    assert_eq!(iso8601(951_782_400_000 + 3_723_000), "2000-02-29T01:02:03Z");
}
