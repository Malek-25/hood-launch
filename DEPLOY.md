# Deployment runbook

## Prerequisites

1. Node.js ≥ 18 installed.
2. `npm install` has been run.
3. A dedicated deployer wallet funded with ETH on Robinhood Chain (chain ID 4663).
4. `.env` created from `.env.example` with `DEPLOYER_PRIVATE_KEY` set. **Never commit `.env`.**

Verify `.env` is gitignored:
```powershell
git status --short
# .env must NOT appear in the output.
```

---

## Step 1 — Run tests locally

```powershell
npm test
```

All 20+ tests must pass before proceeding. The output is your proof of correctness for the submission.

---

## Step 2 — Testnet deploy and verify

```powershell
# Preflight checks: chain ID, HOODIE contract code, deployer ETH balance.
npm run preflight:testnet

# Deploy to Robinhood Chain testnet (chain ID 46630).
npm run deploy:testnet
```

Note the printed factory address, e.g. `HoodieTokenLauncherLauncher: 0xABC...123`

```powershell
# Verify source on testnet Blockscout.
npm run verify:testnet -- 0xABC...123
```

Open `https://explorer.testnet.chain.robinhood.com/address/0xABC...123` and confirm:
- Contract source is verified.
- `HOODIE()` returns `0xC72c01AAB5f5678dc1d6f5C6d2B417d91D402Ba3`.
- No owner, admin, or upgrade function exists.

Test the full UI flow on testnet before mainnet.

---

## Step 3 — Mainnet deploy and verify

```powershell
# Preflight checks against mainnet RPC.
npm run preflight:mainnet

# Deploy to Robinhood Chain mainnet (chain ID 4663).
npm run deploy:mainnet
```

Note the printed factory address, e.g. `HoodieTokenLauncherLauncher: 0xDEF...456`

```powershell
# Verify source on mainnet Blockscout.
npm run verify:mainnet -- 0xDEF...456
```

Open `https://robinhoodchain.blockscout.com/address/0xDEF...456` and confirm source is verified.

---

## Step 4 — Publish the site

### Netlify (recommended)

1. Push the repository root to a public GitHub repo.
2. Connect it to Netlify. Build command: *(leave blank)*. Publish directory: `.`
3. The `netlify.toml` security headers are applied automatically.
4. Note the live URL, e.g. `https://hoodlaunch.netlify.app`.

### Vercel alternative

1. Import the repo to Vercel. Framework preset: *Other*. Output directory: `.`
2. `vercel.json` headers are applied automatically.

---

## Step 5 — Wire the factory address into the live app

After deploy, open the live app URL with the factory address in the query string once:

```
https://YOUR-SITE-URL/app/?factory=0xDEF...456
```

Click "Verify & save factory". The app verifies the onchain `HOODIE` constant, saves the address to localStorage, and updates the URL. Copy that URL — it's your shareable launch-app link.

---

## Step 6 — Send the submission

Fill in the template in `SUBMISSION.md`:

> Built HOOD//LAUNCH: a permissionless launcher-launcher on Robinhood Chain. Every launcher is hard-coded to `$HOODIE` (Solidity `constant` — not a setting). Every token launch atomically deploys + seeds an immutable `$HOODIE` pool. No owner key. No upgrade path. No alternative quote token. No external AMM dependency.
>
> Factory: `0x[DEPLOYED FACTORY ADDRESS]`
> Live app: [HOSTED URL]
> Code: [REPO / SOURCE LINK]

Quote-tweet or reply to the bounty tweet with this text.

---

## Addresses reference

| Item | Value |
| --- | --- |
| `$HOODIE` (hardcoded constant) | `0xC72c01AAB5f5678dc1d6f5C6d2B417d91D402Ba3` |
| Robinhood Chain mainnet chain ID | `4663` |
| Robinhood Chain testnet chain ID | `46630` |
| Mainnet RPC | `https://rpc.mainnet.chain.robinhood.com` |
| Testnet RPC | `https://rpc.testnet.chain.robinhood.com` |
| Mainnet explorer | `https://robinhoodchain.blockscout.com` |
| Testnet explorer | `https://explorer.testnet.chain.robinhood.com` |
| Deployed factory (fill in) | `0x[TO BE FILLED]` |
| Live site (fill in) | `[TO BE FILLED]` |
