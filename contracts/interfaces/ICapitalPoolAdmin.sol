// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.20;

interface ICapitalPoolAdmin {
    enum YieldPlatform {
        NONE,
        AAVE,
        COMPOUND,
        OTHER_YIELD
    }

    function setRiskManagerAddress(address _riskManager) external;
    function setUnderwriterManagerAddress(address _underwriterManager) external;
    function setUnderwriterNoticePeriod(uint256 _newPeriod) external;
    function setBaseYieldAdapter(YieldPlatform _platform, address _adapterAddress) external;
}
