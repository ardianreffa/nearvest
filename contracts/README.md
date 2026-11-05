# NEARvest contracts

Rust smart contracts for NEAR testnet, built with `near-sdk` 5.30.0.

| Crate | Account (testnet) | Standard | What it does |
|---|---|---|---|
| `panen` | `panen.nearvest.testnet` | NEP-141, NEP-145, NEP-148 | $PANEN memecoin: minter-only minting (fair launch, no pre-mint), holder burn (Shop), Seasons halving with a 1/8 floor, Village Stats view |
| `pohon` | `pohon.nearvest.testnet` | NEP-171, NEP-177, NEP-178, NEP-181 | Living Tree NFT: minted on planting, updatable stage/age/harvests, lineage (`parent_id`), Memorial Trees, metadata computed live from tree data |

## Build and test

```sh
cd contracts
cargo test                                   # unit tests for both contracts
cd panen && cargo near build non-reproducible-wasm   # wasm in target/near/panen/
```

## $PANEN methods

- Owner: `add_minter`, `remove_minter`, `set_owner`, `set_season_thresholds(thresholds: [U128])`
- Minter: `mint_reward(account_id, base_amount, memo)` (Season rule applied), `mint(account_id, amount, memo)` (exact amount)
- Holder: `burn(amount, memo)`, plus standard `ft_transfer`, `ft_transfer_call`, `storage_*`
- Views: `village_stats`, `season_info`, `get_minters`, `is_minter`, `get_owner`, `ft_metadata`, `ft_balance_of`, `ft_total_supply`

Seasons are based on the total amount ever minted (burning does not rewind a season). Default thresholds: 100k, 200k, 400k PANEN.

## Tree NFT methods

- Owner: `add_minter`, `remove_minter`, `set_owner`, `set_media_base_url(media_base_url)`
- Minter: `mint_tree(receiver_id, species, quality, parent_id)`, `update_tree(token_id, stage, age_days, harvest_count)`, `make_memorial(token_id)`
- Holder: standard `nft_transfer`, `nft_transfer_call`, `nft_approve`, `nft_revoke`, `nft_revoke_all`
- Views: `get_tree`, `get_trees_for_owner`, `nft_token`, `nft_tokens`, `nft_tokens_for_owner`, `nft_supply_for_owner`, `nft_total_supply`, `nft_metadata`

Values: species `mango | rambutan | durian`, quality `common | rare | gold`, stage `seed | sprout | tree | fruiting | old`.
Species, quality, birth date and parent are fixed at mint. Age and harvest count can only increase. Memorial Trees cannot be updated but stay transferable.

Images use placeholders (`placehold.co`) until `set_media_base_url` points to the real pixel art (`{species}_{stage}.png`, `{species}_memorial.png`).
