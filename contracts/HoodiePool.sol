// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20Pool {
    function transfer(address to, uint256 value) external returns (bool);
    function transferFrom(address from, address to, uint256 value) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

/// @notice A minimal constant-product pool permanently pairing one launched token with HOODIE.
/// @dev This is intentionally a purpose-built launch pool, not an upgradeable router or proxy.
contract HoodiePool {
    uint256 private constant FEE_NUMERATOR = 997;
    uint256 private constant FEE_DENOMINATOR = 1000;
    uint256 private constant MINIMUM_LIQUIDITY = 1_000;

    address public immutable token;
    address public immutable hoodie;
    address public immutable launcher;
    uint256 public reserveToken;
    uint256 public reserveHoodie;
    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    bool public initialized;
    uint256 private unlocked = 1;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);
    event Sync(uint256 reserveToken, uint256 reserveHoodie);
    event Swap(address indexed sender, address indexed recipient, bool hoodieIn, uint256 amountIn, uint256 amountOut);

    modifier lock() {
        require(unlocked == 1, "REENTRANCY");
        unlocked = 0;
        _;
        unlocked = 1;
    }

    constructor(address token_, address hoodie_) {
        require(token_ != address(0) && hoodie_ != address(0) && token_ != hoodie_, "BAD_POOL_ASSETS");
        token = token_;
        hoodie = hoodie_;
        launcher = msg.sender;
    }

    function approve(address spender, uint256 value) external returns (bool) {
        allowance[msg.sender][spender] = value;
        emit Approval(msg.sender, spender, value);
        return true;
    }

    function transfer(address to, uint256 value) external returns (bool) {
        _transferShares(msg.sender, to, value);
        return true;
    }

    function transferFrom(address from, address to, uint256 value) external returns (bool) {
        uint256 permitted = allowance[from][msg.sender];
        if (permitted != type(uint256).max) {
            require(permitted >= value, "LP_ALLOWANCE");
            allowance[from][msg.sender] = permitted - value;
            emit Approval(from, msg.sender, allowance[from][msg.sender]);
        }
        _transferShares(from, to, value);
        return true;
    }

    /// @dev Called only after the launcher has deposited both assets.
    function initialize(address lpRecipient) external lock returns (uint256 shares) {
        require(msg.sender == launcher && !initialized, "INITIALIZATION_FORBIDDEN");
        require(lpRecipient != address(0), "ZERO_LP_RECIPIENT");
        uint256 tokenBalance = IERC20Pool(token).balanceOf(address(this));
        uint256 hoodieBalance = IERC20Pool(hoodie).balanceOf(address(this));
        require(tokenBalance != 0 && hoodieBalance != 0, "INITIAL_LIQUIDITY_ZERO");
        shares = _sqrt(tokenBalance * hoodieBalance);
        require(shares > MINIMUM_LIQUIDITY, "INITIAL_LIQUIDITY_TOO_LOW");
        initialized = true;
        _mint(address(0), MINIMUM_LIQUIDITY);
        _mint(lpRecipient, shares - MINIMUM_LIQUIDITY);
        _sync(tokenBalance, hoodieBalance);
    }

    function addLiquidity(uint256 tokenAmount, uint256 hoodieAmount, address recipient)
        external lock returns (uint256 shares)
    {
        require(initialized && recipient != address(0), "POOL_NOT_READY");
        require(tokenAmount != 0 && hoodieAmount != 0, "LIQUIDITY_ZERO");
        require(tokenAmount * reserveHoodie == hoodieAmount * reserveToken, "BAD_LIQUIDITY_RATIO");
        _safeTransferFrom(token, msg.sender, address(this), tokenAmount);
        _safeTransferFrom(hoodie, msg.sender, address(this), hoodieAmount);
        shares = tokenAmount * totalSupply / reserveToken;
        require(shares != 0, "SHARES_ZERO");
        _mint(recipient, shares);
        _sync(reserveToken + tokenAmount, reserveHoodie + hoodieAmount);
    }

    function removeLiquidity(uint256 shares, address recipient)
        external lock returns (uint256 tokenAmount, uint256 hoodieAmount)
    {
        require(initialized && recipient != address(0), "POOL_NOT_READY");
        uint256 supply = totalSupply;
        tokenAmount = shares * reserveToken / supply;
        hoodieAmount = shares * reserveHoodie / supply;
        require(tokenAmount != 0 && hoodieAmount != 0, "LIQUIDITY_ZERO");
        _burn(msg.sender, shares);
        _safeTransfer(token, recipient, tokenAmount);
        _safeTransfer(hoodie, recipient, hoodieAmount);
        _sync(reserveToken - tokenAmount, reserveHoodie - hoodieAmount);
    }

    function swapTokenForHoodie(uint256 amountIn, uint256 minOut, address recipient)
        external lock returns (uint256 amountOut)
    {
        require(initialized && recipient != address(0), "POOL_NOT_READY");
        _safeTransferFrom(token, msg.sender, address(this), amountIn);
        uint256 actualIn = IERC20Pool(token).balanceOf(address(this)) - reserveToken;
        amountOut = _amountOut(actualIn, reserveToken, reserveHoodie);
        require(amountOut >= minOut, "SLIPPAGE");
        _safeTransfer(hoodie, recipient, amountOut);
        _sync(reserveToken + actualIn, reserveHoodie - amountOut);
        emit Swap(msg.sender, recipient, false, actualIn, amountOut);
    }

    function swapHoodieForToken(uint256 amountIn, uint256 minOut, address recipient)
        external lock returns (uint256 amountOut)
    {
        require(initialized && recipient != address(0), "POOL_NOT_READY");
        _safeTransferFrom(hoodie, msg.sender, address(this), amountIn);
        uint256 actualIn = IERC20Pool(hoodie).balanceOf(address(this)) - reserveHoodie;
        amountOut = _amountOut(actualIn, reserveHoodie, reserveToken);
        require(amountOut >= minOut, "SLIPPAGE");
        _safeTransfer(token, recipient, amountOut);
        _sync(reserveToken - amountOut, reserveHoodie + actualIn);
        emit Swap(msg.sender, recipient, true, actualIn, amountOut);
    }

    function _amountOut(uint256 amountIn, uint256 reserveIn, uint256 reserveOut) private pure returns (uint256) {
        require(amountIn != 0 && reserveIn != 0 && reserveOut != 0, "BAD_SWAP");
        uint256 inWithFee = amountIn * FEE_NUMERATOR;
        return inWithFee * reserveOut / (reserveIn * FEE_DENOMINATOR + inWithFee);
    }

    function _sync(uint256 tokenBalance, uint256 hoodieBalance) private {
        reserveToken = tokenBalance;
        reserveHoodie = hoodieBalance;
        emit Sync(tokenBalance, hoodieBalance);
    }
    function _safeTransfer(address asset, address to, uint256 amount) private {
        require(IERC20Pool(asset).transfer(to, amount), "TOKEN_TRANSFER_FAILED");
    }
    function _safeTransferFrom(address asset, address from, address to, uint256 amount) private {
        require(IERC20Pool(asset).transferFrom(from, to, amount), "TOKEN_TRANSFER_FROM_FAILED");
    }
    function _mint(address to, uint256 amount) private { totalSupply += amount; balanceOf[to] += amount; emit Transfer(address(0), to, amount); }
    function _burn(address from, uint256 amount) private { require(balanceOf[from] >= amount, "LP_BALANCE"); unchecked { balanceOf[from] -= amount; totalSupply -= amount; } emit Transfer(from, address(0), amount); }
    function _transferShares(address from, address to, uint256 amount) private { require(to != address(0) && balanceOf[from] >= amount, "LP_TRANSFER"); unchecked { balanceOf[from] -= amount; } balanceOf[to] += amount; emit Transfer(from, to, amount); }
    function _sqrt(uint256 value) private pure returns (uint256 result) { if (value == 0) return 0; result = 1; uint256 x = value; if (x >> 128 > 0) { x >>= 128; result <<= 64; } if (x >> 64 > 0) { x >>= 64; result <<= 32; } if (x >> 32 > 0) { x >>= 32; result <<= 16; } if (x >> 16 > 0) { x >>= 16; result <<= 8; } if (x >> 8 > 0) { x >>= 8; result <<= 4; } if (x >> 4 > 0) { x >>= 4; result <<= 2; } if (x >> 2 > 0) result <<= 1; for (uint256 i; i < 7; ++i) result = (result + value / result) >> 1; uint256 candidate = value / result; return result < candidate ? result : candidate; }
}
