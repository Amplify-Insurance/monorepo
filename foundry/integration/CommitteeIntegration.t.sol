// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import {CatShare} from "contracts/tokens/CatShare.sol";
import {StakingContract} from "contracts/governance/Staking.sol";
import {IPoolRegistry} from "contracts/interfaces/IPoolRegistry.sol";
import {Committee} from "contracts/governance/Committee.sol";
import {RiskManager} from "contracts/core/RiskManager.sol";
import {PoolRegistry} from "contracts/core/PoolRegistry.sol";
import {CapitalPool} from "contracts/core/CapitalPool.sol";
import {BackstopPool} from "contracts/external/BackstopPool.sol";
import {LossDistributor} from "contracts/utils/LossDistributor.sol";
import {RewardDistributor} from "contracts/utils/RewardDistributor.sol";
import {PolicyNFT} from "contracts/tokens/PolicyNFT.sol";
import {PolicyManager} from "contracts/core/PolicyManager.sol";
import {ResetApproveERC20} from "contracts/test/ResetApproveERC20.sol";
import {IYieldAdapter} from "contracts/interfaces/IYieldAdapter.sol";

contract CommitteeIntegration is Test {
    CatShare govToken;
    StakingContract staking;
    Committee committee;
    RiskManager riskManager;
    PoolRegistry registry;

    address owner = address(this);
    address proposer = address(0x1);
    address nonStaker = address(0x2);

    function setUp() public {
        govToken = new CatShare();
        staking = new StakingContract(address(govToken), owner);
        riskManager = new RiskManager(owner);
        registry = new PoolRegistry(owner, address(riskManager));
        ResetApproveERC20 usdc = new ResetApproveERC20("USD Coin", "USDC", 6);

        CapitalPool capital = new CapitalPool(owner, address(usdc));
        capital.setRiskManager(address(riskManager));

        CatShare catShare = new CatShare();
        BackstopPool catPool = new BackstopPool(usdc, catShare, IYieldAdapter(address(0)), owner);
        catShare.transferOwnership(address(catPool));
        catPool.initialize();

        PolicyNFT nft = new PolicyNFT(address(this), owner);
        PolicyManager pm = new PolicyManager(address(nft), owner);
        nft.setPolicyManagerAddress(address(pm));

        RewardDistributor rewards = new RewardDistributor(address(riskManager), address(pm));
        rewards.setCatPool(address(catPool));

        LossDistributor loss = new LossDistributor(address(riskManager));

        pm.setAddresses(address(registry), address(capital), address(catPool), address(rewards), address(riskManager));
        catPool.setRiskManagerAddress(address(riskManager));
        catPool.setCapitalPoolAddress(address(capital));
        catPool.setPolicyManagerAddress(address(pm));
        catPool.setRewardDistributor(address(rewards));

        riskManager.setAddresses(
            address(capital), address(registry), address(pm), address(catPool), address(loss), address(rewards)
        );
        committee = new Committee(address(riskManager), address(staking), 1 days, 1 days, 0, 0);
        staking.setCommitteeAddress(address(committee));
        riskManager.setCommittee(address(committee));
        riskManager.addProtocolRiskPool(
            address(govToken), IPoolRegistry.RateModel({base: 0, slope1: 0, slope2: 0, kink: 0}), 0
        );
        govToken.mint(proposer, 1000 ether);
        govToken.mint(nonStaker, 1000 ether);
        vm.prank(proposer);
        govToken.approve(address(staking), type(uint256).max);
        vm.prank(proposer);
        staking.stake(1000 ether);
    }

    function testNonStakerCannotCreateProposal() public {
        vm.prank(nonStaker);
        vm.expectRevert("Must be a staker");
        committee.createProposal(0, Committee.ProposalType.Pause, 0);
    }

    function testUnpauseClearsActiveProposal() public {
        vm.prank(proposer);
        uint256 id = committee.createProposal(0, Committee.ProposalType.Unpause, 0);
        vm.prank(proposer);
        committee.vote(id, Committee.VoteOption.For);
        vm.warp(block.timestamp + 1 days + 1);
        committee.executeProposal(id);
        assertTrue(!committee.activeProposalForPool(1));
    }
}
