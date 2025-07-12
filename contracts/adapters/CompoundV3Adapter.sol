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
        address baseToken = _comet.baseToken();
        require(baseToken != address(0), "CompoundV3Adapter: invalid asset");
        underlyingToken = IERC20(baseToken);
        comet = _comet;
        // grant allowance safely using SafeERC20
        underlyingToken.forceApprove(address(_comet), type(uint256).max);
    }

    function setCapitalPoolAddress(address capitalPoolAddr) external onlyOwner {
        require(capitalPoolAddr != address(0), "CompoundV3Adapter: Zero address");
        capitalPoolAddress = capitalPoolAddr;
        emit CapitalPoolAddressSet(capitalPoolAddr);
    }

    function asset() external view override returns (IERC20) {
        return underlyingToken;
    }

    function deposit(uint256 amountToDeposit) external override onlyCapitalPool nonReentrant {
        require(amountToDeposit > 0, "CompoundV3Adapter: amount zero");
        underlyingToken.safeTransferFrom(msg.sender, address(this), amountToDeposit);
        comet.supply(address(underlyingToken), amountToDeposit);
    }

    function withdraw(uint256 targetAmountOfUnderlyingToWithdraw, address to)
        external
        override
        onlyCapitalPool
        nonReentrant
        returns (uint256 actuallyWithdrawn)
    {
        require(to != address(0), "CompoundV3Adapter: zero address");
        if (targetAmountOfUnderlyingToWithdraw == 0) {
            return 0;
        }

        uint256 beforeBal = underlyingToken.balanceOf(address(this));
        comet.withdraw(address(underlyingToken), targetAmountOfUnderlyingToWithdraw);
        uint256 afterBal = underlyingToken.balanceOf(address(this));
        
        actuallyWithdrawn = afterBal - beforeBal;

        if (actuallyWithdrawn > 0) {
            underlyingToken.safeTransfer(to, actuallyWithdrawn);
            emit FundsWithdrawn(to, targetAmountOfUnderlyingToWithdraw, actuallyWithdrawn);
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

    function emergencyTransfer(address to, uint256 amount) external onlyCapitalPool returns (uint256) {
        uint256 bal = IERC20(address(comet)).balanceOf(address(this));
        uint256 amt = amount < bal ? amount : bal;
        if (amt > 0) {
            IERC20(address(comet)).safeTransfer(to, amt);
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