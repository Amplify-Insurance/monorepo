// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "../interfaces/IYieldAdapter.sol";
import "../interfaces/IEulerEToken.sol";
import "../interfaces/IEulerMarkets.sol";
import "../interfaces/IEulerVault.sol";

/* -------------------------------------------------------------------------- */
/*                                Adapter                                     */
/* -------------------------------------------------------------------------- */

contract EulerV2Adapter is IYieldAdapter, Ownable {
    using SafeERC20 for IERC20;

    IERC20         public immutable underlyingToken;
    IEulerEToken   public immutable eToken;
    IEulerMarkets  public immutable markets;
    IEulerVault    public immutable vault;        // kept for potential share-price logic

    uint256 private constant SECONDS_PER_YEAR = 365 days;
    uint256 private constant RAY              = 1e27;   // Euler uses 1e27 for rates

    /* -------------------------- constructor -------------------------------- */
    constructor(
        IERC20         _asset,
        IEulerEToken   _eToken,
        IEulerMarkets  _markets,
        IEulerVault    _vault,
        address        _initialOwner
    ) Ownable(_initialOwner)
    {
        require(address(_asset)   != address(0), "EulerV2Adapter: invalid asset");
        require(address(_eToken)  != address(0), "EulerV2Adapter: invalid eToken");
        require(address(_markets) != address(0), "EulerV2Adapter: invalid markets");
        require(address(_vault)   != address(0), "EulerV2Adapter: invalid vault");

        underlyingToken = _asset;
        eToken          = _eToken;
        markets         = _markets;
        vault           = _vault;

        _asset.approve(address(_eToken), type(uint256).max);
    }

    /* ------------------------ IYieldAdapter API --------------------------- */

    function asset() external view override returns (IERC20) {
        return underlyingToken;
    }

    function deposit(uint256 amount) external override {
        require(amount > 0, "EulerV2Adapter: amount zero");
        underlyingToken.safeTransferFrom(msg.sender, address(this), amount);
        eToken.deposit(0, amount); // subAccountId = 0
    }

    function withdraw(uint256 amount, address to)
        external
        override
        onlyOwner
        returns (uint256 actuallyWithdrawn)
    {
        require(to != address(0), "EulerV2Adapter: zero address");
        if (amount == 0) return 0;

        uint256 beforeBal = underlyingToken.balanceOf(address(this));
        eToken.withdraw(0, amount);
        uint256 afterBal  = underlyingToken.balanceOf(address(this));

        actuallyWithdrawn = afterBal - beforeBal;
        if (actuallyWithdrawn > 0) {
            underlyingToken.safeTransfer(to, actuallyWithdrawn);
            emit FundsWithdrawn(to, amount, actuallyWithdrawn);
        }
    }

    function getCurrentValueHeld() external view override returns (uint256) {
        uint256 liquid   = underlyingToken.balanceOf(address(this));
        uint256 supplied = 0;
        try eToken.balanceOfUnderlying(address(this)) returns (uint256 bal) {
            supplied = bal;
        } catch {}
        return liquid + supplied;
    }

    /* ------------------------------ APR ----------------------------------- */

    /**
     * @return aprWad  Current supply APR, 1 × 10-18-scaled (“wad”).
     *                 Divide by 1e16 off-chain for a percentage with two decimals.
     */
    function currentApr() external view returns (uint256 aprWad) {
        (, uint256 supplySPY) = markets.interestRate(address(underlyingToken)); // 1e27 per-second
        aprWad = (supplySPY / 1e9) * SECONDS_PER_YEAR;                          // 1e18 per-year
    }

    /* ----------------------------- events --------------------------------- */

    event FundsWithdrawn(address indexed to, uint256 requestedAmount, uint256 actualAmount);
}
