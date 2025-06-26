// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import {PolicyNFT} from "../src/PolicyNFT.sol";

contract PolicyNFTFuzz is Test {
    PolicyNFT nft;
    address owner = address(this);
    address manager = address(0x1);
    address user = address(0x2);

    function setUp() public {
        nft = new PolicyNFT(address(0), owner);
    }

    function testFuzz_SetPolicyManagerAddress(address newManager) public {
        vm.assume(newManager != address(0));
        nft.setPolicyManagerAddress(newManager);
        assertEq(nft.policyManagerContract(), newManager);
    }

    function testFuzz_SetPolicyManagerAddressOnlyOwner(address newManager) public {
        vm.assume(newManager != address(0));
        vm.prank(user);
        vm.expectRevert(abi.encodeWithSignature("OwnableUnauthorizedAccount(address)", user));
        nft.setPolicyManagerAddress(newManager);
    }

    function testFuzz_MintStoresPolicy(
        address to,
        uint256 pid,
        uint256 coverage,
        uint256 activation,
        uint128 deposit,
        uint128 drain
    ) public {
        vm.assume(to != address(0) && to.code.length == 0);
        nft.setPolicyManagerAddress(manager);
        vm.prank(manager);
        uint256 id = nft.mint(to, pid, coverage, activation, deposit, drain);
        assertEq(id, 1);
        PolicyNFT.Policy memory p = nft.getPolicy(1);
        assertEq(p.coverage, coverage);
        assertEq(p.poolId, pid);
        assertEq(p.activation, activation);
        assertEq(p.premiumDeposit, deposit);
        assertEq(p.lastDrainTime, drain);
        assertEq(nft.ownerOf(1), to);
    }

    function testFuzz_BurnDeletesPolicy(uint256 pid, uint256 coverage) public {
        nft.setPolicyManagerAddress(manager);
        vm.prank(manager);
        nft.mint(user, pid, coverage, 0, 0, 0);

        vm.prank(manager);
        nft.burn(1);
        vm.expectRevert();
        nft.ownerOf(1);
        PolicyNFT.Policy memory p = nft.getPolicy(1);
        assertEq(p.coverage, 0);
        assertEq(p.poolId, 0);
        assertEq(p.start, 0);
    }

    function testFuzz_UpdatePremiumAccount(uint128 deposit, uint128 drain) public {
        nft.setPolicyManagerAddress(manager);
        vm.prank(manager);
        nft.mint(user, 1, 1, 0, 0, 0);

        vm.prank(manager);
        nft.updatePremiumAccount(1, deposit, drain);
        PolicyNFT.Policy memory p = nft.getPolicy(1);
        assertEq(p.premiumDeposit, deposit);
        assertEq(p.lastDrainTime, drain);
    }

    function testFuzz_FinalizeIncreases(uint256 addAmount) public {
        nft.setPolicyManagerAddress(manager);
        vm.prank(manager);
        nft.mint(user, 1, 100, 0, 0, 0);
        vm.assume(addAmount > 0 && addAmount <= type(uint256).max - 100);
        vm.prank(manager);
        nft.finalizeIncreases(1, addAmount);
        PolicyNFT.Policy memory p = nft.getPolicy(1);
        assertEq(p.coverage, 100 + addAmount);
    }

    function testFuzz_GetPolicyNonexistent(uint256 id) public view {
        vm.assume(id != 1);
        PolicyNFT.Policy memory p = nft.getPolicy(id);
        assertEq(p.coverage, 0);
        assertEq(p.poolId, 0);
        assertEq(p.start, 0);
    }
}
