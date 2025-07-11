// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "../interfaces/IYieldAdapter.sol";

/**
 * @title SimpleYieldAdapter
 * @notice Minimal IYieldAdapter implementation for testing without mocks.
 */
contract SimpleYieldAdapter is IYieldAdapter, Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    IERC20 public immutable underlyingToken;
    address public depositor;
    uint256 public totalValueHeld;

    constructor(address _asset, address _depositor, address _owner) Ownable(_owner) {
        require(_asset != address(0), "Adapter: asset zero");
        underlyingToken = IERC20(_asset);
        depositor = _depositor;
    }

    modifier onlyDepositor() {
        require(msg.sender == depositor, "Adapter: not depositor");
        _;
    }

    function setDepositor(address _depositor) external onlyOwner {
        require(_depositor != address(0), "Adapter: zero depositor");
        depositor = _depositor;
    }

    function asset() external view override returns (IERC20) {
        return underlyingToken;
    }

    function deposit(uint256 amount) external override onlyDepositor nonReentrant {
        require(amount > 0, "Adapter: amount zero");
        underlyingToken.safeTransferFrom(msg.sender, address(this), amount);
        totalValueHeld += amount;
    }

    function withdraw(uint256 amount, address to) external override onlyDepositor nonReentrant returns (uint256) {
        require(to != address(0), "Adapter: to zero");
        uint256 available = Math.min(amount, underlyingToken.balanceOf(address(this)));
        if (available > 0) {
            totalValueHeld = totalValueHeld > available ? totalValueHeld - available : 0;
            underlyingToken.safeTransfer(to, available);
        }
        return available;
    }

    function getCurrentValueHeld() external view override returns (uint256) {
        return totalValueHeld;
    }

    function setTotalValueHeld(uint256 value) external onlyOwner {
        totalValueHeld = value;
    }

    function fundAdapter(uint256 amount) external onlyOwner {
        underlyingToken.safeTransferFrom(msg.sender, address(this), amount);
    }
}
