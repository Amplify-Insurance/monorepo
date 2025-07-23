
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "../tokens/CatShare.sol";
import "../interfaces/IYieldAdapter.sol";
import "../interfaces/IRewardDistributor.sol";
import "../interfaces/IBackstopPool.sol";

/**
 * @title BackstopPool
 * @author Gemini
 * @notice A backstop liquidity pool that generates yield on idle capital and provides a final layer of protection.
 * @dev This version has been refactored to separate calculation logic from state-changing actions.
 */
contract BackstopPool is Ownable, ReentrancyGuard, IBackstopPool {
    using SafeERC20 for IERC20;

    /* ───────────────────────── State Variables ───────────────────────── */

    IERC20 public immutable usdc;
    CatShare public immutable catShareToken;

    IYieldAdapter public adapter;
    address public riskManagerAddress;
    address public capitalPoolAddress;
    address public policyManagerAddress;
    address public underwriterManagerAddress;
    IRewardDistributor public rewardDistributor;

    bool private _initialized;

    uint256 public idleUSDC;
    mapping(address => uint256) public withdrawalRequestTimestamp;
    mapping(address => uint256) public withdrawalRequestShares;

    /* ───────────────────────── Constants ───────────────────────── */

    uint256 private constant INITIAL_SHARES_LOCKED = 1000;
    uint256 public constant CAT_POOL_REWARD_ID = type(uint256).max;
    uint256 public constant MIN_USDC_AMOUNT = 1e3; // Assumes 6 decimals
    uint256 public constant NOTICE_PERIOD = 30 days;

    /* ───────────────────────── Events ───────────────────────── */

    event Initialized();
    event AdapterChanged(address indexed newAdapter);
    event UsdcPremiumReceived(uint256 amount);
    event DepositToAdapter(uint256 amount);
    event DrawFromFund(uint256 requestedAmount, uint256 actualAmountSentToCapitalPool);
    event CatLiquidityDeposited(address indexed user, uint256 usdcAmount, uint256 catShareAmountMinted);
    event CatLiquidityWithdrawn(address indexed user, uint256 usdcAmountWithdrawn, uint256 catShareAmountBurned);
    event WithdrawalRequested(address indexed user, uint256 shareAmount, uint256 timestamp);
    event ProtocolAssetReceivedForDistribution(address indexed token, uint256 amount);
    event ProtocolAssetRewardsClaimed(address indexed user, address indexed token, uint256 amount);
    event RiskManagerAddressSet(address indexed newRiskManagerAddress);
    event CapitalPoolAddressSet(address indexed newCapitalPoolAddress);
    event UnderwriterManagerAddressSet(address indexed newUnderwriterManagerAddress);
    event PolicyManagerAddressSet(address indexed newPolicyManagerAddress);
    event RewardDistributorSet(address indexed newRewardDistributor);

    /* ───────────────────────── Constructor & Initializer ───────────────────────── */

    constructor(
        IERC20 _usdcToken,
        CatShare _catShareToken,
        IYieldAdapter _initialAdapter,
        address _initialOwner
    ) Ownable(_initialOwner) {
        require(address(_usdcToken) != address(0), "CIP: Invalid USDC token address");
        require(address(_catShareToken) != address(0), "CIP: Invalid CatShare token address");

        usdc = _usdcToken;
        catShareToken = _catShareToken;

        if (address(_initialAdapter) != address(0)) {
            adapter = _initialAdapter;
            usdc.forceApprove(address(_initialAdapter), type(uint256).max);
        }
    }

    function initialize() external onlyOwner nonReentrant {
        require(!_initialized, "CIP: Already initialized");
        require(catShareToken.owner() == address(this), "CIP: Pool must be owner of share token");

        _initialized = true;
        catShareToken.mint(address(this), INITIAL_SHARES_LOCKED);
        emit Initialized();
    }

    /* ───────────────────────── Modifiers ───────────────────────── */

    modifier onlyRiskManager() {
        require(msg.sender == riskManagerAddress, "CIP: Caller is not the RiskManager");
        _;
    }

    modifier onlyPolicyManager() {
        require(msg.sender == policyManagerAddress, "CIP: Caller is not the PolicyManager");
        _;
    }

    modifier onlyCapitalPool() {
        require(msg.sender == capitalPoolAddress, "CIP: Caller is not the CapitalPool");
        _;
    }

    modifier onlyUnderwriterManager() {
        require(msg.sender == underwriterManagerAddress, "CIP: Caller is not the UnderwriterManager");
        _;
    }

    modifier onlyApproved() {
        require(msg.sender == underwriterManagerAddress || msg.sender == riskManagerAddress || msg.sender == capitalPoolAddress, "CIP: Caller is not the approved");
        _;
    }

    /* ───────────────────── Admin Functions ───────────────────── */

    function setRiskManager(address newRiskManagerAddress) external onlyOwner {
        require(newRiskManagerAddress != address(0), "CIP: Address cannot be zero");
        riskManagerAddress = newRiskManagerAddress;
        emit RiskManagerAddressSet(newRiskManagerAddress);
    }

    function setCapitalPool(address newCapitalPoolAddress) external onlyOwner {
        require(newCapitalPoolAddress != address(0), "CIP: Address cannot be zero");
        capitalPoolAddress = newCapitalPoolAddress;
        emit CapitalPoolAddressSet(newCapitalPoolAddress);
    }

    function setUnderwriterManager(address newUnderwriterManagerAddress) external onlyOwner {
        require(newUnderwriterManagerAddress != address(0), "CIP: Address cannot be zero");
        underwriterManagerAddress = newUnderwriterManagerAddress;
        emit UnderwriterManagerAddressSet(newUnderwriterManagerAddress);
    }

    function setPolicyManager(address newPolicyManagerAddress) external onlyOwner {
        require(newPolicyManagerAddress != address(0), "CIP: Address cannot be zero");
        policyManagerAddress = newPolicyManagerAddress;
        emit PolicyManagerAddressSet(newPolicyManagerAddress);
    }

    function setRewardDistributor(address rewardDistributorAddress) external onlyOwner {
        require(rewardDistributorAddress != address(0), "CIP: Address cannot be zero");
        rewardDistributor = IRewardDistributor(rewardDistributorAddress);
        emit RewardDistributorSet(rewardDistributorAddress);
    }

    function setAdapter(address newAdapterAddress) external onlyOwner nonReentrant {
        IYieldAdapter oldAdapter = adapter;
        adapter = IYieldAdapter(newAdapterAddress);

        if (address(oldAdapter) != address(0)) {
            uint256 balanceInOldAdapter = oldAdapter.getCurrentValueHeld();
            if (balanceInOldAdapter > 0) {
                uint256 withdrawnAmount = oldAdapter.withdraw(balanceInOldAdapter, address(this));
                idleUSDC += withdrawnAmount;
            }
            usdc.forceApprove(address(oldAdapter), 0);
        }

        if (address(adapter) != address(0)) {
            usdc.forceApprove(address(adapter), type(uint256).max);
        }
        emit AdapterChanged(newAdapterAddress);
    }

    function flushToAdapter(uint256 amount) external onlyOwner nonReentrant {
        require(amount > 0, "CIP: Amount must be > 0");
        require(amount <= idleUSDC, "CIP: Amount exceeds idle USDC");
        require(address(adapter) != address(0), "CIP: Yield adapter not set");

        idleUSDC -= amount;
        adapter.deposit(amount);
        emit DepositToAdapter(amount);
    }

    /* ───────────────────── Core Liquidity Functions ───────────────────── */

    function depositLiquidity(uint256 usdcAmount) external nonReentrant {
        require(usdcAmount >= MIN_USDC_AMOUNT, "CIP: Amount below minimum");

        uint256 sharesToMint = _valueToShares(usdcAmount);
        require(sharesToMint > 0, "CIP: No shares to mint");

        usdc.safeTransferFrom(msg.sender, address(this), usdcAmount);
        idleUSDC += usdcAmount;
        catShareToken.mint(msg.sender, sharesToMint);

        emit CatLiquidityDeposited(msg.sender, usdcAmount, sharesToMint);
    }

    function requestWithdrawal(uint256 shareAmount) external nonReentrant {
        require(shareAmount > 0, "CIP: Invalid amount");
        require(catShareToken.balanceOf(msg.sender) >= shareAmount, "CIP: Insufficient CatShare balance");
        require(withdrawalRequestShares[msg.sender] == 0, "CIP: Withdrawal request pending");

        withdrawalRequestShares[msg.sender] = shareAmount;
        withdrawalRequestTimestamp[msg.sender] = block.timestamp;

        emit WithdrawalRequested(msg.sender, shareAmount, block.timestamp);
    }

    function withdrawLiquidity(uint256 catShareAmountBurn) external nonReentrant {
        require(catShareAmountBurn > 0, "CIP: Shares to burn must be positive");
        uint256 requested = withdrawalRequestShares[msg.sender];
        require(requested > 0, "CIP: No withdrawal request");
        require(catShareAmountBurn == requested, "CIP: Amount mismatch");
        require(block.timestamp >= withdrawalRequestTimestamp[msg.sender] + NOTICE_PERIOD, "CIP: Notice period active");
        require(catShareToken.balanceOf(msg.sender) >= catShareAmountBurn, "CIP: Insufficient CatShare balance");

        uint256 usdcToWithdraw = _sharesToValue(catShareAmountBurn);
        require(usdcToWithdraw >= MIN_USDC_AMOUNT, "CIP: Withdrawal amount below minimum");

        // --- Effects ---
        delete withdrawalRequestShares[msg.sender];
        delete withdrawalRequestTimestamp[msg.sender];
        catShareToken.burn(msg.sender, catShareAmountBurn);

        // --- Interactions ---
        _gatherFundsForWithdrawal(usdcToWithdraw);
        usdc.safeTransfer(msg.sender, usdcToWithdraw);

        emit CatLiquidityWithdrawn(msg.sender, usdcToWithdraw, catShareAmountBurn);
    }

    /* ─────────────────── Trusted Functions ─────────────────── */

    function receiveUsdcPremium(uint256 amount) external override onlyPolicyManager {
        require(amount > 0, "CIP: Premium amount must be positive");
        // The PolicyManager has already transferred the funds.
        // This function just needs to account for the new balance.
        idleUSDC += amount;
        emit UsdcPremiumReceived(amount);
    }

    function drawFund(uint256 amountToDraw) external override onlyApproved nonReentrant {
        require(amountToDraw > 0, "CIP: Draw amount must be positive");
        require(capitalPoolAddress != address(0), "CIP: CapitalPool address not set");
        require(amountToDraw <= liquidUsdc(), "CIP: Draw amount exceeds Cat Pool's liquid USDC");

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

        IERC20(protocolAsset).safeTransferFrom(msg.sender, address(this), amount);

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

    function claimProtocolAssetRewardsFor(address user, address protocolAsset) external override onlyApproved nonReentrant {
        require(address(rewardDistributor) != address(0), "CIP: Reward distributor not set");
        uint256 userShares = catShareToken.balanceOf(user);

        uint256 claimableAmount = rewardDistributor.claimForCatPool(user, CAT_POOL_REWARD_ID, protocolAsset, userShares);

        require(claimableAmount > 0, "CIP: No rewards to claim for this asset");
        emit ProtocolAssetRewardsClaimed(user, protocolAsset, claimableAmount);
    }

    /* ───────────────────── Internal & View Functions ───────────────────── */

    function _gatherFundsForWithdrawal(uint256 amount) internal {
        if (amount <= idleUSDC) {
            idleUSDC -= amount;
        } else {
            uint256 amountNeededFromAdapter = amount - idleUSDC;
            idleUSDC = 0;
            require(address(adapter) != address(0), "CIP: Insufficient idle USDC and no adapter");

            uint256 actuallyWithdrawn = adapter.withdraw(amountNeededFromAdapter, address(this));
            require(actuallyWithdrawn >= amountNeededFromAdapter, "CIP: Adapter withdrawal failed");
        }
    }

    function _valueToShares(uint256 usdcValue) internal view returns (uint256) {
        uint256 totalCatSharesSupply = catShareToken.totalSupply();
        uint256 effectiveSupply = totalCatSharesSupply > INITIAL_SHARES_LOCKED
            ? totalCatSharesSupply - INITIAL_SHARES_LOCKED
            : 0;

        uint256 currentTotalValueInPool = liquidUsdc();
        if (currentTotalValueInPool == 0 || effectiveSupply == 0) {
            return usdcValue;
        }

        return (usdcValue * effectiveSupply) / currentTotalValueInPool;
    }

    function _sharesToValue(uint256 shareAmount) internal view returns (uint256) {
        uint256 totalCatSharesSupply = catShareToken.totalSupply();
        uint256 effectiveSupply = totalCatSharesSupply > INITIAL_SHARES_LOCKED
            ? totalCatSharesSupply - INITIAL_SHARES_LOCKED
            : 0;
        if (effectiveSupply == 0) return 0;

        uint256 currentTotalValueInPool = liquidUsdc();
        return (shareAmount * currentTotalValueInPool) / effectiveSupply;
    }

    function liquidUsdc() public view returns (uint256) {
        uint256 adapterBalance = 0;
        if (address(adapter) != address(0)) {
            adapterBalance = adapter.getCurrentValueHeld();
        }
        return idleUSDC + adapterBalance;
    }

    function getPendingProtocolAssetRewards(address user, address protocolAsset) public view returns (uint256) {
        if (address(rewardDistributor) == address(0)) return 0;
        uint256 userShares = catShareToken.balanceOf(user);
        return rewardDistributor.pendingRewards(user, CAT_POOL_REWARD_ID, protocolAsset, userShares);
    }
}
