// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import {RiskManager} from "contracts/core/RiskManager.sol";
import {MockCapitalPool} from "contracts/test/MockCapitalPool.sol";
import {MockPoolRegistry} from "contracts/test/MockPoolRegistry.sol";
import {MockPolicyNFT} from "contracts/test/MockPolicyNFT.sol";
import {MockBackstopPool} from "contracts/test/MockBackstopPool.sol";
import {MockLossDistributor} from "contracts/test/MockLossDistributor.sol";
import {MockPolicyManager} from "contracts/test/MockPolicyManager.sol";
import {MockRewardDistributor} from "contracts/test/MockRewardDistributor.sol";
import {MockERC20} from "contracts/test/MockERC20.sol";

contract RiskManagerFuzz is Test {
    RiskManager rm;
    MockCapitalPool cp;
    MockPoolRegistry pr;
    MockPolicyNFT nft;
    MockBackstopPool cat;
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
        cat = new MockBackstopPool(address(this));
        ld = new MockLossDistributor();
        rd = new MockRewardDistributor();
        rm = new RiskManager(address(this));
        rd.setCatPool(address(cat));

        rm.setAddresses(address(cp), address(pr), address(pm), address(cat), address(ld), address(rd));
        rm.setCommittee(committee);
    }

    function _prepareAllocation(uint256 pledge, uint256 poolId) internal {
        cp.triggerOnCapitalDeposited(address(rm), underwriter, pledge);
        cp.setUnderwriterAdapterAddress(underwriter, address(1));
        pr.setPoolCount(poolId + 1);
    }

    function testFuzz_allocateCapital(uint96 pledge, uint8 poolId) public {
        vm.assume(pledge > 0);
        poolId = uint8(bound(poolId, 0, 3));
        _prepareAllocation(pledge, poolId);
        uint256[] memory pools = new uint256[](1);
        pools[0] = poolId;
        vm.prank(underwriter);
        rm.allocateCapital(pools);
        assertTrue(rm.isAllocatedToPool(underwriter, poolId));
        assertEq(rm.underwriterPoolPledge(underwriter, poolId), pledge);
    }

    function testFuzz_requestDeallocateFromPool(uint96 pledge, uint96 amount) public {
        vm.assume(pledge > 0);
        vm.assume(amount > 0 && amount <= pledge);
        _prepareAllocation(pledge, 0);
        uint256[] memory pools = new uint256[](1);
        pools[0] = 0;
        vm.prank(underwriter);
        rm.allocateCapital(pools);
        pr.setPoolData(0, token, pledge, 0, 0, false, address(0), 0);
        vm.prank(underwriter);
        rm.requestDeallocateFromPool(0, amount);
        assertEq(rm.deallocationRequestAmount(underwriter, 0), amount);
    }

    function testFuzz_deallocateFromPool(uint96 pledge, uint96 amount) public {
        vm.assume(pledge > 0);
        vm.assume(amount > 0 && amount <= pledge);
        _prepareAllocation(pledge, 0);
        uint256[] memory pools = new uint256[](1);
        pools[0] = 0;
        vm.prank(underwriter);
        rm.allocateCapital(pools);
        pr.setPoolData(0, token, pledge, 0, 0, false, address(0), 0);
        vm.prank(underwriter);
        rm.requestDeallocateFromPool(0, amount);
        vm.prank(underwriter);
        rm.deallocateFromPool(0);
        assertEq(rm.underwriterPoolPledge(underwriter, 0), pledge - amount);
    }

    function testFuzz_claimPremiumRewards(uint96 pledge) public {
        vm.assume(pledge > 0);
        _prepareAllocation(pledge, 0);
        pr.setPoolData(0, token, 0, 0, 0, false, address(0), 0);
        uint256[] memory pools = new uint256[](1);
        pools[0] = 0;
        vm.prank(underwriter);
        rm.allocateCapital(pools);
        vm.prank(underwriter);
        rm.claimPremiumRewards(pools);
        assertEq(rd.claimCallCount(), 1);
    }

    function testFuzz_claimDistressedAssets(uint96 amount) public {
        pr.setPoolData(0, token, 0, 0, 0, false, address(0), 0);
        uint256[] memory ids = new uint256[](1);
        ids[0] = 0;
        vm.prank(underwriter);
        rm.claimDistressedAssets(ids);
        assertEq(cat.claimProtocolRewardsCallCount(), 1);
    }

    function testFuzz_updateCoverageSold(uint96 amt) public {
        pr.setPoolData(0, token, 0, 0, 0, false, address(0), 0);
        vm.prank(address(pm));
        rm.updateCoverageSold(0, amt, true);
        (, , uint256 sold,, , ,) = pr.getPoolData(0);
        assertEq(sold, amt);
    }

    function testFuzz_reportIncident(bool state) public {
        pr.setPoolCount(1);
        vm.prank(committee);
        rm.reportIncident(0, state);
        (, , , , bool paused,,) = pr.getPoolData(0);
        assertEq(paused, state);
    }

    function testFuzz_setPoolFeeRecipient(address recipient) public {
        pr.setPoolCount(1);
        vm.prank(committee);
        rm.setPoolFeeRecipient(0, recipient);
        (, , , , , address stored,) = pr.getPoolData(0);
        assertEq(stored, recipient);
    }
}
