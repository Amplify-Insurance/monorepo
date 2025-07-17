// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.20;

interface ICapitalPoolAdmin {
    enum YieldPlatform {
        NONE,
        AAVE,
        COMPOUND,
        OTHER_YIELD
    }

    function setRiskManager(address _riskManager) external;
    function setUnderwriterManager(address _underwriterManager) external;
    function setUnderwriterNoticePeriod(uint256 _newPeriod) external;
    function setBaseYieldAdapter(YieldPlatform _platform, address _adapterAddress) external;
}
