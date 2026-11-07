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

// ---------- TaniBot budgets ----------

fn bot() -> AccountId {
    "bot.ardian.nearvest.testnet".parse().unwrap()
}

/// 2026-11-07 10:00 UTC, in nanoseconds.
const T0: u64 = 1_793_354_400_000_000_000;
const DAY: u64 = 86_400_000_000_000;

fn call_at(account: &AccountId, yocto: u128, ts: u64) {
    let ctx = VMContextBuilder::new()
        .current_account_id("panen.nearvest.testnet".parse().unwrap())
        .predecessor_account_id(account.clone())
        .signer_account_id(account.clone())
        .attached_deposit(NearToken::from_yoctonear(yocto))
        .block_timestamp(ts)
        .build();
    testing_env!(ctx);
}

/// ardian links bot.ardian with a 10 PANEN daily limit, the bot accepts, and
/// ardian sends it a 50 PANEN budget.
fn with_bot() -> Contract {
    let mut c = setup();
    call_at(&server(), 0, T0);
    c.mint(ardian(), U128(panen(100)), None);
    call_at(&ardian(), 1, T0);
    c.set_bot(bot(), U128(panen(10)));
    call_at(&bot(), 0, T0);
    c.bot_accept(ardian());
    call_at(&ardian(), 1, T0);
    c.ft_transfer(bot(), U128(panen(50)), Some("TaniBot budget".into()));
    c
}

#[test]
fn bot_link_needs_the_player_and_the_bot() {
    let c = with_bot();
    let info = c.bot_info(bot()).unwrap();
    assert_eq!(info.owner_id, ardian());
    assert!(info.accepted);
    assert_eq!(info.daily_limit.0, panen(10));
    assert_eq!(info.balance.0, panen(50));
    assert_eq!(info.remaining_today.0, panen(10));
    assert!(c.bot_info(budi()).is_none());
}

#[test]
fn bot_can_burn_up_to_the_daily_limit() {
    let mut c = with_bot();
    call_at(&bot(), 0, T0);
    c.burn(U128(panen(8)), Some("Shop: 1 x Fertilizer".into()));
    c.burn(U128(panen(2)), None);
    assert_eq!(c.ft_balance_of(bot()).0, panen(40));
    assert_eq!(c.bot_info(bot()).unwrap().remaining_today.0, 0);
    assert_eq!(c.village_stats().total_burned.0, panen(10));
}

#[test]
#[should_panic(expected = "TaniBot daily spending limit reached")]
fn bot_cannot_spend_more_than_the_daily_limit() {
    let mut c = with_bot();
    call_at(&bot(), 0, T0);
    c.burn(U128(panen(8)), None);
    c.burn(U128(panen(3)), None);
}

#[test]
fn the_limit_starts_again_the_next_utc_day() {
    let mut c = with_bot();
    call_at(&bot(), 0, T0);
    c.burn(U128(panen(10)), None);
    // 14 hours later it is a new UTC day (00:00 UTC = 07:00 WIB).
    call_at(&bot(), 0, T0 + 14 * DAY / 24);
    assert_eq!(c.bot_info(bot()).unwrap().remaining_today.0, panen(10));
    c.burn(U128(panen(10)), None);
    assert_eq!(c.ft_balance_of(bot()).0, panen(30));
}

#[test]
#[should_panic(expected = "A TaniBot cannot transfer tokens")]
fn bot_cannot_transfer_tokens() {
    let mut c = with_bot();
    call_at(&bot(), 1, T0);
    c.ft_transfer(budi(), U128(panen(1)), None);
}

#[test]
#[should_panic(expected = "A TaniBot cannot transfer tokens")]
fn bot_cannot_transfer_even_to_its_player() {
    let mut c = with_bot();
    call_at(&bot(), 1, T0);
    c.ft_transfer(ardian(), U128(panen(1)), None);
}

#[test]
#[should_panic(expected = "A TaniBot cannot transfer tokens")]
fn bot_cannot_transfer_call() {
    let mut c = with_bot();
    call_at(&bot(), 1, T0);
    let _ = c.ft_transfer_call(budi(), U128(panen(1)), None, String::new());
}

#[test]
fn only_the_player_can_withdraw_the_budget() {
    let mut c = with_bot();
    call_at(&ardian(), 1, T0);
    c.bot_withdraw(bot(), U128(panen(20)));
    assert_eq!(c.ft_balance_of(bot()).0, panen(30));
    assert_eq!(c.ft_balance_of(ardian()).0, panen(70));
}

#[test]
#[should_panic(expected = "Only the bot's player can withdraw")]
fn another_player_cannot_withdraw_the_budget() {
    let mut c = with_bot();
    call_at(&budi(), 1, T0);
    c.bot_withdraw(bot(), U128(panen(1)));
}

#[test]
#[should_panic(expected = "Only the bot's player can withdraw")]
fn the_contract_owner_cannot_withdraw_the_budget() {
    let mut c = with_bot();
    call_at(&owner(), 1, T0);
    c.bot_withdraw(bot(), U128(panen(1)));
}

#[test]
#[should_panic(expected = "Only the bot's player can withdraw")]
fn the_game_server_cannot_withdraw_the_budget() {
    let mut c = with_bot();
    call_at(&server(), 1, T0);
    c.bot_withdraw(bot(), U128(panen(1)));
}

#[test]
#[should_panic(expected = "Requires attached deposit of exactly 1 yoctoNEAR")]
fn withdraw_needs_a_full_access_key() {
    let mut c = with_bot();
    call_at(&ardian(), 0, T0);
    c.bot_withdraw(bot(), U128(panen(1)));
}

#[test]
fn only_the_player_can_change_the_limit() {
    let mut c = with_bot();
    call_at(&ardian(), 1, T0);
    c.set_bot(bot(), U128(panen(3)));
    assert_eq!(c.bot_info(bot()).unwrap().daily_limit.0, panen(3));
    assert!(c.bot_info(bot()).unwrap().accepted);
}

#[test]
#[should_panic(expected = "This bot belongs to another player")]
fn another_player_cannot_take_over_a_bot() {
    let mut c = with_bot();
    call_at(&budi(), 1, T0);
    c.set_bot(bot(), U128(panen(1_000)));
}

#[test]
#[should_panic(expected = "This bot belongs to another player")]
fn the_contract_owner_cannot_take_over_a_bot() {
    let mut c = with_bot();
    call_at(&owner(), 1, T0);
    c.set_bot(bot(), U128(panen(1_000)));
}

#[test]
#[should_panic(expected = "Requires attached deposit of exactly 1 yoctoNEAR")]
fn the_bot_cannot_raise_its_own_limit() {
    // The bot only has a function call key: it can never attach 1 yoctoNEAR.
    let mut c = with_bot();
    call_at(&bot(), 0, T0);
    c.set_bot(bot(), U128(panen(1_000)));
}

#[test]
#[should_panic(expected = "A player cannot be their own bot")]
fn a_bot_cannot_be_its_own_player() {
    let mut c = with_bot();
    call_at(&bot(), 1, T0);
    c.set_bot(bot(), U128(panen(1_000)));
}

#[test]
fn claiming_someone_else_as_a_bot_gives_no_power_without_their_consent() {
    // budi tries to link ardian's account as "his bot" to withdraw ardian's tokens.
    let mut c = setup();
    call_at(&server(), 0, T0);
    c.mint(ardian(), U128(panen(100)), None);
    c.mint(budi(), U128(panen(1)), None);
    call_at(&budi(), 1, T0);
    c.set_bot(ardian(), U128(0));
    // ardian never accepted: no bot rules apply, ardian can still spend and send.
    call_at(&ardian(), 0, T0);
    c.burn(U128(panen(5)), None);
    call_at(&ardian(), 1, T0);
    c.ft_transfer(budi(), U128(panen(1)), None);
    assert_eq!(c.ft_balance_of(ardian()).0, panen(94));
}

#[test]
#[should_panic(expected = "This bot has not accepted its player")]
fn claiming_someone_else_as_a_bot_cannot_withdraw_their_tokens() {
    // The attack: budi "links" ardian as his bot, then tries to pull ardian's tokens.
    let mut c = setup();
    call_at(&server(), 0, T0);
    c.mint(ardian(), U128(panen(100)), None);
    call_at(&budi(), 1, T0);
    c.set_bot(ardian(), U128(0));
    c.bot_withdraw(ardian(), U128(panen(100)));
}

#[test]
#[should_panic(expected = "This bot was linked by another player")]
fn a_bot_only_accepts_its_own_player() {
    let mut c = setup();
    call_at(&ardian(), 1, T0);
    c.set_bot(bot(), U128(panen(10)));
    call_at(&bot(), 0, T0);
    c.bot_accept(budi());
}

#[test]
fn normal_players_are_not_limited() {
    let mut c = with_bot();
    call_at(&ardian(), 0, T0);
    c.burn(U128(panen(40)), None);
    assert_eq!(c.ft_balance_of(ardian()).0, panen(10));
}

#[test]
fn a_strangers_pending_claim_cannot_block_the_real_player() {
    let mut c = setup();
    call_at(&server(), 0, T0);
    c.mint(ardian(), U128(panen(10)), None);
    // budi claims bot.ardian and ardian itself first (never accepted)...
    call_at(&budi(), 1, T0);
    c.set_bot(bot(), U128(panen(1_000)));
    c.set_bot(ardian(), U128(0));
    // ...ardian can still link his own bot, and the bot accepts ardian.
    call_at(&ardian(), 1, T0);
    c.set_bot(bot(), U128(panen(10)));
    call_at(&bot(), 0, T0);
    c.bot_accept(ardian());
    let info = c.bot_info(bot()).unwrap();
    assert_eq!(info.owner_id, ardian());
    assert_eq!(info.daily_limit.0, panen(10));
}

#[test]
#[should_panic(expected = "A bot cannot own a bot")]
fn an_accepted_bot_cannot_own_a_bot() {
    let mut c = with_bot();
    call_at(&bot(), 1, T0);
    c.set_bot(budi(), U128(panen(1)));
}
