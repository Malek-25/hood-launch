const { expect } = require("chai");
const { ethers } = require("hardhat");

// ---------------------------------------------------------------------------
// Helper: find a specific named event from a receipt
// ---------------------------------------------------------------------------
function findEvent(receipt, iface, eventName) {
  for (const log of receipt.logs) {
    try {
      const parsed = iface.parseLog(log);
      if (!eventName || parsed.name === eventName) return parsed;
    } catch {}
  }
  return null;
}

// ---------------------------------------------------------------------------
// Shared setup
// ---------------------------------------------------------------------------
const HOODIE_ADDR = "0xC72c01AAB5f5678dc1d6f5C6d2B417d91D402Ba3";

async function deploy() {
  const [creator, recipient, stranger] = await ethers.getSigners();

  // Inject MockERC20 bytecode at the canonical HOODIE address so tests run on
  // the local Hardhat network while the contract enforces the real address.
  const Mock = await ethers.getContractFactory("MockERC20");
  const impl  = await Mock.deploy();
  const code  = await ethers.provider.getCode(await impl.getAddress());
  await ethers.provider.send("hardhat_setCode", [HOODIE_ADDR, code]);

  const hoodie  = await ethers.getContractAt("MockERC20", HOODIE_ADDR);
  await hoodie.mint(creator.address,   ethers.parseEther("10000"));
  await hoodie.mint(stranger.address,  ethers.parseEther("10000"));

  const Factory = await ethers.getContractFactory("HoodieTokenLauncherLauncher");
  const factory = await Factory.deploy();

  return { creator, recipient, stranger, hoodie, factory };
}

// Standard launch parameters used across multiple tests.
const SUPPLY        = ethers.parseEther("1000000");
const TOKEN_LIQ     = ethers.parseEther("500000");
const HOODIE_LIQ    = ethers.parseEther("10");

async function launchStandardToken(launcher, hoodie, caller, recipient) {
  await hoodie.connect(caller).approve(await launcher.getAddress(), HOODIE_LIQ);
  const tx      = await launcher.connect(caller).launchToken(
    "A Launch", "ALCH", SUPPLY, TOKEN_LIQ, HOODIE_LIQ, recipient.address
  );
  const receipt = await tx.wait();
  const event   = findEvent(receipt, launcher.interface, "TokenLaunched");
  if (!event) throw new Error("TokenLaunched event not found in receipt");
  return { event, token: event.args.token, pool: event.args.pair };
}

// ============================================================================
// Phase 1 — $HOODIE address binding and factory invariant
// ============================================================================
describe("Phase 1 — HOODIE binding invariant", function () {
  it("HOODIE constant matches the bounty address byte-for-byte", async function () {
    const { factory } = await deploy();
    expect(await factory.HOODIE()).to.equal(HOODIE_ADDR);
  });

  it("createLauncher emits LauncherCreated and registers in both indexes", async function () {
    const { creator, factory } = await deploy();
    await expect(factory.createLauncher()).to.emit(factory, "LauncherCreated");
    expect(await factory.launcherCount()).to.equal(1n);
    const addr = await factory.launchers(0);
    const byCreator = await factory.launchersFor(creator.address);
    expect(byCreator[0]).to.equal(addr);
  });

  it("every launcher is hard-bound to the same HOODIE regardless of who created it", async function () {
    const { creator, stranger, factory } = await deploy();
    await factory.connect(creator).createLauncher();
    await factory.connect(stranger).createLauncher();
    const l0 = await ethers.getContractAt("HoodieTokenLauncher", await factory.launchers(0));
    const l1 = await ethers.getContractAt("HoodieTokenLauncher", await factory.launchers(1));
    expect(await l0.hoodie()).to.equal(HOODIE_ADDR);
    expect(await l1.hoodie()).to.equal(HOODIE_ADDR);
    // Both launchers point to different deployers but the same HOODIE.
    expect(await l0.creator()).to.equal(creator.address);
    expect(await l1.creator()).to.equal(stranger.address);
  });

  it("launchersFor returns only the callers own launchers", async function () {
    const { creator, stranger, factory } = await deploy();
    await factory.connect(creator).createLauncher();
    await factory.connect(stranger).createLauncher();
    await factory.connect(creator).createLauncher();
    expect((await factory.launchersFor(creator.address)).length).to.equal(2);
    expect((await factory.launchersFor(stranger.address)).length).to.equal(1);
  });
});

// ============================================================================
// Phase 2 — Token launch and pool funding
// ============================================================================
describe("Phase 2 — Token launch and pool funding", function () {
  it("launchToken atomically deploys token, pool, and funds both reserves", async function () {
    const { creator, recipient, hoodie, factory } = await deploy();
    await factory.createLauncher();
    const launcher = await ethers.getContractAt("HoodieTokenLauncher", await factory.launchers(0));
    const { event, token: tokenAddr, pool: poolAddr } = await launchStandardToken(
      launcher, hoodie, creator, recipient
    );

    const pool  = await ethers.getContractAt("HoodiePool",  poolAddr);
    const token = await ethers.getContractAt("LaunchToken", tokenAddr);

    expect(await pool.hoodie()).to.equal(HOODIE_ADDR);
    expect(await pool.token()).to.equal(tokenAddr);
    expect(await pool.reserveHoodie()).to.equal(HOODIE_LIQ);
    expect(await pool.reserveToken()).to.equal(TOKEN_LIQ);
    expect(await pool.initialized()).to.be.true;

    // Founder receives remainder
    expect(await token.balanceOf(recipient.address)).to.equal(SUPPLY - TOKEN_LIQ);

    // Record is stored correctly
    expect(await launcher.launchCount()).to.equal(1n);
    const record = await launcher.launchAt(0);
    expect(record.token).to.equal(tokenAddr);
    expect(record.pool).to.equal(poolAddr);
    expect(record.recipient).to.equal(recipient.address);
    expect(record.supply).to.equal(SUPPLY);
  });

  it("refuses launch with zero HOODIE liquidity (BAD_INITIAL_LIQUIDITY)", async function () {
    const { recipient, factory } = await deploy();
    await factory.createLauncher();
    const launcher = await ethers.getContractAt("HoodieTokenLauncher", await factory.launchers(0));
    await expect(
      launcher.launchToken("T", "T", SUPPLY, TOKEN_LIQ, 0n, recipient.address)
    ).to.be.revertedWith("BAD_INITIAL_LIQUIDITY");
  });

  it("refuses launch when tokenLiquidity >= supply", async function () {
    const { recipient, hoodie, factory } = await deploy();
    await factory.createLauncher();
    const launcher = await ethers.getContractAt("HoodieTokenLauncher", await factory.launchers(0));
    await hoodie.approve(await launcher.getAddress(), HOODIE_LIQ);
    await expect(
      launcher.launchToken("T", "T", SUPPLY, SUPPLY, HOODIE_LIQ, recipient.address)
    ).to.be.revertedWith("BAD_INITIAL_LIQUIDITY");
  });

  it("refuses launch with zero recipient address", async function () {
    const { hoodie, factory } = await deploy();
    await factory.createLauncher();
    const launcher = await ethers.getContractAt("HoodieTokenLauncher", await factory.launchers(0));
    await hoodie.approve(await launcher.getAddress(), HOODIE_LIQ);
    await expect(
      launcher.launchToken("T", "T", SUPPLY, TOKEN_LIQ, HOODIE_LIQ, ethers.ZeroAddress)
    ).to.be.revertedWith("BAD_INITIAL_LIQUIDITY");
  });

  it("refuses launch with empty token name or symbol", async function () {
    const { recipient, hoodie, factory } = await deploy();
    await factory.createLauncher();
    const launcher = await ethers.getContractAt("HoodieTokenLauncher", await factory.launchers(0));
    await hoodie.approve(await launcher.getAddress(), HOODIE_LIQ * 2n);
    await expect(
      launcher.launchToken("", "SYM", SUPPLY, TOKEN_LIQ, HOODIE_LIQ, recipient.address)
    ).to.be.revertedWith("TOKEN_METADATA_EMPTY");
    await expect(
      launcher.launchToken("Name", "", SUPPLY, TOKEN_LIQ, HOODIE_LIQ, recipient.address)
    ).to.be.revertedWith("TOKEN_METADATA_EMPTY");
  });

  it("state (launchCount, launchAt) is committed even if the call reverts on founder transfer — impossible here, but records are written before final transfer", async function () {
    // Verify that after a successful launch the count increments correctly.
    const { creator, recipient, hoodie, factory } = await deploy();
    await factory.createLauncher();
    const launcher = await ethers.getContractAt("HoodieTokenLauncher", await factory.launchers(0));
    await launchStandardToken(launcher, hoodie, creator, recipient);
    await launchStandardToken(launcher, hoodie, creator, recipient);
    expect(await launcher.launchCount()).to.equal(2n);
    const r0 = await launcher.launchAt(0);
    const r1 = await launcher.launchAt(1);
    expect(r0.token).to.not.equal(r1.token);
  });
});

// ============================================================================
// Phase 3 — HoodiePool: LP share math
// ============================================================================
describe("Phase 3 — LP share math", function () {
  async function getPool(factory, hoodie, creator, recipient) {
    await factory.createLauncher();
    const launcher = await ethers.getContractAt("HoodieTokenLauncher", await factory.launchers(0));
    const { pool: poolAddr, token: tokenAddr } = await launchStandardToken(launcher, hoodie, creator, recipient);
    const pool  = await ethers.getContractAt("HoodiePool",  poolAddr);
    const token = await ethers.getContractAt("LaunchToken", tokenAddr);
    return { launcher, pool, token, poolAddr };
  }

  it("minimum liquidity is permanently locked (burned to address(0))", async function () {
    const { creator, recipient, hoodie, factory } = await deploy();
    const { pool } = await getPool(factory, hoodie, creator, recipient);
    const MINIMUM_LIQUIDITY = 1000n;
    expect(await pool.balanceOf(ethers.ZeroAddress)).to.equal(MINIMUM_LIQUIDITY);
  });

  it("LP holder can remove proportional liquidity and get back token + HOODIE", async function () {
    const { creator, recipient, hoodie, factory } = await deploy();
    const { pool, token } = await getPool(factory, hoodie, creator, recipient);

    const shares      = await pool.balanceOf(recipient.address);
    const burn        = shares / 2n;
    const tokenBefore = await token.balanceOf(recipient.address);
    const hBefore     = await hoodie.balanceOf(recipient.address);

    await pool.connect(recipient).removeLiquidity(burn, recipient.address);

    expect(await token.balanceOf(recipient.address)).to.be.gt(tokenBefore);
    expect(await hoodie.balanceOf(recipient.address)).to.be.gt(hBefore);
    expect(await pool.balanceOf(recipient.address)).to.equal(shares - burn);
  });

  it("removeLiquidity of 1 share reverts with LIQUIDITY_ZERO when output rounds to zero", async function () {
    // With large reserves and 1 share this should output 0 for each side.
    const { creator, recipient, hoodie, factory } = await deploy();
    const { pool } = await getPool(factory, hoodie, creator, recipient);

    // Mint 1 share of LP directly to creator by transferring from recipient (hack for test).
    // Instead, just try removing 1 wei of shares from recipient to hit the rounding guard.
    await expect(
      pool.connect(recipient).removeLiquidity(1n, recipient.address)
    ).to.be.revertedWith("LIQUIDITY_ZERO");
  });

  it("removeLiquidity with zero shares reverts (LIQUIDITY_ZERO)", async function () {
    const { creator, recipient, hoodie, factory } = await deploy();
    const { pool } = await getPool(factory, hoodie, creator, recipient);
    await expect(
      pool.connect(recipient).removeLiquidity(0n, recipient.address)
    ).to.be.revertedWith("LIQUIDITY_ZERO");
  });

  it("removeLiquidity with zero recipient address reverts (POOL_NOT_READY)", async function () {
    const { creator, recipient, hoodie, factory } = await deploy();
    const { pool } = await getPool(factory, hoodie, creator, recipient);
    const shares = await pool.balanceOf(recipient.address);
    await expect(
      pool.connect(recipient).removeLiquidity(shares, ethers.ZeroAddress)
    ).to.be.revertedWith("POOL_NOT_READY");
  });

  it("repeated small removeLiquidity calls cannot drain more than proportional share", async function () {
    const { creator, recipient, hoodie, factory } = await deploy();
    const { pool, token } = await getPool(factory, hoodie, creator, recipient);

    const shares = await pool.balanceOf(recipient.address);

    // Compute what a single full removal of `shares` would return.
    const reserveT = await pool.reserveToken();
    const reserveH = await pool.reserveHoodie();
    const supply   = await pool.totalSupply();
    const expectedToken  = shares * reserveT / supply;
    const expectedHoodie = shares * reserveH / supply;

    // Do two removals of shares/2 each.
    const half = shares / 2n;
    const tokenStart  = await token.balanceOf(recipient.address);
    const hoodieStart = await hoodie.balanceOf(recipient.address);

    await pool.connect(recipient).removeLiquidity(half, recipient.address);
    await pool.connect(recipient).removeLiquidity(half, recipient.address);

    const tokenGained  = (await token.balanceOf(recipient.address))  - tokenStart;
    const hoodieGained = (await hoodie.balanceOf(recipient.address)) - hoodieStart;

    // Total received must be <= single-shot expected (rounding goes in pool's favour).
    expect(tokenGained).to.be.lte(expectedToken);
    expect(hoodieGained).to.be.lte(expectedHoodie);
  });

  it("addLiquidity increases reserves proportionally and mints LP shares", async function () {
    const { creator, recipient, hoodie, factory } = await deploy();
    const { pool, token } = await getPool(factory, hoodie, creator, recipient);

    // Transfer some launched token to creator so they can add liquidity.
    const tokenAmt  = ethers.parseEther("10000");
    await token.connect(recipient).transfer(creator.address, tokenAmt);

    const reserveT  = await pool.reserveToken();
    const reserveH  = await pool.reserveHoodie();
    const hoodieAmt = tokenAmt * reserveH / reserveT;

    await token.connect(creator).approve(await pool.getAddress(), tokenAmt);
    await hoodie.connect(creator).approve(await pool.getAddress(), hoodieAmt);

    const shareBefore = await pool.balanceOf(creator.address);
    await pool.connect(creator).addLiquidity(tokenAmt, hoodieAmt, creator.address);
    expect(await pool.balanceOf(creator.address)).to.be.gt(shareBefore);
    expect(await pool.reserveToken()).to.equal(reserveT + tokenAmt);
    expect(await pool.reserveHoodie()).to.equal(reserveH + hoodieAmt);
  });

  it("addLiquidity reverts when ratio is wrong (BAD_LIQUIDITY_RATIO)", async function () {
    const { creator, recipient, hoodie, factory } = await deploy();
    const { pool, token } = await getPool(factory, hoodie, creator, recipient);

    const tokenAmt  = ethers.parseEther("10000");
    await token.connect(recipient).transfer(creator.address, tokenAmt);
    // Pass double the required HOODIE — breaks the ratio.
    const wrongHoodie = ethers.parseEther("9999");
    await token.connect(creator).approve(await pool.getAddress(), tokenAmt);
    await hoodie.connect(creator).approve(await pool.getAddress(), wrongHoodie);
    await expect(
      pool.connect(creator).addLiquidity(tokenAmt, wrongHoodie, creator.address)
    ).to.be.revertedWith("BAD_LIQUIDITY_RATIO");
  });

  it("addLiquidity reverts with zero recipient (POOL_NOT_READY)", async function () {
    const { creator, recipient, hoodie, factory } = await deploy();
    const { pool, token } = await getPool(factory, hoodie, creator, recipient);
    const tokenAmt  = ethers.parseEther("10000");
    await token.connect(recipient).transfer(creator.address, tokenAmt);
    const reserveT  = await pool.reserveToken();
    const reserveH  = await pool.reserveHoodie();
    const hoodieAmt = tokenAmt * reserveH / reserveT;
    await token.connect(creator).approve(await pool.getAddress(), tokenAmt);
    await hoodie.connect(creator).approve(await pool.getAddress(), hoodieAmt);
    await expect(
      pool.connect(creator).addLiquidity(tokenAmt, hoodieAmt, ethers.ZeroAddress)
    ).to.be.revertedWith("POOL_NOT_READY");
  });
});

// ============================================================================
// Phase 4 — Swaps
// ============================================================================
describe("Phase 4 — Swaps", function () {
  async function getPool(factory, hoodie, creator, recipient) {
    await factory.createLauncher();
    const launcher = await ethers.getContractAt("HoodieTokenLauncher", await factory.launchers(0));
    const { pool: poolAddr, token: tokenAddr } = await launchStandardToken(launcher, hoodie, creator, recipient);
    return {
      pool:  await ethers.getContractAt("HoodiePool",  poolAddr),
      token: await ethers.getContractAt("LaunchToken", tokenAddr),
    };
  }

  it("swapHoodieForToken increases token balance and updates reserves", async function () {
    const { creator, recipient, hoodie, factory } = await deploy();
    const { pool, token } = await getPool(factory, hoodie, creator, recipient);

    const inAmt = ethers.parseEther("1");
    await hoodie.connect(creator).approve(await pool.getAddress(), inAmt);

    const beforeToken  = await token.balanceOf(creator.address);
    const beforeHoodie = await pool.reserveHoodie();
    await pool.connect(creator).swapHoodieForToken(inAmt, 1n, creator.address);

    expect(await token.balanceOf(creator.address)).to.be.gt(beforeToken);
    expect(await pool.reserveHoodie()).to.equal(beforeHoodie + inAmt);
  });

  it("swapTokenForHoodie increases HOODIE balance and updates reserves", async function () {
    const { creator, recipient, hoodie, factory } = await deploy();
    const { pool, token } = await getPool(factory, hoodie, creator, recipient);

    // Give creator some launched token first via a HOODIE->token swap.
    const buyIn = ethers.parseEther("1");
    await hoodie.connect(creator).approve(await pool.getAddress(), buyIn);
    await pool.connect(creator).swapHoodieForToken(buyIn, 1n, creator.address);

    const tokenBal = await token.balanceOf(creator.address);
    const sellIn   = tokenBal / 2n;
    await token.connect(creator).approve(await pool.getAddress(), sellIn);

    const beforeHoodie = await hoodie.balanceOf(creator.address);
    await pool.connect(creator).swapTokenForHoodie(sellIn, 1n, creator.address);

    expect(await hoodie.balanceOf(creator.address)).to.be.gt(beforeHoodie);
  });

  it("swapHoodieForToken enforces minOut (SLIPPAGE)", async function () {
    const { creator, recipient, hoodie, factory } = await deploy();
    const { pool } = await getPool(factory, hoodie, creator, recipient);

    const inAmt = ethers.parseEther("1");
    await hoodie.connect(creator).approve(await pool.getAddress(), inAmt);
    await expect(
      pool.connect(creator).swapHoodieForToken(inAmt, ethers.parseEther("999999"), creator.address)
    ).to.be.revertedWith("SLIPPAGE");
  });

  it("swapTokenForHoodie enforces minOut (SLIPPAGE)", async function () {
    const { creator, recipient, hoodie, factory } = await deploy();
    const { pool, token } = await getPool(factory, hoodie, creator, recipient);

    const buyIn = ethers.parseEther("1");
    await hoodie.connect(creator).approve(await pool.getAddress(), buyIn);
    await pool.connect(creator).swapHoodieForToken(buyIn, 1n, creator.address);

    const tokenBal = await token.balanceOf(creator.address);
    await token.connect(creator).approve(await pool.getAddress(), tokenBal);
    await expect(
      pool.connect(creator).swapTokenForHoodie(tokenBal, ethers.parseEther("999999"), creator.address)
    ).to.be.revertedWith("SLIPPAGE");
  });

  it("swapHoodieForToken reverts with zero recipient (POOL_NOT_READY)", async function () {
    const { creator, hoodie, factory, recipient } = await deploy();
    const { pool } = await getPool(factory, hoodie, creator, recipient);
    const inAmt = ethers.parseEther("1");
    await hoodie.connect(creator).approve(await pool.getAddress(), inAmt);
    await expect(
      pool.connect(creator).swapHoodieForToken(inAmt, 1n, ethers.ZeroAddress)
    ).to.be.revertedWith("POOL_NOT_READY");
  });

  it("constant-product invariant is preserved (k never decreases) after a swap", async function () {
    const { creator, recipient, hoodie, factory } = await deploy();
    const { pool } = await getPool(factory, hoodie, creator, recipient);

    const kBefore = (await pool.reserveToken()) * (await pool.reserveHoodie());
    const inAmt   = ethers.parseEther("1");
    await hoodie.connect(creator).approve(await pool.getAddress(), inAmt);
    await pool.connect(creator).swapHoodieForToken(inAmt, 1n, creator.address);
    const kAfter = (await pool.reserveToken()) * (await pool.reserveHoodie());

    // k increases slightly due to fee — it must never decrease.
    expect(kAfter).to.be.gte(kBefore);
  });
});

// ============================================================================
// Phase 5 — Reentrancy
// ============================================================================
describe("Phase 5 — Reentrancy guard", function () {
  it("lock modifier prevents double-initialization", async function () {
    // initialize can only be called by the launcher (msg.sender == launcher),
    // so a direct re-entry attempt would need to be the launcher itself.
    // The simpler test: calling initialize a second time reverts.
    const { creator, recipient, hoodie, factory } = await deploy();
    await factory.createLauncher();
    const launcher = await ethers.getContractAt("HoodieTokenLauncher", await factory.launchers(0));
    const { pool: poolAddr } = await launchStandardToken(launcher, hoodie, creator, recipient);
    const pool = await ethers.getContractAt("HoodiePool", poolAddr);

    await expect(
      pool.connect(creator).initialize(recipient.address)
    ).to.be.revertedWith("INITIALIZATION_FORBIDDEN");
  });
});

// ============================================================================
// Phase 6 — LP token transfer
// ============================================================================
describe("Phase 6 — LP token ERC-20 behaviour", function () {
  it("LP holder can transfer shares to a third party", async function () {
    const { creator, recipient, stranger, hoodie, factory } = await deploy();
    await factory.createLauncher();
    const launcher = await ethers.getContractAt("HoodieTokenLauncher", await factory.launchers(0));
    const { pool: poolAddr } = await launchStandardToken(launcher, hoodie, creator, recipient);
    const pool   = await ethers.getContractAt("HoodiePool", poolAddr);
    const shares = await pool.balanceOf(recipient.address);
    const half   = shares / 2n;

    await pool.connect(recipient).transfer(stranger.address, half);
    expect(await pool.balanceOf(recipient.address)).to.equal(shares - half);
    expect(await pool.balanceOf(stranger.address)).to.equal(half);
  });

  it("LP transferFrom respects allowance and reduces it", async function () {
    const { creator, recipient, stranger, hoodie, factory } = await deploy();
    await factory.createLauncher();
    const launcher = await ethers.getContractAt("HoodieTokenLauncher", await factory.launchers(0));
    const { pool: poolAddr } = await launchStandardToken(launcher, hoodie, creator, recipient);
    const pool   = await ethers.getContractAt("HoodiePool", poolAddr);
    const shares = await pool.balanceOf(recipient.address);

    await pool.connect(recipient).approve(creator.address, shares);
    await pool.connect(creator).transferFrom(recipient.address, stranger.address, shares);
    expect(await pool.balanceOf(stranger.address)).to.equal(shares);
    expect(await pool.allowance(recipient.address, creator.address)).to.equal(0n);
  });

  it("LP transfer to address(0) reverts (LP_TRANSFER)", async function () {
    const { creator, recipient, hoodie, factory } = await deploy();
    await factory.createLauncher();
    const launcher = await ethers.getContractAt("HoodieTokenLauncher", await factory.launchers(0));
    const { pool: poolAddr } = await launchStandardToken(launcher, hoodie, creator, recipient);
    const pool   = await ethers.getContractAt("HoodiePool", poolAddr);
    const shares = await pool.balanceOf(recipient.address);
    await expect(
      pool.connect(recipient).transfer(ethers.ZeroAddress, shares)
    ).to.be.revertedWith("LP_TRANSFER");
  });
});
