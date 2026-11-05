use super::*;
use near_sdk::test_utils::{get_logs, VMContextBuilder};
use near_sdk::testing_env;

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

fn panen(n: u128) -> u128 {
    n * ONE_PANEN
}

fn call_as(account: &AccountId) {
    call_with_deposit(account, 0);
}

fn call_with_deposit(account: &AccountId, yocto: u128) {
    let ctx = VMContextBuilder::new()
        .current_account_id("panen.nearvest.testnet".parse().unwrap())
        .predecessor_account_id(account.clone())
        .signer_account_id(account.clone())
        .attached_deposit(NearToken::from_yoctonear(yocto))
        .build();
    testing_env!(ctx);
}

/// Fresh contract with `server` registered as a minter.
fn setup() -> Contract {
    call_as(&owner());
    let mut c = Contract::new(owner());
    c.add_minter(server());
    c
}

#[test]
fn fair_launch_starts_at_zero() {
    let c = setup();
    let stats = c.village_stats();
    assert_eq!(stats.total_minted.0, 0);
    assert_eq!(stats.total_burned.0, 0);
    assert_eq!(stats.circulating_supply.0, 0);
    assert_eq!(stats.season.season, 1);
    assert_eq!(stats.season.reward_divisor, 1);
    assert_eq!(c.ft_total_supply().0, 0);
    assert_eq!(c.ft_metadata().symbol, "PANEN");
    assert_eq!(c.ft_metadata().decimals, 18);
}

#[test]
fn minter_can_mint_and_new_player_is_registered() {
    let mut c = setup();
    call_as(&server());
    c.mint(ardian(), U128(panen(50)), Some("welcome pack".into()));
    assert_eq!(c.ft_balance_of(ardian()).0, panen(50));
    assert!(c.storage_balance_of(ardian()).is_some());
    assert!(get_logs().iter().any(|l| l.contains("ft_mint")));
    assert_eq!(c.village_stats().total_minted.0, panen(50));
}

#[test]
#[should_panic(expected = "Only an approved minter can do this")]
fn non_minter_cannot_mint() {
    let mut c = setup();
    call_as(&ardian());
    c.mint(ardian(), U128(panen(1_000)), None);
}

#[test]
#[should_panic(expected = "Only an approved minter can do this")]
fn owner_is_not_a_minter_by_default() {
    let mut c = setup();
    call_as(&owner());
    c.mint_reward(owner(), U128(panen(10)), None);
}

#[test]
#[should_panic(expected = "Only an approved minter can do this")]
fn removed_minter_cannot_mint() {
    let mut c = setup();
    call_as(&owner());
    c.remove_minter(server());
    call_as(&server());
    c.mint(ardian(), U128(panen(1)), None);
}

#[test]
#[should_panic(expected = "Only the owner can do this")]
fn only_owner_can_add_minters() {
    let mut c = setup();
    call_as(&ardian());
    c.add_minter(ardian());
}

#[test]
fn holder_can_burn_own_tokens() {
    let mut c = setup();
    call_as(&server());
    c.mint(ardian(), U128(panen(50)), None);
    call_as(&ardian());
    c.burn(U128(panen(5)), Some("shop: fertilizer".into()));
    assert_eq!(c.ft_balance_of(ardian()).0, panen(45));
    let stats = c.village_stats();
    assert_eq!(stats.total_minted.0, panen(50));
    assert_eq!(stats.total_burned.0, panen(5));
    assert_eq!(stats.circulating_supply.0, panen(45));
    assert!(get_logs().iter().any(|l| l.contains("ft_burn")));
}

#[test]
#[should_panic]
fn cannot_burn_more_than_balance() {
    let mut c = setup();
    call_as(&server());
    c.mint(ardian(), U128(panen(5)), None);
    call_as(&ardian());
    c.burn(U128(panen(6)), None);
}

#[test]
fn transfer_between_players() {
    let mut c = setup();
    call_as(&server());
    c.mint(ardian(), U128(panen(20)), None);
    c.mint(budi(), U128(panen(1)), None);
    call_with_deposit(&ardian(), 1);
    c.ft_transfer(budi(), U128(panen(7)), None);
    assert_eq!(c.ft_balance_of(ardian()).0, panen(13));
    assert_eq!(c.ft_balance_of(budi()).0, panen(8));
    assert_eq!(c.ft_total_supply().0, panen(21));
}

#[test]
fn halving_follows_seasons_and_stops_at_one_eighth() {
    let mut c = setup();
    call_as(&owner());
    c.set_season_thresholds(vec![U128(panen(100)), U128(panen(200)), U128(panen(300)), U128(panen(400))]);

    call_as(&server());
    // Season 1: full reward.
    assert_eq!(c.mint_reward(ardian(), U128(panen(80)), None).0, panen(80));
    assert_eq!(c.season_info().season, 1);
    assert_eq!(c.season_info().next_season_at, Some(U128(panen(100))));

    // Crosses 100 -> season 2 starts after this mint (this mint is still full).
    assert_eq!(c.mint_reward(ardian(), U128(panen(40)), None).0, panen(40));
    assert_eq!(c.season_info().season, 2);
    assert!(get_logs().iter().any(|l| l.contains("season_start")));
    assert_eq!(c.mint_reward(ardian(), U128(panen(80)), None).0, panen(40)); // 160 total

    // Exact mints ignore the Season rule.
    assert_eq!(c.mint(ardian(), U128(panen(50)), None).0, panen(50)); // 210 total -> season 3
    assert_eq!(c.season_info().reward_divisor, 4);
    assert_eq!(c.mint_reward(ardian(), U128(panen(400)), None).0, panen(100)); // 310 -> season 4

    // Season 4: 1/8 floor.
    assert_eq!(c.season_info().reward_divisor, 8);
    assert_eq!(c.mint_reward(ardian(), U128(panen(800)), None).0, panen(100)); // 410 -> season 5

    // Season 5: still 1/8 (floor), not 1/16.
    assert_eq!(c.season_info().season, 5);
    assert_eq!(c.season_info().reward_divisor, 8);
    assert_eq!(c.season_info().next_season_at, None);
    assert_eq!(c.mint_reward(ardian(), U128(panen(80)), None).0, panen(10));
}

#[test]
fn burning_does_not_rewind_the_season() {
    let mut c = setup();
    call_as(&owner());
    c.set_season_thresholds(vec![U128(panen(100))]);
    call_as(&server());
    c.mint(ardian(), U128(panen(100)), None);
    assert_eq!(c.season_info().season, 2);
    call_as(&ardian());
    c.burn(U128(panen(90)), None);
    assert_eq!(c.season_info().season, 2);
}

#[test]
fn default_thresholds_are_set() {
    let c = setup();
    let info = c.season_info();
    assert_eq!(
        info.thresholds,
        vec![U128(panen(100_000)), U128(panen(200_000)), U128(panen(400_000))]
    );
}

#[test]
#[should_panic(expected = "Thresholds must be strictly ascending")]
fn thresholds_must_be_ascending() {
    let mut c = setup();
    call_as(&owner());
    c.set_season_thresholds(vec![U128(panen(200)), U128(panen(100))]);
}

#[test]
#[should_panic(expected = "Only the owner can do this")]
fn only_owner_can_change_thresholds() {
    let mut c = setup();
    call_as(&server());
    c.set_season_thresholds(vec![U128(1)]);
}
