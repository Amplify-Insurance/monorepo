// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "../tokens/CatShare.sol";
import "../interfaces/IYieldAdapter.sol";

// Interface for the central Reward Distributor
interface IRewardDistributor {
    function distribute(uint256 poolId, address rewardToken, uint256 rewardAmount, uint256 totalPledgeInPool) external;
    function claim(address user, uint256 poolId, address rewardToken, uint256 userPledge) external returns (uint256);
    function claimForCatPool(address user, uint256 poolId, address rewardToken, uint256 userPledge) external returns (uint256);
    function pendingRewards(address user, uint256 poolId, address rewardToken, uint256 userPledge) external view returns (uint256);
    function setCatPool(address _catPool) external;
}

contract CatInsurancePool is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    IERC20 public immutable usdc;
    IYieldAdapter public adapter;
    address public riskManagerAddress;
    address public capitalPoolAddress;
    address public policyManagerAddress;
    IRewardDistributor public rewardDistributor;
    CatShare public immutable catShareToken;

    uint256 public idleUSDC;
    uint256 private constant INITIAL_SHARES_LOCKED = 1000;
    uint256 public constant CAT_POOL_REWARD_ID = type(uint256).max;
    uint256 public constant MIN_USDC_AMOUNT = 1e6; // 1 USDC assuming 6 decimals

    event AdapterChanged(address indexed newAdapter);
    event UsdcPremiumReceived(uint256 amount);
    event DepositToAdapter(uint256 amount);
    event DrawFromFund(uint256 requestedAmount, uint256 actualAmountSentToCapitalPool);
    event CatLiquidityDeposited(address indexed user, uint256 usdcAmount, uint256 catShareAmountMinted);
    event CatLiquidityWithdrawn(address indexed user, uint256 usdcAmountWithdrawn, uint256 catShareAmountBurned);
    event ProtocolAssetReceivedForDistribution(address indexed token, uint256 amount);
    event ProtocolAssetRewardsClaimed(address indexed user, address indexed token, uint256 amount);
    event RiskManagerAddressSet(address indexed newRiskManagerAddress);
    event CapitalPoolAddressSet(address indexed newCapitalPoolAddress);
    event PolicyManagerAddressSet(address indexed newPolicyManagerAddress);
    event RewardDistributorSet(address indexed newRewardDistributor);


    modifier onlyRiskManager() {
        require(msg.sender == riskManagerAddress, "CIP: Caller is not the RiskManager");
        _;
    }
    
    modifier onlyPolicyManager() {
        require(msg.sender == policyManagerAddress, "CIP: Caller is not the PolicyManager");
        _;
    }

    constructor(IERC20 _usdcToken, IYieldAdapter _initialAdapter, address _initialOwner) Ownable(_initialOwner) {
        require(address(_usdcToken) != address(0), "CIP: Invalid USDC token address");
        usdc = _usdcToken;
        
        catShareToken = new CatShare(); 
        
        catShareToken.mint(address(0), INITIAL_SHARES_LOCKED);
        
        if (address(_initialAdapter) != address(0)) {
            adapter = _initialAdapter;
            // Grant approval to the initial adapter in a controlled manner
            usdc.safeApprove(address(_initialAdapter), 0);
            usdc.safeApprove(address(_initialAdapter), type(uint256).max);
        }
    }

    /* ───────────────────── Admin Functions ───────────────────── */

    function setRiskManagerAddress(address _newRiskManagerAddress) external onlyOwner {
        require(_newRiskManagerAddress != address(0), "CIP: Address cannot be zero");
        riskManagerAddress = _newRiskManagerAddress;
        emit RiskManagerAddressSet(_newRiskManagerAddress);
    }
    
    function setCapitalPoolAddress(address _newCapitalPoolAddress) external onlyOwner {
        require(_newCapitalPoolAddress != address(0), "CIP: Address cannot be zero");
        capitalPoolAddress = _newCapitalPoolAddress;
        emit CapitalPoolAddressSet(_newCapitalPoolAddress);
    }

    function setPolicyManagerAddress(address _newPolicyManagerAddress) external onlyOwner {
        require(_newPolicyManagerAddress != address(0), "CIP: Address cannot be zero");
        policyManagerAddress = _newPolicyManagerAddress;
        emit PolicyManagerAddressSet(_newPolicyManagerAddress);
    }
    
    function setRewardDistributor(address _rewardDistributor) external onlyOwner {
        require(_rewardDistributor != address(0), "CIP: Address cannot be zero");
        rewardDistributor = IRewardDistributor(_rewardDistributor);
        rewardDistributor.setCatPool(address(this));
        emit RewardDistributorSet(_rewardDistributor);
    }

    function setAdapter(address _newAdapterAddress) external onlyOwner {
        if (address(adapter) != address(0)) {
            uint256 balanceInOldAdapter = adapter.getCurrentValueHeld();
            if (balanceInOldAdapter > 0) {
                uint256 withdrawnAmount = adapter.withdraw(balanceInOldAdapter, address(this));
                idleUSDC += withdrawnAmount;
            }
            // Revoke allowance from the old adapter
            usdc.safeApprove(address(adapter), 0);
        }
        adapter = IYieldAdapter(_newAdapterAddress);
        if (address(adapter) != address(0)) {
            // Grant allowance to the new adapter safely
            usdc.safeApprove(address(adapter), 0);
            usdc.safeApprove(address(adapter), type(uint256).max);
        }
        emit AdapterChanged(_newAdapterAddress);
    }

    function flushToAdapter(uint256 amount) external onlyOwner { 
        require(amount > 0, "CIP: Amount must be > 0");
        require(amount <= idleUSDC, "CIP: Amount exceeds idle USDC");
        require(address(adapter) != address(0), "CIP: Yield adapter not set");
        idleUSDC -= amount;
        adapter.deposit(amount);
        emit DepositToAdapter(amount);
    }

    /* ───────────────────── Core Functions ───────────────────── */

    function liquidUsdc() public view returns (uint256) {
        uint256 adapterBalance = 0;
        if (address(adapter) != address(0)) {
            adapterBalance = adapter.getCurrentValueHeld();
        }
        return idleUSDC + adapterBalance;
    }

    function depositLiquidity(uint256 usdcAmount) external nonReentrant {
        require(usdcAmount >= MIN_USDC_AMOUNT, "CIP: Amount below minimum");
        
        uint256 sharesToMint;
        uint256 totalCatSharesSupply = catShareToken.totalSupply();
        uint256 currentTotalValueInPool = liquidUsdc();

        usdc.safeTransferFrom(msg.sender, address(this), usdcAmount);
        idleUSDC += usdcAmount;

        // CORRECTED: Handles the first deposit case by checking if total value is zero.
        if (currentTotalValueInPool == 0) {
            sharesToMint = usdcAmount;
        } else {
            sharesToMint = (usdcAmount * totalCatSharesSupply) / currentTotalValueInPool;
        }
        require(sharesToMint > 0, "CIP: No shares to mint");
        
        catShareToken.mint(msg.sender, sharesToMint);
        emit CatLiquidityDeposited(msg.sender, usdcAmount, sharesToMint);
    }

    function withdrawLiquidity(uint256 catShareAmountBurn) external nonReentrant {
        require(catShareAmountBurn > 0, "CIP: Shares to burn must be positive");
        uint256 userCatShareBalance = catShareToken.balanceOf(msg.sender);
        require(userCatShareBalance >= catShareAmountBurn, "CIP: Insufficient CatShare balance");
        
        uint256 totalCatSharesSupply = catShareToken.totalSupply();
        uint256 currentTotalValueInPool = liquidUsdc();
        uint256 usdcToWithdraw = (catShareAmountBurn * currentTotalValueInPool) / totalCatSharesSupply;
        require(usdcToWithdraw >= MIN_USDC_AMOUNT, "CIP: Withdrawal amount below minimum");

        catShareToken.burn(msg.sender, catShareAmountBurn);

        if (usdcToWithdraw <= idleUSDC) {
            idleUSDC -= usdcToWithdraw;
        } else {
            uint256 amountNeededFromAdapter = usdcToWithdraw - idleUSDC;
            idleUSDC = 0;
            if (address(adapter) != address(0)) {
                 uint256 actuallyWithdrawn = adapter.withdraw(amountNeededFromAdapter, address(this));
                 require(actuallyWithdrawn >= amountNeededFromAdapter, "CIP: Adapter withdrawal failed");
            } else {
                revert("CIP: Insufficient idle USDC and no adapter");
            }
        }
        
        usdc.safeTransfer(msg.sender, usdcToWithdraw);
        emit CatLiquidityWithdrawn(msg.sender, usdcToWithdraw, catShareAmountBurn);
    }

    /* ─────────────────── Trusted Functions ─────────────────── */

    function receiveUsdcPremium(uint256 amount) external onlyPolicyManager {
        require(amount > 0, "CIP: Premium amount must be positive");
        usdc.safeTransferFrom(policyManagerAddress, address(this), amount);
        idleUSDC += amount;
        emit UsdcPremiumReceived(amount);
    }

    /**
     * @notice CORRECTED: Added nonReentrant modifier to prevent reentrancy attacks.
     */
    function drawFund(uint256 amountToDraw) external onlyRiskManager nonReentrant {
        require(amountToDraw > 0, "CIP: Draw amount must be positive");
        require(capitalPoolAddress != address(0), "CIP: CapitalPool address not set");
        uint256 currentPoolLiquidUsdc = liquidUsdc();
        require(amountToDraw <= currentPoolLiquidUsdc, "CIP: Draw amount exceeds Cat Pool's liquid USDC");

        uint256 amountSent = 0;
        if (amountToDraw <= idleUSDC) {
            idleUSDC -= amountToDraw;
            usdc.safeTransfer(capitalPoolAddress, amountToDraw);
            amountSent = amountToDraw;
        } else {
            uint256 fromIdle = idleUSDC;
            uint256 remainingToDrawFromAdapter = amountToDraw - fromIdle;
            if (fromIdle > 0) {
                idleUSDC = 0;
                usdc.safeTransfer(capitalPoolAddress, fromIdle);
                amountSent += fromIdle;
            }
            if (address(adapter) != address(0) && remainingToDrawFromAdapter > 0) {
                uint256 actuallyWithdrawn = adapter.withdraw(remainingToDrawFromAdapter, capitalPoolAddress);
                amountSent += actuallyWithdrawn;
            }
        }
        if (amountSent > 0) {
            emit DrawFromFund(amountToDraw, amountSent);
        }
    }

    function receiveProtocolAssetsForDistribution(address protocolAsset, uint256 amount) external onlyRiskManager nonReentrant {
        require(address(rewardDistributor) != address(0), "CIP: Reward distributor not set");
        require(protocolAsset != address(0), "CIP: Protocol asset cannot be zero address");
        require(amount > 0, "CIP: Amount of protocol asset must be positive");

        IERC20(protocolAsset).safeTransferFrom(riskManagerAddress, address(this), amount);

        uint256 totalCatSharesSupply = catShareToken.totalSupply();
        rewardDistributor.distribute(CAT_POOL_REWARD_ID, protocolAsset, amount, totalCatSharesSupply);
        
        emit ProtocolAssetReceivedForDistribution(protocolAsset, amount);
    }

    /* ───────────────────── Rewards Claiming ───────────────────── */

    function claimProtocolAssetRewards(address protocolAsset) external nonReentrant {
        require(address(rewardDistributor) != address(0), "CIP: Reward distributor not set");
        uint256 userShares = catShareToken.balanceOf(msg.sender);
        
        uint256 claimableAmount = rewardDistributor.claimForCatPool(msg.sender, CAT_POOL_REWARD_ID, protocolAsset, userShares);
        
        require(claimableAmount > 0, "CIP: No rewards to claim for this asset");
        emit ProtocolAssetRewardsClaimed(msg.sender, protocolAsset, claimableAmount);
    }

    /* ───────────────────── View Functions ───────────────────── */

    function getPendingProtocolAssetRewards(address user, address protocolAsset) public view returns (uint256) {
        if(address(rewardDistributor) == address(0)) return 0;
        uint256 userShares = catShareToken.balanceOf(user);
        return rewardDistributor.pendingRewards(user, CAT_POOL_REWARD_ID, protocolAsset, userShares);
    }
}