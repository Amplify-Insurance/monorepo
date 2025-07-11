// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "../interfaces/IYieldAdapter.sol";
import "../interfaces/IYieldAdapterEmergency.sol";
import "../interfaces/IComet.sol";
import "../interfaces/ICometWithRates.sol";

contract CompoundV3Adapter is IYieldAdapter, IYieldAdapterEmergency, Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    IERC20 public immutable underlyingToken;
    IComet public immutable comet;
    uint256 private constant SECONDS_PER_YEAR = 365 days;

    address public capitalPoolAddress;

    event FundsWithdrawn(address indexed to, uint256 requestedAmount, uint256 actualAmount);
    event CapitalPoolAddressSet(address indexed newCapitalPool);

    modifier onlyCapitalPool() {
        require(msg.sender == capitalPoolAddress, "CompoundV3Adapter: Caller is not CapitalPool");
        _;
    }

    constructor(IComet _comet, address _initialOwner) Ownable(_initialOwner) {
        address asset = _comet.baseToken();
        require(asset != address(0), "CompoundV3Adapter: invalid asset");
        underlyingToken = IERC20(asset);
        comet = _comet;
        // grant allowance safely using SafeERC20
        underlyingToken.forceApprove(address(_comet), type(uint256).max);
    }

    function setCapitalPoolAddress(address _capitalPoolAddress) external onlyOwner {
        require(_capitalPoolAddress != address(0), "CompoundV3Adapter: Zero address");
        capitalPoolAddress = _capitalPoolAddress;
        emit CapitalPoolAddressSet(_capitalPoolAddress);
    }

    function asset() external view override returns (IERC20) {
        return underlyingToken;
    }

    function deposit(uint256 _amountToDeposit) external override onlyCapitalPool nonReentrant {
        require(_amountToDeposit > 0, "CompoundV3Adapter: amount zero");
        underlyingToken.safeTransferFrom(msg.sender, address(this), _amountToDeposit);
        comet.supply(address(underlyingToken), _amountToDeposit);
    }

    function withdraw(uint256 _targetAmountOfUnderlyingToWithdraw, address _to)
        external
        override
        onlyCapitalPool
        nonReentrant
        returns (uint256 actuallyWithdrawn)
    {
        require(_to != address(0), "CompoundV3Adapter: zero address");
        if (_targetAmountOfUnderlyingToWithdraw == 0) {
            return 0;
        }

        uint256 beforeBal = underlyingToken.balanceOf(address(this));
        comet.withdraw(address(underlyingToken), _targetAmountOfUnderlyingToWithdraw);
        uint256 afterBal = underlyingToken.balanceOf(address(this));
        
        actuallyWithdrawn = afterBal - beforeBal;

        if (actuallyWithdrawn > 0) {
            underlyingToken.safeTransfer(_to, actuallyWithdrawn);
            emit FundsWithdrawn(_to, _targetAmountOfUnderlyingToWithdraw, actuallyWithdrawn);
        }
    }

    /**
     * @notice CORRECTED: This function now accurately calculates the total value held by the adapter,
     * including accrued yield from Compound v3.
     */
    function getCurrentValueHeld() external view override returns (uint256) {
        uint256 liquid = underlyingToken.balanceOf(address(this));
        
        IComet.UserBasic memory basic = comet.userBasic(address(this));
        
        // In Compound v3, the principal can be negative if the account has borrowed.
        // As this adapter should only ever be a supplier, we treat negative principal as zero.
        if (basic.principal <= 0) {
            return liquid;
        }

        uint256 supplyIndex = comet.baseSupplyIndex();
        
        // The value of supplied assets is (principal * supplyIndex) / baseTrackingIndex
        // The baseTrackingIndex is stored with 1e15 precision, so we adjust the supplyIndex.
        // CORRECTED: Explicitly cast the signed int to a larger signed int first, then to uint256.
        uint256 suppliedValue = (uint256(int256(basic.principal)) * supplyIndex) / (10**15);

        return liquid + suppliedValue;
    }

    function emergencyTransfer(address _to, uint256 _amount) external onlyCapitalPool returns (uint256) {
        uint256 bal = IERC20(address(comet)).balanceOf(address(this));
        uint256 amt = _amount < bal ? _amount : bal;
        if (amt > 0) {
            IERC20(address(comet)).safeTransfer(_to, amt);
        }
        return amt;
    }

    function currentApr() external view returns (uint256 aprWad) {
        ICometWithRates c = ICometWithRates(address(comet));
        uint256 util = c.getUtilization();
        uint256 ratePerSec = c.getSupplyRate(util);
        aprWad = ratePerSec * SECONDS_PER_YEAR;
    }
}