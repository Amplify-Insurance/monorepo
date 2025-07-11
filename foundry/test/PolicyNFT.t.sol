// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import {PolicyNFT} from "contracts/tokens/PolicyNFT.sol";

contract PolicyNFTTest is Test {
    PolicyNFT nft;
    address owner = address(this);
    address manager = address(0x1);
    address user = address(0x2);
    address other = address(0x3);

    function setUp() public {
        nft = new PolicyNFT(address(0), owner);
    }

    function testInitialState() public {
        assertEq(nft.owner(), owner);
        assertEq(nft.nextId(), 1);
        assertEq(nft.policyManagerContract(), address(0));
        assertEq(nft.name(), "Premium Drain Cover");
        assertEq(nft.symbol(), "PCOVER");
    }

    function testSetPolicyManagerOnlyOwner() public {
        vm.prank(other);
        vm.expectRevert(abi.encodeWithSignature("OwnableUnauthorizedAccount(address)", other));
        nft.setPolicyManagerAddress(manager);

        nft.setPolicyManagerAddress(manager);
        assertEq(nft.policyManagerContract(), manager);
    }

    function testSetPolicyManagerCannotBeZero() public {
        vm.expectRevert(bytes("PolicyNFT: Address cannot be zero"));
        nft.setPolicyManagerAddress(address(0));
    }

    function testSetPolicyManagerChangeAccess() public {
        nft.setPolicyManagerAddress(manager);
        nft.setPolicyManagerAddress(other);

        vm.prank(manager);
        vm.expectRevert(bytes("PolicyNFT: Caller is not the authorized PolicyManager"));
        nft.mint(user, 1, 1, 0, 0, 0);

        vm.prank(other);
        nft.mint(user, 1, 1, 0, 0, 0);
        assertEq(nft.ownerOf(1), user);
    }

    function testMintOnlyPolicyManager() public {
        vm.prank(manager);
        vm.expectRevert(bytes("PolicyNFT: PolicyManager address not set"));
        nft.mint(user, 1, 1, 0, 0, 0);

        nft.setPolicyManagerAddress(manager);

        vm.expectRevert(bytes("PolicyNFT: Caller is not the authorized PolicyManager"));
        nft.mint(user, 1, 1, 0, 0, 0);

        vm.prank(manager);
        nft.mint(user, 1, 1000, 123, 500, 10);

        assertEq(nft.nextId(), 2);
        PolicyNFT.Policy memory p = nft.getPolicy(1);
        assertEq(p.coverage, 1000);
        assertEq(p.poolId, 1);
        assertEq(p.activation, 123);
        assertEq(p.premiumDeposit, 500);
        assertEq(p.lastDrainTime, 10);
        assertEq(nft.ownerOf(1), user);
    }

    function testMintSequentialIds() public {
        nft.setPolicyManagerAddress(manager);
        vm.prank(manager);
        nft.mint(user, 1, 1, 0, 0, 0);
        vm.prank(manager);
        nft.mint(other, 1, 1, 0, 0, 0);
        assertEq(nft.nextId(), 3);
        assertEq(nft.ownerOf(1), user);
        assertEq(nft.ownerOf(2), other);
    }

    function testBurn() public {
        nft.setPolicyManagerAddress(manager);
        vm.prank(manager);
        nft.mint(user, 1, 1, 0, 0, 0);

        vm.expectRevert(bytes("PolicyNFT: Caller is not the authorized PolicyManager"));
        nft.burn(1);

        vm.prank(manager);
        nft.burn(1);
        vm.expectRevert(abi.encodeWithSignature("ERC721NonexistentToken(uint256)", 1));
        nft.ownerOf(1);
        PolicyNFT.Policy memory p = nft.getPolicy(1);
        assertEq(p.coverage, 0);
        assertEq(p.poolId, 0);
        assertEq(p.start, 0);
    }

    function testBurnNonexistentReverts() public {
        nft.setPolicyManagerAddress(manager);
        vm.prank(manager);
        vm.expectRevert(abi.encodeWithSignature("ERC721NonexistentToken(uint256)", 1));
        nft.burn(1);
    }

    function testUpdatePremiumAccount() public {
        nft.setPolicyManagerAddress(manager);
        vm.prank(manager);
        nft.mint(user, 1, 1, 0, 500, 0);

        vm.expectRevert(bytes("PolicyNFT: Caller is not the authorized PolicyManager"));
        nft.updatePremiumAccount(1, 300, 5);

        vm.prank(manager);
        nft.updatePremiumAccount(1, 300, 5);
        PolicyNFT.Policy memory p = nft.getPolicy(1);
        assertEq(p.premiumDeposit, 300);
        assertEq(p.lastDrainTime, 5);
    }

    function testUpdatePremiumAccountChecks() public {
        vm.prank(manager);
        vm.expectRevert(bytes("PolicyNFT: PolicyManager address not set"));
        nft.updatePremiumAccount(1, 0, 0);

        nft.setPolicyManagerAddress(manager);
        vm.prank(manager);
        vm.expectRevert(bytes("PolicyNFT: Policy does not exist or has been burned"));
        nft.updatePremiumAccount(1, 0, 0);

        vm.prank(manager);
        nft.mint(user, 1, 1, 0, 0, 0);
        vm.prank(manager);
        nft.burn(1);
        vm.prank(manager);
        vm.expectRevert(bytes("PolicyNFT: Policy does not exist or has been burned"));
        nft.updatePremiumAccount(1, 0, 0);
    }


    function testGetPolicyUnknownId() public {
        PolicyNFT.Policy memory p = nft.getPolicy(99);
        assertEq(p.coverage, 0);
        assertEq(p.poolId, 0);
        assertEq(p.start, 0);
    }
}
