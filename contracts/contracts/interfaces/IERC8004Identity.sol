// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Minimal view of an ERC-8004 Identity Registry.
/// In ERC-8004 every agent is an ERC-721 token: agentId == tokenId and the
/// token owner controls the agent. SurelyVault only needs ownership checks,
/// so it works with Monad's canonical registry or the local mock.
interface IERC8004Identity {
    function ownerOf(uint256 agentId) external view returns (address);
    function tokenURI(uint256 agentId) external view returns (string memory);
}
