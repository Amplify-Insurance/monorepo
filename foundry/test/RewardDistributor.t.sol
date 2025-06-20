// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import {RewardDistributor} from "contracts/utils/RewardDistributor.sol";
import {MockERC20} from "contracts/test/MockERC20.sol";

contract RewardDistributorTest is Test {
    RewardDistributor rd;
    MockERC20 token;

    address owner = address(this);
    address riskManager = address(0x1);
    address catPool = address(0x2);
    address user = address(0x3);

    uint256 constant PRECISION = 1e18;

    function setUp() public {
        rd = new RewardDistributor(riskManager);
        token = new MockERC20("Reward", "RWD", 18);
        token.mint(address(rd), 1000 ether);
    }

    function testDeploymentSetsRiskManager() public {
        assertEq(rd.riskManager(), riskManager);
    }

    function testSetCatPool() public {
        vm.prank(owner);
        rd.setCatPool(catPool);
        assertEq(rd.catPool(), catPool);
    }

    function _setupDistribution() internal returns (uint256 poolId, uint256 userPledge) {
        poolId = 1;
        uint256 totalPledge = 1000 ether;
        uint256 rewardAmount = 100 ether;
        userPledge = 100 ether;

        vm.prank(riskManager);
        rd.distribute(poolId, address(token), rewardAmount, totalPledge);
        vm.prank(riskManager);
        rd.updateUserState(user, poolId, address(token), userPledge);
        vm.prank(riskManager);
        rd.distribute(poolId, address(token), rewardAmount, totalPledge);
    }

    function testDistributeAndClaim() public {
        (uint256 poolId, uint256 userPledge) = _setupDistribution();

        uint256 pending = rd.pendingRewards(user, poolId, address(token), userPledge);
        assertEq(pending, 10 ether);

        uint256 beforeBal = token.balanceOf(user);
        vm.prank(riskManager);
        uint256 claimed = rd.claim(user, poolId, address(token), userPledge);
        uint256 afterBal = token.balanceOf(user);

        assertEq(claimed, pending);
        assertEq(afterBal - beforeBal, pending);

        uint256 tracker = rd.poolRewardTrackers(poolId, address(token));
        uint256 userDebt = rd.userRewardStates(user, poolId, address(token));
        assertEq(userDebt, (userPledge * tracker) / PRECISION);
    }

    function testClaimForCatPoolOnlyCatPool() public {
        vm.prank(owner);
        rd.setCatPool(catPool);
        (uint256 poolId, uint256 userPledge) = _setupDistribution();

        vm.prank(catPool);
        rd.claimForCatPool(user, poolId, address(token), userPledge);

        vm.prank(address(0x4));
        vm.expectRevert("RD: Not CatPool");
        rd.claimForCatPool(user, poolId, address(token), userPledge);
    }

    function testUpdateUserStateOnlyRiskManager() public {
        vm.prank(address(0x5));
        vm.expectRevert("RD: Not RiskManager");
        rd.updateUserState(user, 1, address(token), 100 ether);
    }
}
