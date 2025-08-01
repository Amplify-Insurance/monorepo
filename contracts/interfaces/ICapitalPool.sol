// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

// NEW: The YieldPlatform enum is now defined in the public interface
// so it can be used by any contract that imports it.

interface ICapitalPool {
    struct PayoutData {
        uint256 poolId; // <<< FIX: Added poolId to the payout data struct.
        address claimant;
        uint256 claimantAmount;
        address feeRecipient;
        uint256 feeAmount;
        address[] adapters;
        uint256[] capitalPerAdapter;
        uint256 totalCapitalFromPoolLPs;
    }

    
    enum YieldPlatform { NONE, AAVE, COMPOUND, OTHER_YIELD }

    function setBaseYieldAdapter(YieldPlatform _platform, address _adapterAddress) external;
    function setRiskManager(address _riskManager) external;
    function setUnderwriterManager(address _underwriterManager) external;
    function setUnderwriterNoticePeriod(uint256 _newPeriod) external;
    function setLossDistributor(address _lossDistributor) external;
    function setRewardDistributor(address _rewardDistributor) external;

    function yieldAdapterRewardPoolId(address) external view returns (uint256);
    function deposit(uint256 amount, YieldPlatform yieldChoice) external;
    function getUnderwriterAdapterAddress(address underwriter) external view returns(address);
    // function applyLosses(address underwriter, uint256 amount) external;
    function underlyingAsset() external view returns (IERC20);
    function getUnderwriterAccount(address underwriter) external view returns (uint256, YieldPlatform, uint256, uint256);
    function sharesToValue(uint256 shares) external view returns (uint256);
    function valueToShares(uint256 value) external view returns (uint256);
    function executePayout(PayoutData calldata payoutData) external;
    function requestWithdrawal(address user, uint256 sharesToBurn) external;
    function cancelWithdrawalRequest(address user, uint256 requestIndex) external;
    function executeWithdrawal(address user, uint256 requestIndex) external;
    function burnSharesForLoss(address underwriter, uint256 burnAmount) external;
    function depositFor(address user, uint256 amount, YieldPlatform yieldChoice) external;
}

