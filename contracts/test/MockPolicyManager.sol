// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../interfaces/IPolicyManager.sol";
import "../interfaces/IPolicyNFT.sol";

/**
 * @title MockPolicyManager
 * @notice Minimal PolicyManager mock exposing the policyNFT address.
 */
contract MockPolicyManager is IPolicyManager {
    IPolicyNFT private _policyNFT;

    function setPolicyNFT(address nft) external {
        _policyNFT = IPolicyNFT(nft);
    }

    function policyNFT() external view override returns (IPolicyNFT) {
        return _policyNFT;
    }
}
