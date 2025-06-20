// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import {CapitalPool} from "contracts/core/CapitalPool.sol";
import {MockYieldAdapter} from "contracts/test/MockYieldAdapter.sol";
import {MockERC20} from "contracts/test/MockERC20.sol";
import {MockRiskManager} from "contracts/test/MockRiskManager.sol";

contract CapitalPoolFuzz is Test {
    CapitalPool pool;
    MockERC20 token;
    MockYieldAdapter adapter;
    MockRiskManager rm;

    uint256 constant INITIAL_SUPPLY = 1_000_000e6; // 1 million tokens with 6 decimals

    function setUp() public {
        token = new MockERC20("USD", "USD", 6);
        token.mint(address(this), INITIAL_SUPPLY);
        rm = new MockRiskManager();
        pool = new CapitalPool(address(this), address(token));
        pool.setRiskManager(address(rm));
        pool.setUnderwriterNoticePeriod(0);
        adapter = new MockYieldAdapter(address(token), address(0), address(this));
        adapter.setDepositor(address(pool));
        pool.setBaseYieldAdapter(CapitalPool.YieldPlatform.AAVE, address(adapter));
        token.approve(address(pool), type(uint256).max);
    }

    function testFuzz_depositWithdraw(uint96 amount) public {
        vm.assume(amount > 0 && amount < INITIAL_SUPPLY);
        pool.deposit(amount, CapitalPool.YieldPlatform.AAVE);
        (uint256 principal,, uint256 shares,,) = pool.getUnderwriterAccount(address(this));
        assertEq(principal, amount);
        assertEq(shares, amount);

        pool.requestWithdrawal(shares);
        pool.executeWithdrawal();

        (principal,, shares,,) = pool.getUnderwriterAccount(address(this));
        assertEq(principal, 0);
        assertEq(shares, 0);
        assertEq(token.balanceOf(address(this)) + adapter.totalValueHeld(), INITIAL_SUPPLY);
        assertEq(pool.totalSystemValue(), adapter.totalValueHeld());
    }
}
