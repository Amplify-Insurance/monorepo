// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "../interfaces/IYieldAdapter.sol";

/**
 * @title MorphoAdapter
 * @notice IYieldAdapter implementation for the Morpho protocol layered on Compound‑v3 (Comet) or Compound‑v2 markets.
 * @dev    The adapter is intentionally thin: it forwards deposits/withdrawals into Morpho and always approves the
 *         Morpho contract for unlimited spending of the underlying token to avoid repeated approvals.
 *
 *         Constructor expects:
 *           _morphoCore  – Core Morpho contract handling supply/withdraw (e.g. MorphoBlue or MorphoCompound)
 *           _poolToken   – Underlying market identifier (a Comet Address for v3, or cToken for v2)
 *           _initialOwner – Owner address allowed to call withdraw()
 *
 *         The adapter derives `underlyingToken` automatically from the pool token’s `baseToken()` method if available
 *         (Comet style). If the pool token lacks `baseToken()`, pass the underlying ERC‑20 directly.
 */

/// @dev Partial interface for a Compound‑v3 Comet (needed only for `baseToken()`)
interface ICometLike {
    function baseToken() external view returns (address);
}

/// @dev Minimal Morpho core interface (Compound‑v3 style)
interface IMorphoCore {
    function supply(address poolToken, address onBehalf, uint256 amount) external returns (uint256); // returns shares
    function withdraw(address poolToken, uint256 amount) external returns (uint256); // returns withdrawn assets
    function supplyBalanceInOf(address poolToken, address user) external view returns (uint256);
}

contract MorphoAdapter is IYieldAdapter, Ownable {
    using SafeERC20 for IERC20;

    IERC20  public immutable underlyingToken;
    IMorphoCore public immutable morpho;
    address public immutable poolToken; // cToken or Comet market

    event FundsWithdrawn(address indexed to, uint256 requestedAmount, uint256 actualAmount);

    /**
     * @param _morphoCore   Morpho core contract address
     * @param _poolToken    Address of the market (Comet or cToken) to supply into via Morpho
     * @param _initialOwner Contract owner (allowed to call withdraw)
     */
    constructor(IMorphoCore _morphoCore, address _poolToken, address _initialOwner) Ownable(_initialOwner) {
        require(address(_morphoCore) != address(0), "MorphoAdapter: invalid Morpho");
        require(_poolToken != address(0), "MorphoAdapter: invalid pool token");

        morpho = _morphoCore;
        poolToken = _poolToken;

        // Derive the underlying ERC‑20 from the pool token if it exposes `baseToken()` (Comet style),
        // otherwise assume the pool token *is* the underlying (caller responsibility).
        address asset;
        try ICometLike(_poolToken).baseToken() returns (address _base) {
            asset = _base;
        } catch {
            asset = _poolToken; // Fallback for v2‑style cTokens where underlying must be passed explicitly
        }
        require(asset != address(0), "MorphoAdapter: cannot determine underlying");
        underlyingToken = IERC20(asset);

        // Approve Morpho once for max amount
        underlyingToken.approve(address(_morphoCore), type(uint256).max);
    }

    /*───────────────────────────  IYieldAdapter  ───────────────────────────*/

    function asset() external view override returns (IERC20) {
        return underlyingToken;
    }

    /// @notice Deposit `_amountToDeposit` underlying into Morpho on chosen market.
    function deposit(uint256 _amountToDeposit) external override {
        require(_amountToDeposit > 0, "MorphoAdapter: amount zero");
        underlyingToken.safeTransferFrom(msg.sender, address(this), _amountToDeposit);
        morpho.supply(poolToken, address(this), _amountToDeposit);
    }

    /// @notice Owner‑only: withdraw underlying up to `_targetAmountOfUnderlyingToWithdraw`.
    function withdraw(uint256 _targetAmountOfUnderlyingToWithdraw, address _to)
        external
        override
        onlyOwner
        returns (uint256 actuallyWithdrawn)
    {
        require(_to != address(0), "MorphoAdapter: zero address");
        if (_targetAmountOfUnderlyingToWithdraw == 0) return 0;

        uint256 beforeBal = underlyingToken.balanceOf(address(this));
        morpho.withdraw(poolToken, _targetAmountOfUnderlyingToWithdraw);
        uint256 afterBal = underlyingToken.balanceOf(address(this));
        actuallyWithdrawn = afterBal - beforeBal;

        if (actuallyWithdrawn > 0) {
            underlyingToken.safeTransfer(_to, actuallyWithdrawn);
            emit FundsWithdrawn(_to, _targetAmountOfUnderlyingToWithdraw, actuallyWithdrawn);
        }
    }

    /// @notice Current underlying value (liquid + supplied via Morpho)
    function getCurrentValueHeld() external view override returns (uint256) {
        uint256 liquid = underlyingToken.balanceOf(address(this));
        uint256 supplied;
        try morpho.supplyBalanceInOf(poolToken, address(this)) returns (uint256 bal) {
            supplied = bal;
        } catch {
            supplied = 0;
        }
        return liquid + supplied;
    }
}
