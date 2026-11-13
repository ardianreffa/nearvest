# NEARvest contracts

Rust smart contracts for NEAR **testnet**, built with `near-sdk` 5.30.0 and `near-contract-standards`.

| Crate | Account (testnet) | Standard | What it does |
|---|---|---|---|
| `panen` | `panen.nearvest.testnet` | NEP-141, NEP-145, NEP-148 | $PANEN: minter-only minting (no pre-mint), holder burn (Shop), Seasons halving with a 1/8 floor, TaniBot budgets with a contract-enforced daily limit, Village Stats view |
| `pohon` | `pohon.nearvest.testnet` | NEP-171, NEP-177, NEP-178, NEP-181 | Living Tree NFT: minted on planting, updatable stage / age / harvests, lineage (`parent_id`), Memorial Trees, metadata built from the tree data |
| `factory` | `nearvest.testnet` | - | Creates player accounts `<name>.nearvest.testnet` (and wallet TaniBot accounts); only the creator `game.nearvest.testnet` may call `create_player` |

Owner of `panen` and `pohon`: `nearvest.testnet`. Minter of both: `game.nearvest.testnet`.

## Build and test

```sh
cd contracts
cargo test                                            # unit tests
cd panen && cargo near build non-reproducible-wasm   # wasm in target/near/panen/
```

Before upgrading the live PANEN contract: `cargo test -p panen --test upgrade -- --ignored --nocapture`
(sandbox: imports the live code and data, upgrades, compares).

## $PANEN methods

- Owner: `add_minter`, `remove_minter`, `set_owner`, `set_season_thresholds(thresholds: [U128])`
- Minter: `mint_reward(account_id, base_amount, memo)` (divided by the Season divisor), `mint(account_id, amount, memo)` (exact amount)
- Holder: `burn(amount, memo)` (own tokens only, no 1 yocto deposit so function call keys can burn), standard `ft_transfer`, `ft_transfer_call`, `storage_*`
- TaniBot budgets:
  - `set_bot(bot_id, daily_limit)` (player, 1 yoctoNEAR): link a bot and set its daily limit
  - `bot_accept(owner_id)` (the bot, callable with its function call key)
  - `bot_withdraw(bot_id, amount)` (player, 1 yoctoNEAR): take budget back from an accepted bot
  - `bot_info(bot_id)` (view)
  - A linked bot can only `burn`, up to its daily limit per UTC day (resets 00:00 UTC), and can never transfer.
- Views: `village_stats`, `season_info`, `get_minters`, `is_minter`, `get_owner`, `ft_metadata`, `ft_balance_of`, `ft_total_supply`

Seasons are based on the total ever minted (burning never rewinds a Season). Built-in default
thresholds: 100,000 / 200,000 / 400,000 PANEN. Testnet uses 2,000 / 5,000 / 10,000 (set with
`set_season_thresholds` on 2026-11-05).

## Tree NFT methods

- Owner: `add_minter`, `remove_minter`, `set_owner`, `set_media_base_url(media_base_url)`
- Minter: `mint_tree(receiver_id, species, quality, parent_id)`, `update_tree(token_id, stage, age_days, harvest_count)`, `make_memorial(token_id)`
- Holder: standard `nft_transfer`, `nft_transfer_call`, `nft_approve`, `nft_revoke`, `nft_revoke_all`
- Views: `get_tree`, `get_trees_for_owner`, `get_minters`, `is_minter`, `get_owner`, `nft_token`, `nft_tokens`, `nft_tokens_for_owner`, `nft_supply_for_owner`, `nft_total_supply`, `nft_metadata`

Values: species `mango | rambutan | durian`, quality `common | rare | gold`, stage `seed | sprout | tree | fruiting | old`.
Species, quality, birth time and parent are fixed at mint. Age and harvest count can only go up. Memorial Trees cannot be updated but stay transferable.

Images: while `media_base_url` is empty the NFTs use placeholder images (`placehold.co`). The pixel-art files are ready in `web/public/nft/` (`{species}_{stage}.png`, `{species}_memorial.png`; made by `tools/nft/make-nft-art.mjs`). The metadata is built when it is read, so one owner call `set_media_base_url("https://nearvest-six.vercel.app/nft/")` switches every tree, old and new; `set_media_base_url(null)` switches back.

## Factory methods

- Creator: `create_player(name, public_key)` (callback `on_player_created`)
- Owner (`nearvest.testnet` itself): `set_creator`
- Views: `get_creator`, `is_valid_name`, `players_created`

## Trust note

The owner (`nearvest.testnet`) can add minters, change the Season thresholds and upgrade the
contracts. On testnet this is how the game is run; a mainnet version would have to remove or lock
these powers.
