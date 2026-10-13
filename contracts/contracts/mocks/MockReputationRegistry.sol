// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {IERC8004Reputation} from "../interfaces/IERC8004Reputation.sol";

/// @notice Local stand-in for the ERC-8004 Reputation Registry (same
///         giveFeedback signature and self-feedback rule as the reference
///         implementation deployed on Monad testnet).
contract MockReputationRegistry is IERC8004Reputation {
    struct Feedback {
        address client;
        int128 value;
        uint8 valueDecimals;
        string tag1;
        string tag2;
        bytes32 feedbackHash;
    }

    IERC721 public immutable identityRegistry;
    mapping(uint256 agentId => Feedback[]) public feedback;

    event NewFeedback(
        uint256 indexed agentId,
        address indexed clientAddress,
        uint64 feedbackIndex,
        int128 value,
        uint8 valueDecimals,
        string indexed indexedTag1,
        string tag1,
        string tag2,
        string endpoint,
        string feedbackURI,
        bytes32 feedbackHash
    );

    constructor(IERC721 identityRegistry_) {
        identityRegistry = identityRegistry_;
    }

    function giveFeedback(
        uint256 agentId,
        int128 value,
        uint8 valueDecimals,
        string calldata tag1,
        string calldata tag2,
        string calldata endpoint,
        string calldata feedbackURI,
        bytes32 feedbackHash
    ) external {
        require(valueDecimals <= 18, "too many decimals");
        address owner = identityRegistry.ownerOf(agentId);
        require(
            msg.sender != owner && !identityRegistry.isApprovedForAll(owner, msg.sender)
                && identityRegistry.getApproved(agentId) != msg.sender,
            "Self-feedback not allowed"
        );
        feedback[agentId].push(Feedback(msg.sender, value, valueDecimals, tag1, tag2, feedbackHash));
        emit NewFeedback(
            agentId, msg.sender, uint64(feedback[agentId].length), value, valueDecimals, tag1, tag1, tag2, endpoint, feedbackURI, feedbackHash
        );
    }

    function feedbackCount(uint256 agentId) external view returns (uint256) {
        return feedback[agentId].length;
    }

    function getSummary(uint256 agentId, address[] calldata clientAddresses, string calldata tag1, string calldata tag2)
        external
        view
        returns (uint64 count, int128 summaryValue, uint8 summaryValueDecimals)
    {
        Feedback[] storage list = feedback[agentId];
        int256 sum;
        for (uint256 i; i < list.length; i++) {
            Feedback storage f = list[i];
            if (bytes(tag1).length != 0 && keccak256(bytes(f.tag1)) != keccak256(bytes(tag1))) continue;
            if (bytes(tag2).length != 0 && keccak256(bytes(f.tag2)) != keccak256(bytes(tag2))) continue;
            if (clientAddresses.length != 0) {
                bool hit;
                for (uint256 k; k < clientAddresses.length; k++) if (clientAddresses[k] == f.client) hit = true;
                if (!hit) continue;
            }
            count++;
            sum += f.value;
        }
        summaryValue = count == 0 ? int128(0) : int128(sum / int256(uint256(count)));
        summaryValueDecimals = 0;
    }
}
