// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/*─────────────────────────── oShare ────────────────────────────
Receipt token minted to underwriters for each pool deposit.
----------------------------------------------------------------*/
contract oShare is ERC20 {
    IERC20  public immutable asset;   // primary asset (e.g., USDC)
    address public immutable pool;    // CoverPool that controls mint/burn

    constructor(IERC20 _asset, address _pool, string memory name_, string memory symbol_)
        ERC20(name_, symbol_)
    {
        require(_pool != address(0), "oShare: zero pool");
        asset = _asset;
        pool  = _pool;
    }

    modifier onlyPool() { require(msg.sender == pool, "oShare: only pool"); _; }

    function mint(address to, uint256 amt) external onlyPool { _mint(to, amt); }
    function burn(address from, uint256 amt) external onlyPool { _burn(from, amt); }
}