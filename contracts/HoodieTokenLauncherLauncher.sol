// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {HoodiePool, IERC20Pool} from "./HoodiePool.sol";

/// @notice Minimal ERC-20 deliberately without any privileged mint method.
contract LaunchToken {
    string public name;
    string public symbol;
    uint8 public constant decimals = 18;
    uint256 public immutable totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    constructor(string memory name_, string memory symbol_, uint256 supply_, address recipient_) {
        require(bytes(name_).length != 0 && bytes(symbol_).length != 0, "TOKEN_METADATA_EMPTY");
        require(supply_ != 0 && recipient_ != address(0), "TOKEN_PARAMETERS_INVALID");
        name = name_;
        symbol = symbol_;
        totalSupply = supply_;
        balanceOf[recipient_] = supply_;
        emit Transfer(address(0), recipient_, supply_);
    }

    function approve(address spender, uint256 value) external returns (bool) {
        allowance[msg.sender][spender] = value;
        emit Approval(msg.sender, spender, value);
        return true;
    }

    function transfer(address to, uint256 value) external returns (bool) {
        _transfer(msg.sender, to, value);
        return true;
    }

    function transferFrom(address from, address to, uint256 value) external returns (bool) {
        uint256 permitted = allowance[from][msg.sender];
        if (permitted != type(uint256).max) {
            require(permitted >= value, "ERC20_INSUFFICIENT_ALLOWANCE");
            allowance[from][msg.sender] = permitted - value;
            emit Approval(from, msg.sender, allowance[from][msg.sender]);
        }
        _transfer(from, to, value);
        return true;
    }

    function _transfer(address from, address to, uint256 value) private {
        require(to != address(0), "ERC20_TRANSFER_TO_ZERO");
        uint256 available = balanceOf[from];
        require(available >= value, "ERC20_INSUFFICIENT_BALANCE");
        unchecked { balanceOf[from] = available - value; }
        balanceOf[to] += value;
        emit Transfer(from, to, value);
    }
}

/// @notice A token launcher whose quote asset is immutable.
/// @dev Every successful launch atomically creates and funds a HOODIE pool before emitting TokenLaunched.
contract HoodieTokenLauncher {
    struct LaunchRecord {
        address token;
        address pool;
        address recipient;
        uint256 supply;
    }

    address public immutable hoodie;
    address public immutable creator;
    uint256 public launchCount;
    LaunchRecord[] private _launches;

    event TokenLaunched(
        address indexed token,
        address indexed pair,
        address indexed tokenOwner,
        string name,
        string symbol,
        uint256 supply
    );

    constructor(address hoodie_, address creator_) {
        require(hoodie_ != address(0), "ZERO_CORE_ADDRESS");
        hoodie = hoodie_;
        creator = creator_;
    }

    /// @notice Launch an immutable-supply token and its first funded pool, forcibly paired with HOODIE.
    /// @dev State is committed before the final token transfer to recipient (CEI). The pool and
    ///      LaunchToken are freshly-deployed contracts that cannot call back into this launcher,
    ///      but the pattern is maintained for correctness.
    function launchToken(
        string calldata name,
        string calldata symbol,
        uint256 supply,
        uint256 initialTokenLiquidity,
        uint256 initialHoodieLiquidity,
        address recipient
    ) external returns (address token, address pair) {
        require(initialTokenLiquidity < supply && initialHoodieLiquidity != 0 && recipient != address(0), "BAD_INITIAL_LIQUIDITY");
        token = address(new LaunchToken(name, symbol, supply, address(this)));
        pair = address(new HoodiePool(token, hoodie));
        require(IERC20Pool(token).transfer(pair, initialTokenLiquidity), "TOKEN_DEPOSIT_FAILED");
        require(IERC20Pool(hoodie).transferFrom(msg.sender, pair, initialHoodieLiquidity), "HOODIE_DEPOSIT_FAILED");
        HoodiePool(pair).initialize(recipient);
        // Effects before the final interaction (CEI).
        _launches.push(LaunchRecord({token: token, pool: pair, recipient: recipient, supply: supply}));
        unchecked { ++launchCount; }
        emit TokenLaunched(token, pair, recipient, name, symbol, supply);
        // Interaction: send founder allocation after state is committed.
        require(IERC20Pool(token).transfer(recipient, supply - initialTokenLiquidity), "FOUNDER_ALLOCATION_FAILED");
    }

    function launchAt(uint256 index) external view returns (LaunchRecord memory) {
        return _launches[index];
    }
}

/// @title Hoodie Token Launcher Launcher
/// @notice Factory that can only create launchers permanently bound to the supplied HOODIE token.
contract HoodieTokenLauncherLauncher {
    /// @dev The bounty's specified HOODIE contract address on Robinhood Chain.
    address public constant HOODIE = 0xC72c01AAB5f5678dc1d6f5C6d2B417d91D402Ba3;
    address[] public launchers;
    mapping(address => address[]) public launchersByCreator;

    event LauncherCreated(address indexed launcher, address indexed creator, uint256 indexed launcherId);

    function createLauncher() external returns (address launcher) {
        launcher = address(new HoodieTokenLauncher(HOODIE, msg.sender));
        launchers.push(launcher);
        launchersByCreator[msg.sender].push(launcher);
        emit LauncherCreated(launcher, msg.sender, launchers.length - 1);
    }

    function launcherCount() external view returns (uint256) {
        return launchers.length;
    }

    function launchersFor(address account) external view returns (address[] memory) {
        return launchersByCreator[account];
    }
}
