# HOOD//LAUNCH — Bounty submission

**Live-build objective:** a launcher launcher for Robinhood Chain where each launcher can only create tokens that are paired with `$HOODIE` (`0xC72c01AAB5f5678dc1d6f5C6d2B417d91D402Ba3`).

## What is built

`HoodieTokenLauncherLauncher` is a permissionless factory. Anyone calls `createLauncher()`, which deploys a new `HoodieTokenLauncher`.

Every launcher is irreversibly bound to the same `$HOODIE` address. The address is a Solidity `constant`, so there is no owner action, initializer, proxy upgrade, constructor option, frontend switch, or launch-time argument that can replace it.

To launch a token, the caller provides a fixed supply, the token allocation to put into the pool, and an amount of `$HOODIE`. The launcher then completes the following in **one atomic transaction**:

1. Deploys an immutable-supply ERC-20.
2. Deploys a `HoodiePool` with immutable `token` and `$HOODIE` addresses.
3. Transfers the token allocation and approved `$HOODIE` to that pool.
4. Initializes LP shares only after both reserves are present (zero `lpRecipient` rejected).
5. Commits state (`_launches`, `launchCount`) before the final founder-allocation transfer (CEI).
6. Sends the remaining supply and LP shares to the launch recipient.

If any stage fails, no token is launched. An unfunded launch is rejected.

## Security changes made

| Issue | Fix |
| --- | --- |
| `initialize(address(0))` would silently mint LP to the burn address | Added `require(lpRecipient != address(0), "ZERO_LP_RECIPIENT")` |
| State written after external transfers in `launchToken` (CEI violation) | `_launches.push` and `launchCount++` moved before the final `transfer` to recipient |

See `SECURITY.md` for the full threat model.

## Judge checklist

1. Open `contracts/HoodieTokenLauncherLauncher.sol` and confirm `HOODIE` is `0xC72c01AAB5f5678dc1d6f5C6d2B417d91D402Ba3` and declared as `constant`.
2. Search the entire codebase for `owner`, `onlyOwner`, `upgrade`, `delegatecall`, `selfdestruct` — none exist.
3. Confirm `HoodieTokenLauncher.launchToken` has no alternate quote-token or AMM parameter.
4. Confirm it transfers approved `$HOODIE` to `new HoodiePool(token, hoodie)` before `initialize`, and state is committed before the final transfer.
5. Open `contracts/HoodiePool.sol` and confirm `hoodie` and `token` are `immutable`, that `initialize` rejects `address(0)` as `lpRecipient`, and that swaps only use those assets.
6. Run `npm install` then `npm test` — the suite covers binding, funded-pool launch, both swap directions, LP share math, dust-removal rounding, repeated removals, reentrancy (double init), second-deployer invariant, LP ERC-20 transfer, and every major revert path.

## Test suite coverage

| Test group | What it proves |
| --- | --- |
| Phase 1 — HOODIE binding | `HOODIE` constant matches; every launcher bound regardless of caller |
| Phase 2 — Token launch | Atomic deploy, funded reserves, founder allocation, revert paths |
| Phase 3 — LP share math | Minimum liquidity lock, proportional removal, dust revert, repeated-removal non-exploit, `addLiquidity` |
| Phase 4 — Swaps | Both directions, `minOut` enforcement, `k` invariant preservation |
| Phase 5 — Reentrancy | Double-init reverts |
| Phase 6 — LP ERC-20 | Transfer, `transferFrom`, allowance reduction, zero-address revert |

### Verified test run output (29/29 passing)

```
  Phase 1 — HOODIE binding invariant
    ✓ HOODIE constant matches the bounty address byte-for-byte
    ✓ createLauncher emits LauncherCreated and registers in both indexes
    ✓ every launcher is hard-bound to the same HOODIE regardless of who created it
    ✓ launchersFor returns only the callers own launchers

  Phase 2 — Token launch and pool funding
    ✓ launchToken atomically deploys token, pool, and funds both reserves
    ✓ refuses launch with zero HOODIE liquidity (BAD_INITIAL_LIQUIDITY)
    ✓ refuses launch when tokenLiquidity >= supply
    ✓ refuses launch with zero recipient address
    ✓ refuses launch with empty token name or symbol
    ✓ state (launchCount, launchAt) is committed before final transfer

  Phase 3 — LP share math
    ✓ minimum liquidity is permanently locked (burned to address(0))
    ✓ LP holder can remove proportional liquidity and get back token + HOODIE
    ✓ removeLiquidity of 1 share reverts with LIQUIDITY_ZERO when output rounds to zero
    ✓ removeLiquidity with zero shares reverts (LIQUIDITY_ZERO)
    ✓ removeLiquidity with zero recipient address reverts (POOL_NOT_READY)
    ✓ repeated small removeLiquidity calls cannot drain more than proportional share
    ✓ addLiquidity increases reserves proportionally and mints LP shares
    ✓ addLiquidity reverts when ratio is wrong (BAD_LIQUIDITY_RATIO)
    ✓ addLiquidity reverts with zero recipient (POOL_NOT_READY)

  Phase 4 — Swaps
    ✓ swapHoodieForToken increases token balance and updates reserves
    ✓ swapTokenForHoodie increases HOODIE balance and updates reserves
    ✓ swapHoodieForToken enforces minOut (SLIPPAGE)
    ✓ swapTokenForHoodie enforces minOut (SLIPPAGE)
    ✓ swapHoodieForToken reverts with zero recipient (POOL_NOT_READY)
    ✓ constant-product invariant is preserved (k never decreases) after a swap

  Phase 5 — Reentrancy guard
    ✓ lock modifier prevents double-initialization

  Phase 6 — LP token ERC-20 behaviour
    ✓ LP holder can transfer shares to a third party
    ✓ LP transferFrom respects allowance and reduces it
    ✓ LP transfer to address(0) reverts (LP_TRANSFER)

  29 passing (1s)
```

## Deployment

Robinhood Chain mainnet uses chain ID `4663` and ETH for gas. Copy `.env.example` to `.env`, set only `DEPLOYER_PRIVATE_KEY`, then run the preflight. It rejects a wrong chain, an address with no `$HOODIE` code, or a deployer with no gas:

```powershell
npm run preflight:mainnet
```

Then deploy:

```powershell
npm run deploy:mainnet
```

Verify the deployed factory source immediately afterward:

```powershell
npm run verify:mainnet -- 0xYourFactoryAddress
```

The deploy script logs the contract address and the hard-coded `$HOODIE` address. Verify the source on the Robinhood Chain Blockscout explorer after deployment. Testnet uses chain ID `46630`:

```powershell
npm run deploy:testnet
```

## Demo flow

1. Open the hosted site at **[LIVE URL — fill in after deploy]**.
2. Click "Open app" to go to `[LIVE URL]/app/`.
3. Connect an EVM wallet (Rabby, MetaMask, Robinhood Wallet) — the app requests Robinhood Chain automatically.
4. Enter the deployed factory address (`0x[FACTORY ADDRESS — fill in after deploy]`) and click "Verify & save factory". The app checks the onchain `HOODIE` constant before accepting it.
5. Click "Create launcher" to deploy a new `HoodieTokenLauncher` bound to `$HOODIE`.
6. Set a total supply, pool-token allocation, and `$HOODIE` liquidity amount.
7. Click "Approve $HOODIE & launch". Two wallet prompts: HOODIE approval, then the launch tx.
8. The app displays the token and pool addresses from the confirmed `TokenLaunched` event.

The browser app is static and non-custodial: no backend, database, analytics, private-key handling, or custody path.

## Final tweet reply — ready to send

Fill in the two placeholders once the site is live and the factory is verified on Blockscout:

> Built HOOD//LAUNCH: a permissionless launcher-launcher on Robinhood Chain. Every launcher is hard-coded to `$HOODIE` (Solidity `constant` — not a setting). Every token launch atomically deploys + seeds an immutable `$HOODIE` pool. No owner key. No upgrade path. No alternative quote token. No external AMM dependency.
>
> Factory: `0x[DEPLOYED FACTORY ADDRESS]`
> Live app: [HOSTED URL]
> Code: https://github.com/Malek-25/hood-launch
