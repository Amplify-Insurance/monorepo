// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "../interfaces/IYieldAdapter.sol";

// Interfaces for Compound V3
interface IComet {
    function supply(address asset, uint256 amount) external;
    function withdraw(address asset, uint256 amount) external;
    function baseToken() external view returns (address);
    function balanceOf(address account) external view returns (uint256);
}
interface ICometWithRates is IComet {
    function getUtilization() external view returns (uint256);
    function getSupplyRate(uint256 utilization) external view returns (uint256);
}

contract CompoundV3Adapter is IYieldAdapter, Ownable {
    using SafeERC20 for IERC20;

    IERC20 public immutable underlyingToken;
    IComet public immutable comet;
    uint256 private constant SECONDS_PER_YEAR = 365 days;

    // --- ADDED: State variable for the CapitalPool address ---
    address public capitalPoolAddress;

    // --- Events ---
    event FundsWithdrawn(address indexed to, uint256 requestedAmount, uint256 actualAmount);
    event CapitalPoolAddressSet(address indexed newCapitalPool);

    // --- ADDED: Modifier to restrict calls to the CapitalPool only ---
    modifier onlyCapitalPool() {
        require(msg.sender == capitalPoolAddress, "CompoundV3Adapter: Caller is not CapitalPool");
        _;
    }

    constructor(IComet _comet, address _initialOwner) Ownable(_initialOwner) {
        address asset = _comet.baseToken();
        require(asset != address(0), "CompoundV3Adapter: invalid asset");
        underlyingToken = IERC20(asset);
        comet = _comet;
        // The approval to the Comet contract is still necessary
        underlyingToken.approve(address(_comet), type(uint256).max);
    }

    // --- ADDED: Function for the deployer to set the CapitalPool address ---
    function setCapitalPoolAddress(address _capitalPoolAddress) external onlyOwner {
        require(_capitalPoolAddress != address(0), "CompoundV3Adapter: Zero address");
        capitalPoolAddress = _capitalPoolAddress;
        emit CapitalPoolAddressSet(_capitalPoolAddress);
    }

    function asset() external view override returns (IERC20) {
        return underlyingToken;
    }

    // --- UPDATED: Restricted deposit function to CapitalPool only ---
    function deposit(uint256 _amountToDeposit) external override onlyCapitalPool {
        require(_amountToDeposit > 0, "CompoundV3Adapter: amount zero");
        // This logic is correct: CapitalPool calls this, so msg.sender is CapitalPool.
        // It transfers funds from CapitalPool to this adapter.
        underlyingToken.safeTransferFrom(msg.sender, address(this), _amountToDeposit);
        comet.supply(address(underlyingToken), _amountToDeposit);
    }

    // --- UPDATED: Replaced onlyOwner with onlyCapitalPool ---
    function withdraw(uint256 _targetAmountOfUnderlyingToWithdraw, address _to)
        external
        override
        onlyCapitalPool
        returns (uint256 actuallyWithdrawn)
    {
        require(_to != address(0), "CompoundV3Adapter: zero address");
        if (_targetAmountOfUnderlyingToWithdraw == 0) {
            return 0;
        }

        uint256 beforeBal = underlyingToken.balanceOf(address(this));
        comet.withdraw(address(underlyingToken), _targetAmountOfUnderlyingToWithdraw);
        uint256 afterBal = underlyingToken.balanceOf(address(this));
        
        // This check is crucial as Compound's withdraw doesn't return a value.
        actuallyWithdrawn = afterBal - beforeBal;

        if (actuallyWithdrawn > 0) {
            underlyingToken.safeTransfer(_to, actuallyWithdrawn);
        }
        
        emit FundsWithdrawn(_to, _targetAmountOfUnderlyingToWithdraw, actuallyWithdrawn);
    }

    function getCurrentValueHeld() external view override returns (uint256) {
        uint256 liquid = underlyingToken.balanceOf(address(this));
        // For Compound V3, comet.balanceOf() returns the principal amount supplied in terms of the underlying asset.
        uint256 supplied = comet.balanceOf(address(this));
        // This correctly represents the total value held by the adapter.
        return liquid + supplied;
    }

    /**
     * @return aprWad  Current supplier APR, 1 = 1×10-18 (i.e. 1e-18-scaled)
     */
    function currentApr() external view returns (uint256 aprWad) {
        ICometWithRates c = ICometWithRates(address(comet));
        uint256 util = c.getUtilization();
        uint256 ratePerSec = c.getSupplyRate(util);
        aprWad = ratePerSec * SECONDS_PER_YEAR;
    }
}