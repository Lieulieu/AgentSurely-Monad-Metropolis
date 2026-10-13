// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";

/// @notice Interface a contract implements to receive reports from the
///         Chainlink CRE KeystoneForwarder (EVM write target).
interface IReceiver is IERC165 {
    /// @param metadata abi.encodePacked(workflowId, workflowName, workflowOwner)
    /// @param report   ABI-encoded payload produced by the workflow
    function onReport(bytes calldata metadata, bytes calldata report) external;
}
