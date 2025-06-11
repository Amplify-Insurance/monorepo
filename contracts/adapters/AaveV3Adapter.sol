// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "../interfaces/IYieldAdapter.sol";

interface IAaveV3Pool {
    // This struct is part of the ReserveData struct
    struct ReserveConfigurationMap {
        // bit 0-15: LTV
        // bit 16-31: Liq. threshold
        // bit 32-47: Liq. bonus
        // bit 48-55: Decimals
        // bit 56: Reserve is active
        // bit 57: Reserve is frozen
        // bit 58: Borrowing is enabled
        // bit 59: Stable rate borrowing is enabled
        // bit 60: Reserve is paused
        // bit 61-63: Siloed borrowing is enabled
        uint256 data;
    }

    // --- The Complete ReserveData Struct ---
    struct ReserveData {
        ReserveConfigurationMap configuration;
        uint128 liquidityIndex;
        uint128 variableBorrowIndex;
        uint128 currentLiquidityRate;
        uint128 currentVariableBorrowRate;
        uint128 currentStableBorrowRate;
        uint40 lastUpdateTimestamp;
        address aTokenAddress;
        address stableDebtTokenAddress;
        address variableDebtTokenAddress;
        address interestRateStrategyAddress;
        uint128 unbacked;
    }

    function supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode) external;
    function withdraw(address asset, uint256 amount, address to) external returns (uint256);
    
    // Note that the function actually returns the full struct, not just a part of it.
    function getReserveData(address asset) external view returns (ReserveData memory);
}

contract AaveV3Adapter is IYieldAdapter, Ownable {
    using SafeERC20 for IERC20;

    IERC20 public immutable underlyingToken;
    IAaveV3Pool public immutable aavePool;
    IERC20 public immutable aToken;
    address public capitalPoolAddress;

    event FundsWithdrawn(address indexed to, uint256 requestedAmount, uint256 actualAmount);
    event CapitalPoolAddressSet(address indexed newCapitalPool);

    constructor(IERC20 _asset, IAaveV3Pool _pool, IERC20 _aToken, address _initialOwner) Ownable(_initialOwner) {
        require(address(_asset) != address(0), "AaveV3Adapter: invalid asset");
        require(address(_pool) != address(0), "AaveV3Adapter: invalid pool");
        require(address(_aToken) != address(0), "AaveV3Adapter: invalid aToken");
        underlyingToken = _asset;
        aavePool = _pool;
        aToken = _aToken;
        _asset.approve(address(_pool), type(uint256).max);
    }


    // --- ADDED: Modifier to restrict calls to the CapitalPool only ---
    modifier onlyCapitalPool() {
        require(msg.sender == capitalPoolAddress, "AaveV3Adapter: Caller is not CapitalPool");
        _;
    }

    function asset() external view override returns (IERC20) {
        return underlyingToken;
    }

    function deposit(uint256 _amountToDeposit) external override {
        require(_amountToDeposit > 0, "AaveV3Adapter: amount zero");
        underlyingToken.safeTransferFrom(msg.sender, address(this), _amountToDeposit);
        aavePool.supply(address(underlyingToken), _amountToDeposit, address(this), 0);
    }


        // --- UPDATED: Swapped onlyOwner for onlyCapitalPool ---
    function withdraw(uint256 _targetAmountOfUnderlyingToWithdraw, address _to)
        external
        override
        onlyCapitalPool
        returns (uint256 actuallyWithdrawn)
    {
        require(_to != address(0), "AaveV3Adapter: zero address");
        if (_targetAmountOfUnderlyingToWithdraw == 0) {
            return 0;
        }

        actuallyWithdrawn = aavePool.withdraw(address(underlyingToken), _targetAmountOfUnderlyingToWithdraw, address(this));

        if (actuallyWithdrawn > 0) {
            underlyingToken.safeTransfer(_to, actuallyWithdrawn);
        }
        
        emit FundsWithdrawn(_to, _targetAmountOfUnderlyingToWithdraw, actuallyWithdrawn);
    }


        // --- ADDED: Owner can set the CapitalPool address ---
    function setCapitalPoolAddress(address _capitalPoolAddress) external onlyOwner {
        require(_capitalPoolAddress != address(0), "AaveV3Adapter: Zero address");
        capitalPoolAddress = _capitalPoolAddress;
        emit CapitalPoolAddressSet(_capitalPoolAddress);
    }


    function getCurrentValueHeld() external view override returns (uint256) {
        uint256 liquid = underlyingToken.balanceOf(address(this));
        uint256 aTokenBal = aToken.balanceOf(address(this));
        return liquid + aTokenBal;
    }

    function currentApr() external view returns (uint256) {
        // The correct field name is currentLiquidityRate
        return aavePool.getReserveData(address(underlyingToken)).currentLiquidityRate;
    }
}
