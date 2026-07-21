const hre = require("hardhat");

async function main() {
  const expectedChainIds = { robinhood: 4663n, robinhoodTestnet: 46630n };
  if (!(hre.network.name in expectedChainIds)) throw new Error("Deploy only to robinhood or robinhoodTestnet.");
  const network = await hre.ethers.provider.getNetwork();
  if (network.chainId !== expectedChainIds[hre.network.name]) throw new Error("RPC returned an unexpected chain ID.");
  const hoodie = "0xC72c01AAB5f5678dc1d6f5C6d2B417d91D402Ba3";
  if (await hre.ethers.provider.getCode(hoodie) === "0x") throw new Error("HOODIE has no code on this network. Refusing to deploy.");
  const Factory = await hre.ethers.getContractFactory("HoodieTokenLauncherLauncher");
  const factory = await Factory.deploy();
  await factory.waitForDeployment();
  console.log("HoodieTokenLauncherLauncher:", await factory.getAddress());
  console.log("HOODIE:", await factory.HOODIE());
  console.log("Each launched token receives its own immutable HOODIE pool.");
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
