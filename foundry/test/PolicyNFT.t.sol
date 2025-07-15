// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import {PolicyNFT} from "contracts/tokens/PolicyNFT.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol"; // Import for custom error

contract PolicyNFTTest is Test {
    PolicyNFT nft;
    address owner = address(this);
    address policyManager = address(0x1);
    address user = address(0x2);
    address other = address(0x3);

    function setUp() public {
        // This is now correct: the policyManager is set on deployment.
        nft = new PolicyNFT(policyManager, owner);
    }

    function testInitialState() public {
        assertEq(nft.owner(), owner);
        assertEq(nft.nextId(), 1);
        assertEq(nft.policyManagerContract(), policyManager);
        
        // FIX: The contract's name is hardcoded as "Policy" in its constructor.
        assertEq(nft.name(), "Policy"); 
        
        assertEq(nft.symbol(), "PCOVER");
    }

    function testSetPolicyManagerOnlyOwner() public {
        vm.prank(other);
        // FIX: Use the correct custom error from Ownable
        vm.expectRevert(abi.encodeWithSignature("OwnableUnauthorizedAccount(address)", other));
        nft.setPolicyManagerAddress(policyManager);

        // This is the happy path test
        nft.setPolicyManagerAddress(policyManager);
        assertEq(nft.policyManagerContract(), policyManager);
    }

    function testSetPolicyManagerCannotBeZero() public {
        vm.expectRevert(bytes("PolicyNFT: Address cannot be zero"));
        nft.setPolicyManagerAddress(address(0));
    }

    function testSetPolicyManagerChangeAccess() public {
        nft.setPolicyManagerAddress(policyManager);
        nft.setPolicyManagerAddress(other);

        vm.prank(policyManager);
        vm.expectRevert(bytes("PolicyNFT: Caller is not the authorized PolicyManager"));
        nft.mint(user, 1, 1, 0, 0, 0);

        vm.prank(other);
        nft.mint(user, 1, 1, 0, 0, 0);
        assertEq(nft.ownerOf(1), user);
    }

    function testMintOnlyPolicyManager() public {
        // FIX: This check is no longer needed because the policy manager is always set in setUp.
        // vm.prank(policyManager);
        // vm.expectRevert(bytes("PolicyNFT: PolicyManager address not set"));
        // nft.mint(user, 1, 1, 0, 0, 0);

        // This check correctly tests that a non-manager address cannot mint.
        vm.prank(other); // Prank as a different address
        vm.expectRevert(bytes("PolicyNFT: Caller is not the authorized PolicyManager"));
        nft.mint(user, 1, 1, 0, 0, 0);

        // This checks the successful mint path
        vm.prank(policyManager);
        uint256 policyId = nft.mint(user, 1, 1000, 123, 500, 10);

        assertEq(policyId, 1);
        PolicyNFT.Policy memory p = nft.getPolicy(1);
        assertEq(p.coverage, 1000);
        assertEq(p.poolId, 1);
        assertEq(p.activation, 123);
        assertEq(p.premiumDeposit, 500);
        assertEq(p.lastDrainTime, 10);
        assertEq(nft.ownerOf(1), user);
    }

    function testMintSequentialIds() public {
        nft.setPolicyManagerAddress(policyManager);
        vm.prank(policyManager);
        nft.mint(user, 1, 1, 0, 0, 0);
        vm.prank(policyManager);
        nft.mint(other, 1, 1, 0, 0, 0);
        assertEq(nft.nextId(), 3);
        assertEq(nft.ownerOf(1), user);
        assertEq(nft.ownerOf(2), other);
    }

    function testBurn() public {
        nft.setPolicyManagerAddress(policyManager);
        vm.prank(policyManager);
        nft.mint(user, 1, 1, 0, 0, 0);

        vm.expectRevert(bytes("PolicyNFT: Caller is not the authorized PolicyManager"));
        nft.burn(1);

        vm.prank(policyManager);
        nft.burn(1);
        vm.expectRevert(abi.encodeWithSignature("ERC721NonexistentToken(uint256)", 1));
        nft.ownerOf(1);
        PolicyNFT.Policy memory p = nft.getPolicy(1);
        assertEq(p.coverage, 0);
        assertEq(p.poolId, 0);
        assertEq(p.start, 0);
    }

    function testBurnNonexistentReverts() public {
        nft.setPolicyManagerAddress(policyManager);
        vm.prank(policyManager);
        vm.expectRevert(abi.encodeWithSignature("ERC721NonexistentToken(uint256)", 1));
        nft.burn(1);
    }

    function testUpdatePremiumAccount() public {
        nft.setPolicyManagerAddress(policyManager);
        vm.prank(policyManager);
        nft.mint(user, 1, 1, 0, 500, 0);

        vm.expectRevert(bytes("PolicyNFT: Caller is not the authorized PolicyManager"));
        nft.updatePremiumAccount(1, 300, 5);

        vm.prank(policyManager);
        nft.updatePremiumAccount(1, 300, 5);
        PolicyNFT.Policy memory p = nft.getPolicy(1);
        assertEq(p.premiumDeposit, 300);
        assertEq(p.lastDrainTime, 5);
    }

    function testUpdatePremiumAccountChecks() public {
        // FIX: This check is no longer needed because the policy manager is always set in setUp.
        // vm.prank(policyManager);
        // vm.expectRevert(bytes("PolicyNFT: PolicyManager address not set"));
        // nft.updatePremiumAccount(1, 0, 0);

        // This correctly tests that you can't update a non-existent policy.
        vm.prank(policyManager);
        vm.expectRevert(bytes("PolicyNFT: Policy does not exist or has been burned"));
        nft.updatePremiumAccount(1, 0, 0);

        // This correctly tests that you can't update a burned policy.
        vm.prank(policyManager);
        uint256 policyId = nft.mint(user, 1, 1, 0, 0, 0);
        vm.prank(policyManager);
        nft.burn(policyId);
        vm.prank(policyManager);
        vm.expectRevert(bytes("PolicyNFT: Policy does not exist or has been burned"));
        nft.updatePremiumAccount(policyId, 0, 0);
    }


    function testGetPolicyUnknownId() public {
        PolicyNFT.Policy memory p = nft.getPolicy(99);
        assertEq(p.coverage, 0);
        assertEq(p.poolId, 0);
        assertEq(p.start, 0);
    }


    // 2. Add a new test function for `finalizeIncreases`
function testFinalizeIncreases() public {
    // --- Setup ---
    vm.prank(policyManager);
    uint256 policyId = nft.mint(user, 1, 1000, 0, 0, 0); // Initial coverage is 1000

    uint256 amountToAdd = 500;

    // --- Happy Path ---
    vm.prank(policyManager);
    nft.finalizeIncreases(policyId, amountToAdd);
    PolicyNFT.Policy memory p = nft.getPolicy(policyId);
    assertEq(p.coverage, 1000 + amountToAdd, "Coverage was not increased correctly");

    // --- Revert: Not Policy Manager ---
    vm.prank(other);
    vm.expectRevert(bytes("PolicyNFT: Caller is not the authorized PolicyManager"));
    nft.finalizeIncreases(policyId, amountToAdd);

    // --- Revert: Amount is zero ---
    vm.prank(policyManager);
    vm.expectRevert(bytes("PolicyNFT: Amount to add must be greater than zero"));
    nft.finalizeIncreases(policyId, 0);

    // --- Revert: Policy does not exist ---
    vm.prank(policyManager);
    vm.expectRevert(bytes("PolicyNFT: Policy does not exist or has been burned"));
    nft.finalizeIncreases(99, amountToAdd); // Non-existent ID
}

// 3. (Optional) Add a test for the constructor revert
function testRevert_constructor_zeroAddress() public {
    vm.expectRevert("PolicyNFT: PolicyManager address cannot be zero");
    new PolicyNFT(address(0), owner);
}

// 4. (Optional) Add a basic ERC721 transfer test for full compliance check
function testTransfer() public {
    vm.prank(policyManager);
    uint256 policyId = nft.mint(user, 1, 1000, 0, 0, 0);

    // Test transfer
    vm.prank(user);
    nft.transferFrom(user, other, policyId);
    assertEq(nft.ownerOf(policyId), other);
}
}
