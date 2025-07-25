// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title MockBackstopPool
 * @notice A mock implementation of the BackstopPool for testing external contracts like RiskManager.
 * @dev This contract simulates the interface that the RiskManager/CoverPool calls. It records
 * interactions and allows tests to force reverts to check error handling.
 */
contract MockBackstopPool is Ownable {

    // --- State for Mocking ---

    address public coverPoolAddress;
    bool public shouldRevertOnDrawFund;

    // Variables to store the last arguments received for easy testing
    uint256 public last_premiumReceived;
    uint256 public last_drawFund_amount;
    address public last_distressedAssetReceived_token;
    uint256 public last_distressedAssetReceived_amount;

    uint256 public claimProtocolAssetRewardsForCallCount;
    address public last_user;
    address public last_protocolToken;
    
    // Call counters for verification
    uint256 public receiveUsdcPremiumCallCount;
    uint256 public drawFundCallCount;
    uint256 public receiveProtocolAssetsCallCount;

    // Add these to your MockPoolRegistry.sol file
uint256 public last_updateCapitalAllocation_amount;
uint256 public last_updateCapitalAllocation_poolId;
address public last_updateCapitalAllocation_adapter;
bool    public last_updateCapitalAllocation_isAllocation;

    address public last_claimProtocolToken;
    uint256 public claimProtocolRewardsCallCount;
    address public last_claimUser;

    // --- Events for Testing ---

    event CoverPoolAddressSet(address indexed newCoverPoolAddress);
    event PremiumReceivedCalled(uint256 amount);
    event DrawFundCalled(uint256 amount);
    event DistressedAssetReceivedCalled(address indexed token, uint256 amount);
    event RevertOnDrawSet(bool shouldRevert);

    constructor(address _initialOwner) Ownable(_initialOwner) {}

    // --- Mock Control Functions (Owner-only) ---

    /**
     * @notice Test-only function to make the next `drawFund` call revert.
     */
    function setShouldRevertOnDrawFund(bool _shouldRevert) external onlyOwner {
        shouldRevertOnDrawFund = _shouldRevert;
        emit RevertOnDrawSet(_shouldRevert);
    }

    // --- Mocked Functions (Implementing the BackstopPool's external interface) ---

    /**
     * @notice Mocks the owner-only function to set the CoverPool address.
     * @dev Made publicly callable in the mock for easier test setup.
     */
    function setCoverPoolAddress(address _newCoverPoolAddress) external {
        coverPoolAddress = _newCoverPoolAddress;
        emit CoverPoolAddressSet(_newCoverPoolAddress);
    }

    /**
     * @notice Mocks receiving premiums from the RiskManager/CoverPool.
     */
    function receiveUsdcPremium(uint256 amount) external {
        // The mock doesn't need to handle the actual token transfer,
        // as the test will orchestrate that. It just records the call.
        last_premiumReceived = amount;
        receiveUsdcPremiumCallCount++;
        emit PremiumReceivedCalled(amount);
    }

    /**
     * @notice Mocks drawing funds for a claim. Can be set to revert for testing.
     */
    function drawFund(uint256 amountToDraw) external {
        if (shouldRevertOnDrawFund) {
            revert("MockCIP: Deliberate revert from drawFund");
        }
        last_drawFund_amount = amountToDraw;
        drawFundCallCount++;
        emit DrawFundCalled(amountToDraw);
    }

    /**
     * @notice Mocks receiving distressed assets from a claim.
     */
    function receiveProtocolAssetsForDistribution(IERC20 protocolAsset, uint256 amount) external {
        // The mock just records that this function was called with the correct arguments.
        last_distressedAssetReceived_token = address(protocolAsset);
        last_distressedAssetReceived_amount = amount;
        receiveProtocolAssetsCallCount++;
        emit DistressedAssetReceivedCalled(address(protocolAsset), amount);
    }

    function claimProtocolAssetRewards(address protocolToken) external {
        last_claimProtocolToken = protocolToken;
        last_claimUser = msg.sender;
        claimProtocolRewardsCallCount++;
    }


    // Add this function inside your MockBackstopPool contract
function claimProtocolAssetRewardsFor(address user, address protocolToken) external {
    claimProtocolAssetRewardsForCallCount++;
    last_user = user;
    last_protocolToken = protocolToken;
}

// Add this function to your MockPoolRegistry.sol file
function updateCapitalAllocation(
    uint256 poolId,
    address adapter,
    uint256 amount,
    bool isAllocation
) external {
    last_updateCapitalAllocation_poolId = poolId;
    last_updateCapitalAllocation_adapter = adapter;
    last_updateCapitalAllocation_amount = amount;
    last_updateCapitalAllocation_isAllocation = isAllocation;
}
}