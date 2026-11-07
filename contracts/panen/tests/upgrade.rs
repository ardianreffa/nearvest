//! Upgrade safety test for $PANEN (sandbox only, nothing is sent to testnet).
//!
//! 1. Copies the LIVE code and data of panen.nearvest.testnet into a local
//!    sandbox (read-only RPC calls to testnet).
//! 2. Records every holder's balance, supply, minted, burned, season, owner,
//!    minters, metadata, and the raw storage.
//! 3. Deploys the new wasm (target/near/panen/panen.wasm) over it.
//! 4. Checks that all of it is exactly the same.
//! 5. Checks the TaniBot rules with a real bot account that has ONLY a
//!    function call key (burn + bot_accept): it can accept and burn within its
//!    daily limit, but cannot transfer, raise its limit or withdraw.
//!
//! Run (needs network for the testnet read and the sandbox download):
//!   cd contracts/panen && cargo near build non-reproducible-wasm
//!   cargo test -p panen --test upgrade -- --ignored --nocapture

use near_workspaces::network::Sandbox;
use near_workspaces::types::{AccessKey, KeyType, NearToken, SecretKey};
use near_workspaces::{Account, AccountId, Contract, Worker};
use serde_json::{json, Value};
use std::collections::BTreeMap;

const LIVE: &str = "panen.nearvest.testnet";
const NEW_WASM: &str = "../target/near/panen/panen.wasm";
const ONE: u128 = 1_000_000_000_000_000_000;

/// Holders = keys of the FungibleToken accounts map: prefix [0] + Borsh(AccountId).
fn holders(state: &BTreeMap<Vec<u8>, Vec<u8>>) -> Vec<String> {
    state
        .keys()
        .filter(|k| k.len() > 5 && k[0] == 0)
        .filter_map(|k| {
            let len = u32::from_le_bytes(k[1..5].try_into().ok()?) as usize;
            (k.len() == 5 + len).then(|| String::from_utf8(k[5..].to_vec()).ok()).flatten()
        })
        .collect()
}

async fn raw_state(worker: &Worker<Sandbox>, id: &AccountId) -> BTreeMap<Vec<u8>, Vec<u8>> {
    worker.view_state(id).await.unwrap().into_iter().collect()
}

async fn view(c: &Contract, method: &str, args: Value) -> Value {
    c.view(method).args_json(args).await.unwrap().json().unwrap()
}

/// Everything a player, a wallet or the game can read from the contract.
async fn snapshot(c: &Contract, holders: &[String]) -> BTreeMap<String, Value> {
    let mut s = BTreeMap::new();
    for m in ["village_stats", "season_info", "ft_total_supply", "ft_metadata", "get_owner", "get_minters", "storage_balance_bounds"] {
        s.insert(m.to_string(), view(c, m, json!({})).await);
    }
    for h in holders {
        s.insert(format!("balance {h}"), view(c, "ft_balance_of", json!({ "account_id": h })).await);
        s.insert(format!("storage {h}"), view(c, "storage_balance_of", json!({ "account_id": h })).await);
    }
    s
}

fn ok(r: near_workspaces::result::ExecutionFinalResult, what: &str) {
    assert!(r.is_success(), "{what} failed: {:?}", r.failures());
}

#[tokio::test]
#[ignore = "needs network: reads panen.nearvest.testnet and downloads the sandbox"]
async fn upgrade_keeps_live_state_and_bots_work() {
    let wasm = std::fs::read(NEW_WASM).expect("build first: cargo near build non-reproducible-wasm");
    let testnet = near_workspaces::testnet().await.unwrap();
    let worker = near_workspaces::sandbox().await.unwrap();
    let id: AccountId = LIVE.parse().unwrap();

    // 1. Live code + data -> sandbox.
    let panen = worker
        .import_contract(&id, &testnet)
        .with_data()
        .initial_balance(NearToken::from_near(50))
        .transact()
        .await
        .unwrap();

    // 2. Before.
    let state_before = raw_state(&worker, &id).await;
    let holders = holders(&state_before);
    assert!(!holders.is_empty(), "no holders found in the imported state");
    let before = snapshot(&panen, &holders).await;
    let stats = &before["village_stats"];
    println!("imported: {} storage keys, {} holders", state_before.len(), holders.len());
    println!("before: total_minted={} total_burned={} supply={} season={}",
        stats["total_minted"], stats["total_burned"], stats["circulating_supply"], stats["season"]["season"]);

    // 3. Upgrade (same account, new code; no migration function).
    ok(panen.as_account().batch(&id).deploy(&wasm).transact().await.unwrap(), "deploy new wasm");

    // 4. After: raw storage untouched and every view identical.
    let state_after = raw_state(&worker, &id).await;
    assert_eq!(state_before, state_after, "raw storage changed by the upgrade");
    let after = snapshot(&panen, &holders).await;
    for (k, v) in &before {
        assert_eq!(v, &after[k], "{k} differs after upgrade");
    }
    println!("after upgrade: {} values compared, all identical", before.len());

    // 5. TaniBot with a real function-call-only key.
    // The contract owner (nearvest.testnet) is recreated in the sandbox with a test key,
    // only to add a sandbox minter.
    let owner_id: AccountId = before["get_owner"].as_str().unwrap().parse().unwrap();
    let owner_sk = SecretKey::from_random(KeyType::ED25519);
    worker
        .patch(&owner_id)
        .account(near_workspaces::types::AccountDetailsPatch::default().balance(NearToken::from_near(10)))
        .access_key(owner_sk.public_key(), AccessKey::full_access())
        .transact()
        .await
        .unwrap();
    let owner = Account::from_secret_key(owner_id.clone(), owner_sk, &worker);
    let root = worker.root_account().unwrap();
    let minter = root.create_subaccount("minter").initial_balance(NearToken::from_near(5)).transact().await.unwrap().into_result().unwrap();
    ok(owner.call(&id, "add_minter").args_json(json!({ "account_id": minter.id() })).transact().await.unwrap(), "add_minter");

    let player = root.create_subaccount("ardian").initial_balance(NearToken::from_near(5)).transact().await.unwrap().into_result().unwrap();
    let stranger = root.create_subaccount("budi").initial_balance(NearToken::from_near(5)).transact().await.unwrap().into_result().unwrap();
    ok(minter.call(&id, "mint").args_json(json!({ "account_id": player.id(), "amount": (100 * ONE).to_string() })).transact().await.unwrap(), "mint");

    // The bot account is created by its player with ONLY a function call key.
    let bot_id: AccountId = format!("bot.{}", player.id()).parse().unwrap();
    let bot_sk = SecretKey::from_random(KeyType::ED25519);
    ok(
        player
            .batch(&bot_id)
            .create_account()
            .transfer(NearToken::from_millinear(100))
            .add_key(bot_sk.public_key(), AccessKey::function_call_access(&id, &["burn", "bot_accept"], Some(NearToken::from_millinear(250))))
            .transact()
            .await
            .unwrap(),
        "create bot account",
    );
    let bot = Account::from_secret_key(bot_id.clone(), bot_sk, &worker);
    let keys = worker.view_access_keys(&bot_id).await.unwrap();
    assert_eq!(keys.len(), 1, "the bot must have exactly one key");
    assert!(!matches!(keys[0].access_key.permission, near_workspaces::types::AccessKeyPermission::FullAccess));

    let yocto = NearToken::from_yoctonear(1);
    ok(player.call(&id, "set_bot").args_json(json!({ "bot_id": bot_id, "daily_limit": (10 * ONE).to_string() })).deposit(yocto).transact().await.unwrap(), "set_bot");
    ok(bot.call(&id, "bot_accept").args_json(json!({ "owner_id": player.id() })).transact().await.unwrap(), "bot_accept with the function call key");
    ok(player.call(&id, "ft_transfer").args_json(json!({ "receiver_id": bot_id, "amount": (50 * ONE).to_string() })).deposit(yocto).transact().await.unwrap(), "budget top-up");

    ok(bot.call(&id, "burn").args_json(json!({ "amount": (8 * ONE).to_string(), "memo": "Shop: 1 x Fertilizer" })).transact().await.unwrap(), "bot burn within limit");
    let over = bot.call(&id, "burn").args_json(json!({ "amount": (3 * ONE).to_string() })).transact().await.unwrap();
    assert!(over.is_failure() && format!("{:?}", over.failures()).contains("daily spending limit"), "burn over the limit must fail");

    // What the function call key can NOT do (rejected by the NEAR runtime or the contract).
    let transfer_1y = bot.call(&id, "ft_transfer").args_json(json!({ "receiver_id": stranger.id(), "amount": ONE.to_string() })).deposit(yocto).transact().await;
    assert!(transfer_1y.map(|r| r.is_failure()).unwrap_or(true), "bot ft_transfer with 1 yocto must fail");
    let transfer_0 = bot.call(&id, "ft_transfer").args_json(json!({ "receiver_id": stranger.id(), "amount": ONE.to_string() })).transact().await;
    assert!(transfer_0.map(|r| r.is_failure()).unwrap_or(true), "bot ft_transfer must fail");
    let transfer_call = bot.call(&id, "ft_transfer_call").args_json(json!({ "receiver_id": stranger.id(), "amount": ONE.to_string(), "msg": "" })).transact().await;
    assert!(transfer_call.map(|r| r.is_failure()).unwrap_or(true), "bot ft_transfer_call must fail");
    let raise = bot.call(&id, "set_bot").args_json(json!({ "bot_id": bot_id, "daily_limit": (1000 * ONE).to_string() })).transact().await;
    assert!(raise.map(|r| r.is_failure()).unwrap_or(true), "bot must not raise its limit");
    let steal = stranger.call(&id, "bot_withdraw").args_json(json!({ "bot_id": bot_id, "amount": ONE.to_string() })).deposit(yocto).transact().await.unwrap();
    assert!(steal.is_failure(), "a stranger must not withdraw the budget");
    let send_near = bot.transfer_near(stranger.id(), NearToken::from_millinear(10)).await;
    assert!(send_near.map(|r| r.is_failure()).unwrap_or(true), "bot must not send NEAR");

    // The player takes budget back.
    ok(player.call(&id, "bot_withdraw").args_json(json!({ "bot_id": bot_id, "amount": (12 * ONE).to_string() })).deposit(yocto).transact().await.unwrap(), "bot_withdraw by the player");
    let info = view(&panen, "bot_info", json!({ "bot_id": bot_id })).await;
    println!("bot_info: {info}");
    assert_eq!(info["owner_id"], json!(player.id()));
    assert_eq!(info["balance"], json!((30 * ONE).to_string()));
    assert_eq!(info["remaining_today"], json!((2 * ONE).to_string()));

    // Old holders are still untouched after all of this.
    for h in &holders {
        let k = format!("balance {h}");
        assert_eq!(before[&k], view(&panen, "ft_balance_of", json!({ "account_id": h })).await, "{k}");
    }
    println!("TaniBot checks passed");
}
