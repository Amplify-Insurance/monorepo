// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.20;

interface IComet {
    function supply(address asset, uint256 amount) external;
    function withdraw(address asset, uint256 amount) external;
    function baseToken() external view returns (address);
    function balanceOf(address account) external view returns (uint256);

    struct UserBasic {
        int104 principal;
        uint64 baseTrackingIndex;
    }
    function userBasic(address) external view returns (UserBasic memory);
    function baseSupplyIndex() external view returns (uint256);
}
