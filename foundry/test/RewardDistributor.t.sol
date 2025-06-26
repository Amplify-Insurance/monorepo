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

    function testConstructorZeroRiskManagerReverts() public {
        vm.expectRevert(RewardDistributor.ZeroAddress.selector);
        new RewardDistributor(address(0));
    }

    function testSetCatPoolOnlyOwner() public {
        vm.prank(address(0x5));
        vm.expectRevert("OwnableUnauthorizedAccount");
        rd.setCatPool(catPool);
    }

    function testSetCatPoolZeroReverts() public {
        vm.prank(owner);
        vm.expectRevert(RewardDistributor.ZeroAddress.selector);
        rd.setCatPool(address(0));
    }

    function testSetRiskManagerOnlyOwner() public {
        vm.prank(address(0x5));
        vm.expectRevert("OwnableUnauthorizedAccount");
        rd.setRiskManager(address(0x6));
    }

    function testSetRiskManagerZeroReverts() public {
        vm.prank(owner);
        vm.expectRevert(RewardDistributor.ZeroAddress.selector);
        rd.setRiskManager(address(0));
    }

    function testDistributeAccumulates() public {
        uint256 poolId = 1;
        uint256 totalPledge = 1000 ether;
        uint256 rewardAmount = 100 ether;

        vm.prank(riskManager);
        rd.distribute(poolId, address(token), rewardAmount, totalPledge);
        vm.prank(riskManager);
        rd.distribute(poolId, address(token), rewardAmount / 2, totalPledge);

        uint256 tracker = rd.poolRewardTrackers(poolId, address(token));
        uint256 expected = (rewardAmount + rewardAmount / 2) * PRECISION / totalPledge;
        assertEq(tracker, expected);
    }

    function testDistributeIgnoresZeroValues() public {
        uint256 poolId = 1;
        uint256 totalPledge = 1000 ether;
        uint256 rewardAmount = 100 ether;

        vm.prank(riskManager);
        rd.distribute(poolId, address(token), rewardAmount, totalPledge);
        uint256 before = rd.poolRewardTrackers(poolId, address(token));

        vm.prank(riskManager);
        rd.distribute(poolId, address(token), 0, totalPledge);
        vm.prank(riskManager);
        rd.distribute(poolId, address(token), rewardAmount, 0);

        uint256 afterTracker = rd.poolRewardTrackers(poolId, address(token));
        assertEq(before, afterTracker);
    }

    function testDistributeOnlyRiskManager() public {
        vm.expectRevert("RD: Not RiskManager");
        rd.distribute(1, address(token), 1 ether, 1 ether);
    }

    function testClaimReturnsZeroWhenNothing() public {
        vm.prank(riskManager);
        uint256 claimed = rd.claim(user, 1, address(token), 1 ether);
        assertEq(claimed, 0);
        assertEq(token.balanceOf(user), 0);
    }

    function testClaimOnlyRiskManager() public {
        vm.expectRevert("RD: Not RiskManager");
        rd.claim(user, 1, address(token), 1 ether);
    }

    function testClaimForCatPoolRevertsIfNotSet() public {
        vm.prank(catPool);
        vm.expectRevert("RD: Not CatPool");
        rd.claimForCatPool(user, 1, address(token), 1 ether);
    }


    function testUpdateUserStateRecordsDebt() public {
        uint256 poolId = 1;
        uint256 totalPledge = 1000 ether;
        uint256 rewardAmount = 100 ether;
        uint256 userPledge = 100 ether;

        vm.prank(riskManager);
        rd.distribute(poolId, address(token), rewardAmount, totalPledge);
        vm.prank(riskManager);
        rd.updateUserState(user, poolId, address(token), userPledge);

        uint256 tracker = rd.poolRewardTrackers(poolId, address(token));
        uint256 userDebt = rd.userRewardStates(user, poolId, address(token));
        assertEq(userDebt, userPledge * tracker / PRECISION);
    }

    function testPendingRewardsZeroAfterClaim() public {
        (uint256 poolId, uint256 userPledge) = _setupDistribution();
        vm.prank(riskManager);
        rd.claim(user, poolId, address(token), userPledge);
        uint256 pending = rd.pendingRewards(user, poolId, address(token), userPledge);
        assertEq(pending, 0);
    }

    function testMultipleTokensIndependent() public {
        (uint256 poolId, uint256 userPledge) = _setupDistribution();
        MockERC20 token2 = new MockERC20("Reward2", "RW2", 18);
        token2.mint(address(rd), 1000 ether);

        vm.prank(riskManager);
        rd.distribute(poolId, address(token2), 100 ether, 1000 ether);
        vm.prank(riskManager);
        rd.updateUserState(user, poolId, address(token2), userPledge);
        vm.prank(riskManager);
        rd.distribute(poolId, address(token2), 100 ether, 1000 ether);

        uint256 pending1 = rd.pendingRewards(user, poolId, address(token), userPledge);
        uint256 pending2 = rd.pendingRewards(user, poolId, address(token2), userPledge);
        assertEq(pending1, 10 ether);
        assertEq(pending2, 10 ether);
    }

    function testRewardsIndependentPerPool() public {
        uint256 poolId1 = 1;
        uint256 poolId2 = 2;
        uint256 totalPledge = 1000 ether;
        uint256 rewardAmount = 100 ether;
        uint256 userPledge1 = 100 ether;
        uint256 userPledge2 = 50 ether;

        vm.prank(riskManager);
        rd.distribute(poolId1, address(token), rewardAmount, totalPledge);
        vm.prank(riskManager);
        rd.updateUserState(user, poolId1, address(token), userPledge1);
        vm.prank(riskManager);
        rd.distribute(poolId1, address(token), rewardAmount, totalPledge);

        vm.prank(riskManager);
        rd.distribute(poolId2, address(token), rewardAmount, totalPledge);
        vm.prank(riskManager);
        rd.updateUserState(user, poolId2, address(token), userPledge2);
        vm.prank(riskManager);
        rd.distribute(poolId2, address(token), rewardAmount, totalPledge);

        uint256 pending1 = rd.pendingRewards(user, poolId1, address(token), userPledge1);
        uint256 pending2 = rd.pendingRewards(user, poolId2, address(token), userPledge2);
        assertEq(pending1, 10 ether);
        assertEq(pending2, 5 ether);
    }

    function testFractionalRewards() public {
        uint256 poolId = 1;
        vm.prank(riskManager);
        rd.distribute(poolId, address(token), 1, 2);
        vm.prank(riskManager);
        rd.updateUserState(user, poolId, address(token), 1);
        vm.prank(riskManager);
        rd.distribute(poolId, address(token), 1, 2);
        uint256 pending = rd.pendingRewards(user, poolId, address(token), 1);
        assertEq(pending, 1);
    }

    function testNewRiskManagerControls() public {
        address newRM = address(0x7);
        vm.prank(owner);
        rd.setRiskManager(newRM);
        vm.prank(riskManager);
        vm.expectRevert("RD: Not RiskManager");
        rd.distribute(1, address(token), 1, 1);
        vm.prank(newRM);
        rd.distribute(1, address(token), 1, 1);
    }

    function testNewCatPoolTakesOver() public {
        (uint256 poolId, uint256 userPledge) = _setupDistribution();
        address newCat = address(0x8);
        vm.prank(owner);
        rd.setCatPool(newCat);

        vm.prank(catPool);
        vm.expectRevert("RD: Not CatPool");
        rd.claimForCatPool(user, poolId, address(token), userPledge);

        vm.prank(newCat);
        rd.claimForCatPool(user, poolId, address(token), userPledge);
    }
}
