const hre = require("hardhat");

const HOODIE = "0xC72c01AAB5f5678dc1d6f5C6d2B417d91D402Ba3";
const EXPECTED = { robinhood: 4663n, robinhoodTestnet: 46630n };

async function main() {
  const networkName = hre.network.name;
  if (!(networkName in EXPECTED)) throw new Error("Run this against robinhood or robinhoodTestnet.");
  const chain = await hre.ethers.provider.getNetwork();
  if (chain.chainId !== EXPECTED[networkName]) {
    throw new Error(`Wrong chain: expected ${EXPECTED[networkName]}, received ${chain.chainId}.`);
  }
  const hoodieCode = await hre.ethers.provider.getCode(HOODIE);
  if (hoodieCode === "0x") {
    throw new Error(`No contract code at HOODIE (${HOODIE}) on ${networkName}. Refusing to deploy.`);
  }
  const [deployer] = await hre.ethers.getSigners();
  const balance = await hre.ethers.provider.getBalance(deployer.address);
  console.log(`Network: ${networkName} (${chain.chainId})`);
  console.log(`HOODIE contract code: present (${(hoodieCode.length - 2) / 2} bytes)`);
  console.log(`Deployer: ${deployer.address}`);
  console.log(`ETH balance: ${hre.ethers.formatEther(balance)}`);
  if (balance === 0n) throw new Error("Deployer has no ETH for gas.");
  console.log("Preflight passed. Safe to run the matching deploy command.");
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
