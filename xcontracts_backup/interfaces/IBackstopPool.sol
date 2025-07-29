// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.20;

interface IBackstopPool {
    function requestWithdrawal(uint256 shareAmount) external;
    function drawFund(uint256 amount) external;
    function receiveUsdcPremium(uint256 amount) external;
    function claimProtocolAssetRewards(address protocolToken) external;
    function claimProtocolAssetRewardsFor(address user, address protocolToken) external;
}

