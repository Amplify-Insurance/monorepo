// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

import "forge-std/Test.sol";

import {RiskManager} from "contracts/core/RiskManager.sol";
import {MockCapitalPool} from "contracts/test/MockCapitalPool.sol";
import {MockPoolRegistry} from "contracts/test/MockPoolRegistry.sol";
import {MockPolicyNFT} from "contracts/test/MockPolicyNFT.sol";
import {MockCatInsurancePool} from "contracts/test/MockCatInsurancePool.sol";
import {MockLossDistributor} from "contracts/test/MockLossDistributor.sol";
import {MockPolicyManager} from "contracts/test/MockPolicyManager.sol";
import {MockRewardDistributor} from "contracts/test/MockRewardDistributor.sol";
import {MockERC20} from "contracts/test/MockERC20.sol";

contract RiskManagerTest is Test {
    RiskManager rm;
    MockCapitalPool cp;
    MockPoolRegistry pr;
    MockPolicyNFT nft;
    MockCatInsurancePool cat;
    MockLossDistributor ld;
    MockPolicyManager pm;
    MockRewardDistributor rd;
    MockERC20 token;

    address committee = address(0xBEEF);
    address underwriter = address(0xFACE);

    function setUp() public {
        token = new MockERC20("USD", "USD", 6);
        cp = new MockCapitalPool(address(this), address(token));
        pr = new MockPoolRegistry();
        nft = new MockPolicyNFT(address(this));
        pm = new MockPolicyManager();
        pm.setPolicyNFT(address(nft));
        cat = new MockCatInsurancePool(address(this));
        ld = new MockLossDistributor();
        rd = new MockRewardDistributor();
        rm = new RiskManager(address(this));
        rd.setCatPool(address(cat));

        rm.setAddresses(address(cp), address(pr), address(pm), address(cat), address(ld), address(rd));
        rm.setCommittee(committee);
    }

    function testAllocateCapital() public {
        uint256 pledge = 10_000 * 1e6;
        cp.triggerOnCapitalDeposited(address(rm), underwriter, pledge);
        cp.setUnderwriterAdapterAddress(underwriter, address(1));
        pr.setPoolCount(2);

        uint256[] memory pools = new uint256[](2);
        pools[0] = 0;
        pools[1] = 1;

        vm.prank(underwriter);
        rm.allocateCapital(pools);

        assertTrue(rm.isAllocatedToPool(underwriter, 0));
        assertTrue(rm.isAllocatedToPool(underwriter, 1));
    }

    function testDeallocateFromPool() public {
        uint256 pledge = 5_000 * 1e6;
        cp.triggerOnCapitalDeposited(address(rm), underwriter, pledge);
        cp.setUnderwriterAdapterAddress(underwriter, address(1));
        pr.setPoolCount(1);

        uint256[] memory pools = new uint256[](1);
        pools[0] = 0;
        vm.prank(underwriter);
        rm.allocateCapital(pools);

        ld.setPendingLoss(underwriter, 0, 0);
        vm.prank(underwriter);
        rm.deallocateFromPool(0);

        assertFalse(rm.isAllocatedToPool(underwriter, 0));
    }
}

