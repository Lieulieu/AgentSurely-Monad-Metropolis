// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice Local stand-in for Circle's testnet USDC (and other stablecoins) in tests / local dev.
///         On Monad testnet the real USDC is used (0x534b…43A3, faucet.circle.com).
contract MockStable is ERC20 {
    uint8 private immutable _decimals;

    constructor(string memory name_, string memory symbol_, uint8 decimals_) ERC20(name_, symbol_) {
        _decimals = decimals_;
    }

    function decimals() public view override returns (uint8) {
        return _decimals;
    }

    /// @dev Mirrors Circle's faucet (20 USDC per request).
    function faucet() external {
        _mint(msg.sender, 20 * 10 ** _decimals);
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
