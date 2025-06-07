// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "../interfaces/IYieldAdapter.sol";

interface IAaveV3Pool {
    function supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode) external;
    function withdraw(address asset, uint256 amount, address to) external returns (uint256);
}

contract AaveV3Adapter is IYieldAdapter, Ownable {
    using SafeERC20 for IERC20;

    IERC20 public immutable underlyingToken;
    IAaveV3Pool public immutable aavePool;
    IERC20 public immutable aToken;

    event FundsWithdrawn(address indexed to, uint256 requestedAmount, uint256 actualAmount);

    constructor(IERC20 _asset, IAaveV3Pool _pool, IERC20 _aToken, address _initialOwner) Ownable(_initialOwner) {
        require(address(_asset) != address(0), "AaveV3Adapter: invalid asset");
        require(address(_pool) != address(0), "AaveV3Adapter: invalid pool");
        require(address(_aToken) != address(0), "AaveV3Adapter: invalid aToken");
        underlyingToken = _asset;
        aavePool = _pool;
        aToken = _aToken;
        _asset.approve(address(_pool), type(uint256).max);
    }

    function asset() external view override returns (IERC20) {
        return underlyingToken;
    }

    function deposit(uint256 _amountToDeposit) external override {
        require(_amountToDeposit > 0, "AaveV3Adapter: amount zero");
        underlyingToken.safeTransferFrom(msg.sender, address(this), _amountToDeposit);
        aavePool.supply(address(underlyingToken), _amountToDeposit, address(this), 0);
    }

    function withdraw(uint256 _targetAmountOfUnderlyingToWithdraw, address _to)
        external
        override
        onlyOwner
        returns (uint256 actuallyWithdrawn)
    {
        require(_to != address(0), "AaveV3Adapter: zero address");
        if (_targetAmountOfUnderlyingToWithdraw == 0) {
            return 0;
        }
        uint256 beforeBal = underlyingToken.balanceOf(address(this));
        actuallyWithdrawn = aavePool.withdraw(address(underlyingToken), _targetAmountOfUnderlyingToWithdraw, address(this));
        uint256 afterBal = underlyingToken.balanceOf(address(this));
        if (actuallyWithdrawn == 0) {
            actuallyWithdrawn = afterBal - beforeBal;
        }
        if (actuallyWithdrawn > 0) {
            underlyingToken.safeTransfer(_to, actuallyWithdrawn);
        }
        emit FundsWithdrawn(_to, _targetAmountOfUnderlyingToWithdraw, actuallyWithdrawn);
    }

    function getCurrentValueHeld() external view override returns (uint256) {
        uint256 liquid = underlyingToken.balanceOf(address(this));
        uint256 aTokenBal = aToken.balanceOf(address(this));
        return liquid + aTokenBal;
    }
}
