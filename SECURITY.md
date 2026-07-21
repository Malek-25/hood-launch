# Security model

## Status

This repository is an MVP and has **not** received an independent professional security audit. It should be deployed to Robinhood Chain testnet and independently reviewed before holding material value.

## Enforced properties

| Property | Where it is enforced |
| --- | --- |
| Every created launcher uses the bounty `$HOODIE` address | `HoodieTokenLauncherLauncher.HOODIE` is a Solidity `constant`. |
| A launcher cannot select another quote asset | `HoodieTokenLauncher` exposes no quote-token setter, constructor parameter, or launch argument. |
| A launch has funded `$HOODIE` liquidity | `launchToken` transfers `$HOODIE` and the initial token allocation to a new `HoodiePool` before `initialize` succeeds. |
| The launch token supply cannot increase | `LaunchToken` has no mint function after construction. |
| The pool assets cannot change | `HoodiePool.token` and `HoodiePool.hoodie` are immutable. |
| LP shares cannot be minted to `address(0)` | `HoodiePool.initialize` rejects a zero `lpRecipient` with `ZERO_LP_RECIPIENT`. |
| The pool is protected during reserve-changing calls | `initialize`, liquidity, and swap functions use a reentrancy lock. |
| Effects precede interactions in `launchToken` | `_launches` and `launchCount` are committed before the founder-allocation transfer. |
| Launch history is independently queryable | Each launcher stores a token, pool, recipient, and fixed-supply record for every successful launch. |

## Threat model and boundaries

- **This contract cannot prevent somebody from creating an unrelated pool for the same ERC-20 elsewhere.** The enforced guarantee is that every token created through a HOOD//LAUNCH launcher receives its canonical, funded `$HOODIE` pool atomically.
- **The `addLiquidity` ratio check is strict equality.** Any rounding in the caller's calculation of the required `$HOODIE` amount may cause a revert. The frontend auto-calculates the exact matching amount using integer arithmetic, but callers using the contract directly must supply values that satisfy `tokenAmount × reserveHoodie == hoodieAmount × reserveToken` exactly.
- **The pool is a minimal constant-product AMM.** It is not a Uniswap deployment and is not automatically indexed by other DEX frontends. The included launch app and Blockscout links are the supported initial interaction surfaces.
- **Front-running and sandwich attacks cannot be eliminated in a public AMM.** All swap functions and `launchToken` expose a `minOut` or minimum-output parameter. Callers must set a meaningful slippage limit. Setting `minOut = 0` opts into full slippage exposure. The UI provides a reserve quote and a minimum-output field; it is the caller's responsibility to choose an acceptable value. This limitation is inherent to any on-chain AMM and cannot be resolved at the contract level.
- **No oracle or pricing guarantee exists.** Users choose initial liquidity and therefore the initial price. The UI should never imply a fair price or investment outcome.
- **Token names and tickers are untrusted user input.** A public frontend must make no claim that a launch is endorsed, vetted, or affiliated with Robinhood or `$HOODIE`.
- **No privileged recovery path exists.** This protects the immutable rule, but it also means mistaken launch parameters cannot be repaired by an administrator.
- **The `$HOODIE` token itself is an external contract.** The design assumes its standard ERC-20 `transfer` and `transferFrom` behavior. The deployment preflight verifies that contract code exists at the expected address; it does not audit `$HOODIE`.

## Before mainnet deployment

1. Run the provided test suite and testnet preflight.
2. Deploy to testnet, verify source, and exercise creation, launch, liquidity, and swap flows using a separate wallet.
3. Obtain an independent Solidity review covering arithmetic, ERC-20 interaction edge cases, reserve accounting, front-running behavior, and product-specific regulatory considerations.
4. Verify the mainnet factory source on Blockscout before publishing the app's share link.
5. Use a dedicated deployer wallet and retain the deployment transaction hash plus compiler settings.

## Reporting a vulnerability

Do not disclose exploitable issues in a public token-launch page. Until a dedicated security contact is configured, report issues privately to the project operator and include reproduction steps, affected contract addresses, impact, and a suggested remediation.
