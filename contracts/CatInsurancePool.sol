// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/math/Math.sol"; // For Math.min
import "./CatShare.sol"; // Assuming CatShare.sol is in the same directory
import "./interfaces/IYieldAdapter.sol"; // Assuming IYieldAdapter.sol is in ./interfaces/

contract CatInsurancePool is Ownable, ReentrancyGuard {

    using SafeERC20 for IERC20;

    IERC20 public immutable usdc;
    IYieldAdapter public adapter;
    address public coverPoolAddress; // Now settable by owner
    CatShare public immutable catShareToken;

    uint256 public idleUSDC;

    struct RewardData {
        uint256 totalDistributed;       // Total amount of a specific protocolAsset received by the CatPool
        uint256 rewardsPerShareStored;  // rewardsPerShareStored for a specific protocolAsset (scaled by 1e18)
    }
    mapping(IERC20 => RewardData) public protocolAssetRewards; // protocolAsset token => RewardData
    mapping(address => mapping(IERC20 => uint256)) public userProtocolAssetRewardsPaidPerShare; // user => protocolAsset token => rewardsPaidPerShare

    event AdapterChanged(address indexed newAdapter);
    event UsdcPremiumReceived(uint256 amount);
    event DepositToAdapter(uint256 amount);
    event DrawFromFund(uint256 requestedAmount, uint256 actualAmountSentToCoverPool); // Clarified event
    event CatLiquidityDeposited(address indexed user, uint256 usdcAmount, uint256 catShareAmountMinted);
    event CatLiquidityWithdrawn(address indexed user, uint256 usdcAmountWithdrawn, uint256 catShareAmountBurned);
    event ProtocolAssetReceivedForDistribution(address indexed token, uint256 amount);
    event ProtocolAssetRewardsClaimed(address indexed user, address indexed token, uint256 amount);
    event CoverPoolAddressSet(address indexed newCoverPoolAddress);


    modifier onlyCoverPoolContract() { // Renamed for clarity
        require(msg.sender == coverPoolAddress, "CIP: Caller is not the authorized CoverPool contract");
        _;
    }

    /**
     * @param _usdcToken The address of the USDC (or primary stablecoin) token.
     * @param _initialAdapter The initial yield adapter for this pool (can be address(0) if to be set later).
     * @param _initialOwner The owner of this CatInsurancePool contract (typically the deployer or governance).
     */
    constructor(IERC20 _usdcToken, IYieldAdapter _initialAdapter, address _initialOwner) Ownable(_initialOwner) {
        require(address(_usdcToken) != address(0), "CIP: Invalid USDC token address");
        usdc = _usdcToken;
        
        // CatInsurancePool deploys CatShare, and CatShare's constructor sets msg.sender (this contract) as its owner.
        catShareToken = new CatShare(); 
        
        if (address(_initialAdapter) != address(0)) {
            adapter = _initialAdapter;
            // Approve the adapter to spend this contract's USDC.
            usdc.approve(address(_initialAdapter), type(uint256).max);
        }
    }

    /**
     * @notice Sets or updates the authorized CoverPool contract address.
     * @dev Can only be called by the owner of this CatInsurancePool contract.
     * @param _newCoverPoolAddress The address of the CoverPool contract.
     */
    function setCoverPoolAddress(address _newCoverPoolAddress) external onlyOwner {
        require(_newCoverPoolAddress != address(0), "CIP: CoverPool address cannot be zero");
        require(_newCoverPoolAddress != coverPoolAddress, "CIP: New CoverPool address is same as current");
        coverPoolAddress = _newCoverPoolAddress;
        emit CoverPoolAddressSet(_newCoverPoolAddress);
    }

    /**
     * @notice Calculates the total liquid USDC value held by this pool (idle + in yield adapter).
     */
    function liquidUsdc() public view returns (uint256) {
        uint256 adapterBalance = 0;
        if (address(adapter) != address(0)) {
            try adapter.getCurrentValueHeld() returns (uint256 assets) { // Using refined interface
                adapterBalance = assets;
            } catch {
                // If adapter call fails, assume its contribution is 0 for safety.
                // An event could be emitted here for monitoring.
                adapterBalance = 0;
            }
        }
        return idleUSDC + adapterBalance;
    }

    /**
     * @notice Allows users to deposit USDC liquidity into the Cat Pool and receive CatShare tokens.
     * @param usdcAmount The amount of USDC to deposit.
     */
    function depositLiquidity(uint256 usdcAmount) external nonReentrant {
        require(usdcAmount > 0, "CIP: Deposit amount must be positive");
        
        uint256 sharesToMint;
        uint256 totalCatSharesSupply = catShareToken.totalSupply();
        uint256 currentTotalValueInPool = liquidUsdc(); // Get value *before* this deposit's USDC is added to idleUSDC

        usdc.safeTransferFrom(msg.sender, address(this), usdcAmount);
        idleUSDC += usdcAmount;

        if (totalCatSharesSupply == 0) {
            // First depositor, or pool was completely empty of value (and shares).
            // Mint shares 1:1 with amount, or a fixed initial amount to avoid issues if first deposit is tiny.
            sharesToMint = usdcAmount; // Assuming 1 share = 1 USDC initially for simplicity.
        } else {
            // NAV-based share minting: sharesToMint = (depositAmount * totalShares) / valueBeforeDeposit
            sharesToMint = (usdcAmount * totalCatSharesSupply) / currentTotalValueInPool;
        }
        require(sharesToMint > 0, "CIP: No shares to mint (amount too small or pool value issue)");
        
        // This contract (CatInsurancePool) is the owner of catShareToken and can mint.
        catShareToken.mint(msg.sender, sharesToMint);

        emit CatLiquidityDeposited(msg.sender, usdcAmount, sharesToMint);
    }

    /**
     * @notice Allows CatShare token holders to withdraw their USDC liquidity from the Cat Pool.
     * @param catShareAmountBurn The amount of CatShare tokens to burn for USDC.
     */
    function withdrawLiquidity(uint256 catShareAmountBurn) external nonReentrant {
        require(catShareAmountBurn > 0, "CIP: Shares to burn must be positive");
        uint256 userCatShareBalance = catShareToken.balanceOf(msg.sender);
        require(userCatShareBalance >= catShareAmountBurn, "CIP: Insufficient CatShare balance");
        
        uint256 totalCatSharesSupply = catShareToken.totalSupply();
        require(totalCatSharesSupply > 0, "CIP: No shares in pool to withdraw against (should not happen if user has shares)");

        uint256 currentTotalValueInPool = liquidUsdc(); // Total value *including* this user's share about to be withdrawn
        uint256 usdcToWithdraw = (catShareAmountBurn * currentTotalValueInPool) / totalCatSharesSupply;
        require(usdcToWithdraw > 0, "CIP: Calculated withdrawal amount is zero (or pool empty)");

        // Burn shares first
        catShareToken.burn(msg.sender, catShareAmountBurn);

        // Source USDC for withdrawal
        if (usdcToWithdraw <= idleUSDC) {
            idleUSDC -= usdcToWithdraw;
        } else {
            uint256 amountNeededFromAdapter = usdcToWithdraw - idleUSDC;
            idleUSDC = 0; // All idle USDC used
            
            if (address(adapter) != address(0)) {
                 uint256 actuallyWithdrawnFromAdapter = adapter.withdraw(amountNeededFromAdapter, address(this)); // Withdraw to this contract
                 // It's critical that `actuallyWithdrawnFromAdapter` is enough.
                 // If less, the user gets less, or contract takes a loss.
                 // For simplicity, require full withdrawal or near full.
                 require(actuallyWithdrawnFromAdapter >= amountNeededFromAdapter, "CIP: Adapter withdrawal failed or insufficient");
                 // If more is withdrawn (positive slippage), it benefits the pool slightly.
            } else if (amountNeededFromAdapter > 0) { 
                // This should not happen if liquidUsdc was calculated correctly and no adapter was present
                revert("CIP: Insufficient idle USDC and no adapter for withdrawal");
            }
        }
        
        usdc.safeTransfer(msg.sender, usdcToWithdraw);
        emit CatLiquidityWithdrawn(msg.sender, usdcToWithdraw, catShareAmountBurn);
    }

    /**
     * @notice Sets or changes the yield adapter for the Cat Pool.
     * @dev Withdraws all funds from the old adapter before setting the new one. Only callable by owner.
     * @param _newAdapterAddress The address of the new IYieldAdapter (address(0) to remove adapter).
     */
    function setAdapter(address _newAdapterAddress) external onlyOwner {
        // Withdraw all funds from the current adapter, if any
        if (address(adapter) != address(0)) {
            uint256 balanceInOldAdapter = 0;
            try adapter.getCurrentValueHeld() returns (uint256 assets) {
                balanceInOldAdapter = assets;
            } catch { /* Assume 0 if call fails */ }

            if (balanceInOldAdapter > 0) {
                uint256 withdrawnAmount = adapter.withdraw(balanceInOldAdapter, address(this)); // Withdraw to this contract
                idleUSDC += withdrawnAmount;
            }
        }

        adapter = IYieldAdapter(_newAdapterAddress); // Allows setting to address(0)
        
        // Approve the new adapter to spend this contract's USDC
        if (address(adapter) != address(0)) {
            usdc.approve(address(adapter), type(uint256).max);
        }
        emit AdapterChanged(_newAdapterAddress);
    }

    /**
     * @notice Moves a specified amount of idle USDC to the configured yield adapter.
     * @dev Only callable by owner for controlled capital deployment.
     * @param amount The amount of idleUSDC to deposit into the adapter.
     */
    function flushToAdapter(uint256 amount) external onlyOwner { 
        require(amount > 0, "CIP: Amount must be > 0");
        require(amount <= idleUSDC, "CIP: Amount exceeds idle USDC");
        require(address(adapter) != address(0), "CIP: Yield adapter not set");
        
        idleUSDC -= amount;
        // Assuming max approval was set during setAdapter or constructor
        adapter.deposit(amount);

        emit DepositToAdapter(amount);
    }

    /**
     * @notice Called by CoverPool to send its share of collected premiums to this Cat Pool.
     * @param amount The amount of USDC premium being sent.
     */
    function receiveUsdcPremium(uint256 amount) external onlyCoverPoolContract {
        require(amount > 0, "CIP: Premium amount must be positive");
        // CoverPool (msg.sender) must have approved this CatPool contract to pull 'amount'
        // OR CoverPool directly transfers 'amount' to this contract and this function is a no-op for transfer.
        // The current implementation expects CoverPool to have the funds and this function pulls them.
        // CoverPool.purchaseCover now does: pool.underlyingAsset.approve(address(catPool), catAmount); catPool.receiveUsdcPremium(catAmount);
        // So, msg.sender is CoverPool, but it has approved itself to transfer to CatPool. CatPool needs to pull from CoverPool.
        usdc.safeTransferFrom(coverPoolAddress, address(this), amount);
        idleUSDC += amount;
        emit UsdcPremiumReceived(amount);
    }

    /**
     * @notice Called by CoverPool to draw funds if a claim exceeds a specific risk pool's capacity.
     * @param amountToDraw The amount of USDC CoverPool requests from this Cat Pool.
     */
    function drawFund(uint256 amountToDraw) external onlyCoverPoolContract {
        require(amountToDraw > 0, "CIP: Draw amount must be positive");
        uint256 currentPoolLiquidUsdc = liquidUsdc();
        require(amountToDraw <= currentPoolLiquidUsdc, "CIP: Requested draw amount exceeds Cat Pool's liquid USDC");

        uint256 amountSent = 0;

        if (amountToDraw <= idleUSDC) {
            idleUSDC -= amountToDraw;
            usdc.safeTransfer(coverPoolAddress, amountToDraw); // Transfer directly to CoverPool
            amountSent = amountToDraw;
        } else {
            uint256 fromIdle = idleUSDC;
            uint256 remainingToDrawFromAdapter = amountToDraw - fromIdle;
            
            if (fromIdle > 0) {
                idleUSDC = 0;
                usdc.safeTransfer(coverPoolAddress, fromIdle);
                amountSent += fromIdle;
            }

            if (address(adapter) != address(0) && remainingToDrawFromAdapter > 0) {
                // Withdraw remainingToDrawFromAdapter from adapter, sending directly to CoverPool address
                uint256 actuallyWithdrawnAndSent = adapter.withdraw(remainingToDrawFromAdapter, coverPoolAddress);
                amountSent += actuallyWithdrawnAndSent;
                // If actuallyWithdrawnAndSent < remainingToDrawFromAdapter, CoverPool receives less than the full remaining.
                // This is acceptable; CoverPool gets what CatPool could provide from its adapter.
            } else if (remainingToDrawFromAdapter > 0) { 
                // Should not be reached if amountToDraw <= currentPoolLiquidUsdc check passed,
                // unless liquidUsdc calculation was inaccurate or adapter failed.
                revert("CIP: Insufficient idle USDC for remaining draw and no adapter (or adapter failed)");
            }
        }
        // Emit the amount requested by CoverPool and the amount actually sent.
        // For simplicity, CoverPool assumes it gets `amountToDraw` or the transaction reverts if CatPool can't provide.
        // The current logic ensures `amountToDraw <= currentPoolLiquidUsdc`.
        emit DrawFromFund(amountToDraw, amountSent);
    }

    /**
     * @notice Called by CoverPool to send this Cat Pool its share of distressed assets from a claim.
     * @param protocolAsset The ERC20 token of the distressed asset.
     * @param amount The amount of the distressed asset being sent.
     */
    function receiveProtocolAssetsForDistribution(IERC20 protocolAsset, uint256 amount) external onlyCoverPoolContract {
        require(address(protocolAsset) != address(0), "CIP: Protocol asset cannot be zero address");
        require(amount > 0, "CIP: Amount of protocol asset must be positive");

        // CoverPool (msg.sender) transfers the protocolAsset to this contract.
        protocolAsset.safeTransferFrom(coverPoolAddress, address(this), amount);

        RewardData storage rewardData = protocolAssetRewards[protocolAsset];
        rewardData.totalDistributed += amount;
        
        uint256 totalCatSharesSupply = catShareToken.totalSupply();
        if (totalCatSharesSupply > 0) {
            rewardData.rewardsPerShareStored += (amount * 1e18) / totalCatSharesSupply; // Scale rewards by 1e18
        }
        emit ProtocolAssetReceivedForDistribution(address(protocolAsset), amount);
    }

    /**
     * @notice Calculates the claimable amount of a specific distressed protocol asset for a user.
     * @param user The address of the CatShare holder.
     * @param protocolAsset The ERC20 token of the distressed asset.
     * @return claimableAmount The amount of the protocol asset the user can claim.
     */
    function calculateClaimableProtocolAssetRewards(address user, IERC20 protocolAsset) public view returns (uint256 claimableAmount) {
        uint256 userShares = catShareToken.balanceOf(user);
        if (userShares == 0) return 0;

        RewardData storage rewardData = protocolAssetRewards[protocolAsset];
        uint256 userPaidPerShare = userProtocolAssetRewardsPaidPerShare[user][protocolAsset];
        
        // rewardsPerShareStored is already scaled by 1e18
        if (rewardData.rewardsPerShareStored <= userPaidPerShare) {
            return 0; // No new rewards or already claimed
        }
        uint256 rewardsDuePerShare = rewardData.rewardsPerShareStored - userPaidPerShare;
        
        claimableAmount = (userShares * rewardsDuePerShare) / 1e18; // Unscale
        return claimableAmount;
    }

    /**
     * @notice Allows a CatShare holder to claim their accrued rewards for multiple distressed protocol assets.
     * @param _protocolAssetsToClaim Array of ERC20 token addresses of the distressed assets to claim.
     */
    function claimProtocolAssetRewards(IERC20[] calldata _protocolAssetsToClaim) external nonReentrant {
        for (uint i = 0; i < _protocolAssetsToClaim.length; i++) {
            IERC20 protocolAsset = _protocolAssetsToClaim[i];
            uint256 claimableAmount = calculateClaimableProtocolAssetRewards(msg.sender, protocolAsset);

            if (claimableAmount > 0) {
                // Update before transfer to prevent reentrancy
                userProtocolAssetRewardsPaidPerShare[msg.sender][protocolAsset] = protocolAssetRewards[protocolAsset].rewardsPerShareStored;
                
                // Ensure this contract holds enough of the protocolAsset (safety check)
                require(protocolAsset.balanceOf(address(this)) >= claimableAmount, "CIP: Insufficient protocol asset balance in CatPool for claims");
                protocolAsset.safeTransfer(msg.sender, claimableAmount);
                
                emit ProtocolAssetRewardsClaimed(msg.sender, address(protocolAsset), claimableAmount);
            }
        }
    }
}