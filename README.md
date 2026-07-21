# Hoodie Launcher Launcher

An on-chain factory for creating token launchers on Robinhood Chain. Each launcher it creates is permanently bound to the bounty's `$HOODIE` token:

`0xC72c01AAB5f5678dc1d6f5C6d2B417d91D402Ba3`

## Invariant

`HoodieTokenLauncherLauncher` contains the `$HOODIE` address as a Solidity `constant`. A launcher has no setter, upgrade mechanism, or alternative quote-token argument. Calling `launchToken` deploys the ERC-20, transfers the chosen launch allocation and creator-provided `$HOODIE` to a newly deployed pool, commits all state (checks-effects-interactions), and initializes the pool atomically before the founder allocation is transferred.

`HoodiePool.initialize` rejects a zero `lpRecipient`, so LP shares can never be silently minted to the burn address.

The pool has immutable `token`, `hoodie`, and `launcher` addresses, supports initial and subsequent proportional liquidity, and supports swaps in either direction using a 0.3% constant-product fee. No third-party AMM address is needed at deployment.

## Local verification

```powershell
npm.cmd install
npm.cmd test
```

## Browser console

Serve the repository root with any static server and open `index.html`. This is the public product site; the launch console lives at `/app/`. The console adds Robinhood Chain to an EVM wallet, saves the deployed factory address locally in the browser, creates launchers, approves `$HOODIE`, and launches funded pools. It does not collect keys or send assets to a backend.

## Hosting

This is a static site. Deploy the repository root to Netlify or Vercel with no build command; `netlify.toml` and `vercel.json` are included. After deploying the factory, open the app with `?factory=0x...` once to validate it against the immutable `$HOODIE` address and create a shareable launch-app link.

## Deployment

1. Copy `.env.example` to `.env` and provide a funded deployer key.
2. Run the network preflight. It checks chain ID, verifies contract code exists at `$HOODIE`, and checks that the deployer has ETH:

```powershell
npm.cmd run preflight:testnet
```

3. Deploy to testnet first:

```powershell
npm.cmd run deploy:testnet
```

4. Verify source on the appropriate Blockscout explorer, then run `npm.cmd run preflight:mainnet` and deploy mainnet:

```powershell
npm.cmd run deploy:mainnet
```

5. Verify the resulting factory source (replace the address):

```powershell
npm.cmd run verify:mainnet -- 0xYourFactoryAddress
```

Robinhood Chain is EVM-compatible. Its current mainnet is chain ID `4663`, and testnet is `46630`.

## Important launch-flow note

`launchToken` requires initial token and `$HOODIE` liquidity, so it cannot mint a token without a funded `$HOODIE` market. The caller approves `$HOODIE` to the launcher first; the launcher never retains user funds.

Read [SECURITY.md](./SECURITY.md) before deploying any value-bearing instance.
