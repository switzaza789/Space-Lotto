// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockUSDT is ERC20 {
    constructor() ERC20("Mock USDT", "mUSDT") {
        _mint(msg.sender, 1000000 * 10**18); // Mint 1,000,000 mUSDT to deployer
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
