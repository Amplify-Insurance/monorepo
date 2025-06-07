// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "../interfaces/IYieldAdapter.sol";

interface IComet {
    function supply(address asset, uint256 amount) external;
    function withdraw(address asset, uint256 amount) external;
    function baseToken() external view returns (address);
    function balanceOf(address account) external view returns (uint256);
}

contract CompoundV3Adapter is IYieldAdapter, Ownable {
    using SafeERC20 for IERC20;

    IERC20 public immutable underlyingToken;
    IComet public immutable comet;

    event FundsWithdrawn(address indexed to, uint256 requestedAmount, uint256 actualAmount);

    constructor(IComet _comet, address _initialOwner) Ownable(_initialOwner) {
        address asset = _comet.baseToken();
        require(asset != address(0), "CompoundV3Adapter: invalid asset");
        underlyingToken = IERC20(asset);
        comet = _comet;
        IERC20(asset).approve(address(_comet), type(uint256).max);
    }

    function asset() external view override returns (IERC20) {
        return underlyingToken;
    }

    function deposit(uint256 _amountToDeposit) external override {
        require(_amountToDeposit > 0, "CompoundV3Adapter: amount zero");
        underlyingToken.safeTransferFrom(msg.sender, address(this), _amountToDeposit);
        comet.supply(address(underlyingToken), _amountToDeposit);
    }

    function withdraw(uint256 _targetAmountOfUnderlyingToWithdraw, address _to)
        external
        override
        onlyOwner
        returns (uint256 actuallyWithdrawn)
    {
        require(_to != address(0), "CompoundV3Adapter: zero address");
        if (_targetAmountOfUnderlyingToWithdraw == 0) {
            return 0;
        }
        uint256 beforeBal = underlyingToken.balanceOf(address(this));
        comet.withdraw(address(underlyingToken), _targetAmountOfUnderlyingToWithdraw);
        uint256 afterBal = underlyingToken.balanceOf(address(this));
        actuallyWithdrawn = afterBal - beforeBal;
        if (actuallyWithdrawn > 0) {
            underlyingToken.safeTransfer(_to, actuallyWithdrawn);
        }
        emit FundsWithdrawn(_to, _targetAmountOfUnderlyingToWithdraw, actuallyWithdrawn);
    }

    function getCurrentValueHeld() external view override returns (uint256) {
        uint256 liquid = underlyingToken.balanceOf(address(this));
        uint256 supplied = comet.balanceOf(address(this));
        return liquid + supplied;
    }
}
