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

    event DepositorSet(address indexed newDepositor);
    event Deposited(address indexed caller, uint256 amount);
    event Withdrawn(address indexed caller, address indexed to, uint256 amountRequested, uint256 amountTransferred);
    event TotalValueHeldSet(uint256 newValue);

    constructor(address _asset, address depositorAddress, address _owner) Ownable(_owner) {
        require(_asset != address(0), "Adapter: asset zero");
        require(depositorAddress != address(0), "Adapter: zero depositor");
        underlyingToken = IERC20(_asset);
        depositor = depositorAddress;
    }

    modifier onlyDepositor() {
        require(msg.sender == depositor, "Adapter: not depositor");
        _;
    }

    function setDepositor(address depositorAddress) external onlyOwner {
        require(depositorAddress != address(0), "Adapter: zero depositor");
        depositor = depositorAddress;
        emit DepositorSet(depositorAddress);
    }

    function asset() external view override returns (IERC20) {
        return underlyingToken;
    }

    function deposit(uint256 amount) external override onlyDepositor nonReentrant {
        require(amount > 0, "Adapter: amount zero");
        underlyingToken.safeTransferFrom(msg.sender, address(this), amount);
        totalValueHeld += amount;
        emit Deposited(msg.sender, amount);
    }

    function withdraw(uint256 amount, address to) external override onlyDepositor nonReentrant returns (uint256) {
        require(to != address(0), "Adapter: to zero");
        uint256 available = Math.min(amount, underlyingToken.balanceOf(address(this)));
        if (available > 0) {
            totalValueHeld = totalValueHeld > available ? totalValueHeld - available : 0;
            underlyingToken.safeTransfer(to, available);
            emit Withdrawn(msg.sender, to, amount, available);
        }
        return available;
    }

    function getCurrentValueHeld() external view override returns (uint256) {
        return totalValueHeld;
    }

    function setTotalValueHeld(uint256 value) external onlyOwner {
        totalValueHeld = value;
        emit TotalValueHeldSet(value);
    }

    function fundAdapter(uint256 amount) external onlyOwner {
        underlyingToken.safeTransferFrom(msg.sender, address(this), amount);
    }
}
