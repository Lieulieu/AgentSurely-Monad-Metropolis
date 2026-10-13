// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Optional access check SurelyVault runs before a client hires an agent.
interface IHireGate {
    function canHire(address client, uint256 agentId) external view returns (bool);
}
