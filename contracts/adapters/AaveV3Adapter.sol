// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.2;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "../interfaces/IYieldAdapter.sol";
import "../interfaces/IYieldAdapterEmergency.sol";
import "../interfaces/IPoolAddressesProvider.sol";
import "../interfaces/IPool.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";


contract AaveV3Adapter is IYieldAdapter, Ownable, ReentrancyGuard {

    using SafeERC20 for IERC20;

    IERC20 public immutable underlyingToken;
    IPool public immutable aavePool;
    IERC20 public immutable aToken;
    address public capitalPoolAddress;

    event FundsWithdrawn(address indexed to, uint256 requestedAmount, uint256 actualAmount);
    event CapitalPoolAddressSet(address indexed newCapitalPool);

    constructor(IERC20 _asset, IPool _pool, IERC20 _aToken, address _initialOwner) Ownable(_initialOwner) {
        require(address(_asset) != address(0), "AaveV3Adapter: invalid asset");
        require(address(_pool) != address(0), "AaveV3Adapter: invalid pool");
        require(address(_aToken) != address(0), "AaveV3Adapter: invalid aToken");
        underlyingToken = _asset;
        aavePool = _pool;
        aToken = _aToken;
        // use SafeERC20 to handle non-standard tokens
        _asset.forceApprove(address(_pool), type(uint256).max);
    }

    // Modifier to restrict calls to the CapitalPool only
    modifier onlyCapitalPool() {
        require(msg.sender == capitalPoolAddress, "AaveV3Adapter: Caller is not CapitalPool");
        _;
    }

    function asset() external view override returns (IERC20) {
        return underlyingToken;
    }

    /**
     * @notice CORRECTED: Added the onlyCapitalPool modifier to prevent unauthorized deposits
     * and protect against NAV manipulation attacks.
     */
    function deposit(uint256 _amountToDeposit) external override onlyCapitalPool nonReentrant {
        require(_amountToDeposit > 0, "AaveV3Adapter: amount zero");
        // The CapitalPool now holds the funds and calls this function.
        // It must have approved this adapter contract to spend its funds.
        // The safeTransferFrom will pull the funds from the CapitalPool.
        underlyingToken.safeTransferFrom(msg.sender, address(this), _amountToDeposit);
        aavePool.supply(address(underlyingToken), _amountToDeposit, address(this), 0);
    }

    function withdraw(uint256 _targetAmountOfUnderlyingToWithdraw, address _to)
        external
        override
        onlyCapitalPool
        nonReentrant
        returns (uint256 actuallyWithdrawn)
    {
        require(_to != address(0), "AaveV3Adapter: zero address");
        if (_targetAmountOfUnderlyingToWithdraw == 0) {
            return 0;
        }

        actuallyWithdrawn = aavePool.withdraw(address(underlyingToken), _targetAmountOfUnderlyingToWithdraw, address(this));

        if (actuallyWithdrawn > 0) {
            underlyingToken.safeTransfer(_to, actuallyWithdrawn);
            emit FundsWithdrawn(_to, _targetAmountOfUnderlyingToWithdraw, actuallyWithdrawn);
        }
    }

    // Owner can set the CapitalPool address
    function setCapitalPoolAddress(address _capitalPoolAddress) external onlyOwner {
        require(_capitalPoolAddress != address(0), "AaveV3Adapter: Zero address");
        capitalPoolAddress = _capitalPoolAddress;
        emit CapitalPoolAddressSet(_capitalPoolAddress);
    }

    function getReserveData(address reserveAsset) external view returns (IPool.ReserveData memory) {
        return aavePool.getReserveData(reserveAsset);
    }

    function getCurrentValueHeld() external view override returns (uint256) {
        uint256 liquid = underlyingToken.balanceOf(address(this));
        uint256 aTokenBal = aToken.balanceOf(address(this));
        return liquid + aTokenBal;
    }

    function emergencyTransfer(address _to, uint256 _amount) external onlyCapitalPool nonReentrant returns (uint256) {
        uint256 bal = aToken.balanceOf(address(this));
        uint256 amt = Math.min(_amount, bal);
        if (amt > 0) {
            aToken.safeTransfer(_to, amt);
        }
        return amt;
    }

    // Get current APR for the underlying token
    function currentApr() external view returns (uint256) {
        return (aavePool.getReserveData(address(underlyingToken)).currentLiquidityRate / 1e9);
    }
}