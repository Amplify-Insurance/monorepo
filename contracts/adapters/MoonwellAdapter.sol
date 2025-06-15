// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "../interfaces/IYieldAdapter.sol";

/**
 * @title MoonwellAdapter
 * @notice Simple IYieldAdapter implementation for the Moonwell (Compound‑v2 style) market.
 * @dev  Works with any ERC‑20 market supported by Moonwell, provided the corresponding mToken
 *       (cToken‑like wrapper) is passed to the constructor.  Success codes are 0 just like Compound.
 */
interface IMToken is IERC20 {
    function mint(uint256 mintAmount) external returns (uint256);
    function redeemUnderlying(uint256 redeemAmount) external returns (uint256);
    function balanceOfUnderlying(address owner) external view returns (uint256);
}

interface IMTokenWithRate is IMToken {
    /// Current per-block supply rate, 1e18-scaled (“mantissa”) just like Compound V2
    function supplyRatePerBlock() external view returns (uint256);
}

contract MoonwellAdapter is IYieldAdapter, Ownable {
    using SafeERC20 for IERC20;

    IERC20 public immutable underlyingToken;
    IMToken public immutable mToken;

    event FundsWithdrawn(address indexed to, uint256 requestedAmount, uint256 actualAmount);

    uint256 private constant BLOCKS_PER_YEAR = 2_102_400; // 12-sec block ≈ 365 days
    uint256 private constant WAD            = 1e18;       // Compound mantissa scale

    constructor(
        IERC20 _asset,
        IMToken _mToken,
        address _initialOwner
    ) Ownable(_initialOwner) {
        require(address(_asset) != address(0), "MoonwellAdapter: invalid asset");
        require(address(_mToken) != address(0), "MoonwellAdapter: invalid mToken");
        underlyingToken = _asset;
        mToken = _mToken;

        // Approve maximum once up‑front so `mint` pulls funds seamlessly.
        _asset.approve(address(_mToken), type(uint256).max);
    }

    /*───────────────────────────  IYieldAdapter  ───────────────────────────*/

    /// @return The ERC‑20 token that this adapter accepts.
    function asset() external view override returns (IERC20) {
        return underlyingToken;
    }

    /// @notice Deposits `_amountToDeposit` of `underlyingToken`, minting mTokens.
    function deposit(uint256 _amountToDeposit) external override {
        require(_amountToDeposit > 0, "MoonwellAdapter: amount zero");
        underlyingToken.safeTransferFrom(msg.sender, address(this), _amountToDeposit);
        uint256 err = mToken.mint(_amountToDeposit);
        require(err == 0, "MoonwellAdapter: mint failed");
    }

    /// @notice Withdraws up to `_targetAmountOfUnderlyingToWithdraw` to `_to` (owner only).
    function withdraw(uint256 _targetAmountOfUnderlyingToWithdraw, address _to)
        external
        override
        onlyOwner
        returns (uint256 actuallyWithdrawn)
    {
        require(_to != address(0), "MoonwellAdapter: zero address");
        if (_targetAmountOfUnderlyingToWithdraw == 0) return 0;

        uint256 beforeBal = underlyingToken.balanceOf(address(this));
        uint256 err = mToken.redeemUnderlying(_targetAmountOfUnderlyingToWithdraw);
        require(err == 0, "MoonwellAdapter: redeem failed");
        uint256 afterBal = underlyingToken.balanceOf(address(this));
        actuallyWithdrawn = afterBal - beforeBal;

        if (actuallyWithdrawn > 0) {
            underlyingToken.safeTransfer(_to, actuallyWithdrawn);
            emit FundsWithdrawn(_to, _targetAmountOfUnderlyingToWithdraw, actuallyWithdrawn);
        }
    }

    /// @return Current underlying value held by this adapter (liquid + supplied).
    function getCurrentValueHeld() external view override returns (uint256) {
        uint256 liquid = underlyingToken.balanceOf(address(this));
        uint256 supplied;
        // `balanceOfUnderlying` is a view in Moonwell, but returns (uint).
        try mToken.balanceOfUnderlying(address(this)) returns (uint256 v) {
            supplied = v;
        } catch {
            supplied = 0;
        }
        return liquid + supplied;
    }

        function currentApr() external view returns (uint256 aprWad) {
        uint256 ratePerBlock = IMTokenWithRate(address(mToken)).supplyRatePerBlock(); // 1e18
        aprWad = ratePerBlock * BLOCKS_PER_YEAR; // still 1e18-scaled
    }
}
