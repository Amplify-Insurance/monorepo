// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "../interfaces/IYieldAdapter.sol"; // Assuming IYieldAdapter is in interfaces/
import "../interfaces/ISdai.sol";       // Assuming ISdai is in interfaces/
import "@openzeppelin/contracts/utils/math/Math.sol";

contract SdaiAdapter is IYieldAdapter, Ownable {
    using SafeERC20 for IERC20;

    IERC20 public immutable underlyingToken; // Renamed from usdc for clarity with IYieldAdapter.asset()
    ISdai public immutable sDai;

    event FundsWithdrawn(address indexed to, uint256 requestedAmount, uint256 actualAmount);

    constructor(IERC20 _underlyingToken, ISdai _sDai, address _initialOwner) Ownable(_initialOwner) {
        require(address(_underlyingToken) != address(0), "SdaiAdapter: Invalid underlying token");
        require(address(_sDai) != address(0), "SdaiAdapter: Invalid sDAI token");
        
        underlyingToken = _underlyingToken;
        sDai = _sDai;
        // Approve the sDAI contract to spend this adapter's underlyingToken (e.g., DAI for sDAI)
        // This is for sDai.deposit(amount, receiver) if it pulls tokens.
        // If sDai.deposit takes tokens directly, this contract needs to receive them first.
        // The current deposit function has this contract receive then deposit.
        // This approval is for when *this contract* calls sDai.deposit using assets it holds.
        _underlyingToken.approve(address(_sDai), type(uint256).max);
    }

    /**
     * @inheritdoc IYieldAdapter
     */
    function asset() external view override returns (IERC20) {
        return underlyingToken;
    }

    /**
     * @inheritdoc IYieldAdapter
     * @dev msg.sender (e.g., CoverPool) transfers `_amountToDeposit` of `asset()` to this adapter.
     * This adapter then deposits those funds into the sDAI contract.
     */
    function deposit(uint256 _amountToDeposit) external override {
        // This function expects msg.sender (CoverPool) to be the owner of the funds
        // and for CoverPool to transfer funds to this SdaiAdapter contract.
        // CoverPool's depositAndAllocate:
        //   depositToken.safeTransferFrom(msg.sender_lp, address(this_coverpool), _amount);
        //   depositToken.approve(address(chosenAdapter), _amount); 
        //   chosenAdapter.deposit(_amount); 
        // So, when CoverPool calls chosenAdapter.deposit(_amount), msg.sender is CoverPool.
        // This SdaiAdapter needs to ensure it has the funds from CoverPool.
        // The most straightforward way is for CoverPool to transfer to this adapter *before* calling deposit,
        // or for this adapter to pull from CoverPool (msg.sender).
        // The current CoverPool approves this adapter, then calls deposit(_amount).
        // This adapter should then transferFrom CoverPool.

        require(_amountToDeposit > 0, "SdaiAdapter: Deposit amount must be positive");
        
        // 1. Pull underlyingToken from the depositor (CoverPool, which is msg.sender) into this adapter contract
        underlyingToken.safeTransferFrom(msg.sender, address(this), _amountToDeposit);
        
        // 2. Deposit the received underlyingToken into the sDAI contract.
        //    sDai.deposit expects assets and receiver (this adapter).
        //    It should handle the conversion to sDAI internally.
        //    The sDai.deposit() interface may vary. Assuming it returns amount of sDAI or underlying value.
        //    ISdai interface used in CoverPool's constructor suggests sDai.deposit returns uint256.
        uint256 sDaiReceivedOrValue = sDai.deposit(_amountToDeposit, address(this)); // This adapter receives the sDAI
        require(sDaiReceivedOrValue > 0, "SdaiAdapter: sDAI deposit failed or returned zero");
    }

    /**
     * @inheritdoc IYieldAdapter
     * @dev Only the owner of this SdaiAdapter contract can call this.
     * This SdaiAdapter withdraws underlyingToken from sDAI and sends it to `_to`.
     */
    function withdraw(
        uint256 _targetAmountOfUnderlyingToWithdraw,
        address _to
    ) external override onlyOwner returns (uint256 actuallyWithdrawn) {
        require(_to != address(0), "SdaiAdapter: Cannot withdraw to zero address");
        if (_targetAmountOfUnderlyingToWithdraw == 0) {
            return 0;
        }

        // currentUnderlyingBalance is the value of sDAI this adapter holds, in terms of the underlying token.
        uint256 currentUnderlyingBalanceInSdai = sDai.balanceOf(address(this)); 
        uint256 amountToAttempt = Math.min(_targetAmountOfUnderlyingToWithdraw, currentUnderlyingBalanceInSdai);

        if (amountToAttempt == 0) {
            return 0; 
        }

        // sDai.withdraw(assets, receiver, owner)
        // - 'assets' is the amount of *underlying* to withdraw.
        // - 'receiver' is who gets the underlying (this adapter contract).
        // - 'owner' is the sDAI holder (this adapter contract).
        // It returns the actual amount of underlying withdrawn.
        actuallyWithdrawn = sDai.withdraw(amountToAttempt, address(this), address(this));

        if (actuallyWithdrawn > 0) {
            // Transfer the withdrawn underlyingToken from this adapter to the requested `_to` address.
            underlyingToken.safeTransfer(_to, actuallyWithdrawn);
        }
        
        emit FundsWithdrawn(_to, _targetAmountOfUnderlyingToWithdraw, actuallyWithdrawn);
        return actuallyWithdrawn;
    }

    /**
     * @inheritdoc IYieldAdapter
     * @dev Calculates total underlying assets value held by this adapter instance.
     * This includes any underlyingToken held directly plus the value of sDAI it holds.
     * This function is called by CoverPool (msg.sender) to get value of *its* deposits via this adapter.
     * So, this should reflect the total value this SdaiAdapter instance manages.
     */
    function getCurrentValueHeld() external view override returns (uint256) {
        // msg.sender will be CoverPool. This adapter instance is dedicated to that CoverPool.
        // So, all assets held by this adapter are effectively for that CoverPool.
        uint256 liquidUnderlyingHeld = underlyingToken.balanceOf(address(this));
        uint256 underlyingInSdai = sDai.balanceOf(address(this)); // Value of sDAI in terms of underlying
        return liquidUnderlyingHeld + underlyingInSdai;
    }
}