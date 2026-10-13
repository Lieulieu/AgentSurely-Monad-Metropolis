// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {IERC8004Validation} from "./interfaces/IERC8004Validation.sol";

/// @title  ValidationRegistry — minimal ERC-8004 Validation Registry
/// @notice No canonical Validation Registry is deployed on Monad yet (the
///         erc-8004 reference repo lists only Identity + Reputation), so
///         AgentSurely ships this spec-shaped implementation bound to the
///         canonical Identity Registry. Swap for the canonical one once live.
contract ValidationRegistry is IERC8004Validation {
    struct Validation {
        address validatorAddress;
        uint256 agentId;
        uint8 response;
        bytes32 responseHash;
        string tag;
        uint256 lastUpdate;
        bool hasResponse;
    }

    IERC721 public immutable identityRegistry;
    mapping(bytes32 requestHash => Validation) internal _validations;
    mapping(uint256 agentId => bytes32[]) internal _agentValidations;
    mapping(address validator => bytes32[]) internal _validatorRequests;

    constructor(IERC721 identityRegistry_) {
        identityRegistry = identityRegistry_;
    }

    function validationRequest(address validatorAddress, uint256 agentId, string calldata requestURI, bytes32 requestHash)
        external
    {
        require(validatorAddress != address(0), "bad validator");
        require(_validations[requestHash].validatorAddress == address(0), "exists");
        address owner = identityRegistry.ownerOf(agentId);
        require(
            msg.sender == owner || identityRegistry.isApprovedForAll(owner, msg.sender)
                || identityRegistry.getApproved(agentId) == msg.sender,
            "Not authorized"
        );
        Validation storage v = _validations[requestHash];
        v.validatorAddress = validatorAddress;
        v.agentId = agentId;
        v.lastUpdate = block.timestamp;
        _agentValidations[agentId].push(requestHash);
        _validatorRequests[validatorAddress].push(requestHash);
        emit ValidationRequest(validatorAddress, agentId, requestURI, requestHash);
    }

    function validationResponse(
        bytes32 requestHash,
        uint8 response,
        string calldata responseURI,
        bytes32 responseHash,
        string calldata tag
    ) external {
        Validation storage v = _validations[requestHash];
        require(v.validatorAddress != address(0), "unknown");
        require(msg.sender == v.validatorAddress, "not validator");
        require(response <= 100, "resp>100");
        v.response = response;
        v.responseHash = responseHash;
        v.tag = tag;
        v.lastUpdate = block.timestamp;
        v.hasResponse = true;
        emit ValidationResponse(v.validatorAddress, v.agentId, requestHash, response, responseURI, responseHash, tag);
    }

    function getValidationStatus(bytes32 requestHash)
        external
        view
        returns (address validatorAddress, uint256 agentId, uint8 response, bytes32 responseHash, string memory tag, uint256 lastUpdate)
    {
        Validation storage v = _validations[requestHash];
        return (v.validatorAddress, v.agentId, v.response, v.responseHash, v.tag, v.lastUpdate);
    }

    /// @notice Count and average response of answered validations, optionally filtered by validator and tag.
    function getSummary(uint256 agentId, address[] calldata validatorAddresses, string calldata tag)
        external
        view
        returns (uint64 count, uint8 averageResponse)
    {
        bytes32[] storage hashes = _agentValidations[agentId];
        uint256 sum;
        bytes32 tagHash = keccak256(bytes(tag));
        for (uint256 i; i < hashes.length; i++) {
            Validation storage v = _validations[hashes[i]];
            if (!v.hasResponse) continue;
            if (bytes(tag).length != 0 && keccak256(bytes(v.tag)) != tagHash) continue;
            if (validatorAddresses.length != 0 && !_contains(validatorAddresses, v.validatorAddress)) continue;
            count++;
            sum += v.response;
        }
        averageResponse = count == 0 ? 0 : uint8(sum / count);
    }

    function getAgentValidations(uint256 agentId) external view returns (bytes32[] memory) {
        return _agentValidations[agentId];
    }

    function getValidatorRequests(address validatorAddress) external view returns (bytes32[] memory) {
        return _validatorRequests[validatorAddress];
    }

    function _contains(address[] calldata list, address a) private pure returns (bool) {
        for (uint256 i; i < list.length; i++) if (list[i] == a) return true;
        return false;
    }
}
