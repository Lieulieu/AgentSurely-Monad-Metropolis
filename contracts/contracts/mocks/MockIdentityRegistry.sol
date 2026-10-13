// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";

/// @notice Local stand-in for an ERC-8004 Identity Registry.
/// register(agentURI) mints a new agent NFT to the caller.
contract MockIdentityRegistry is ERC721 {
    uint256 public nextAgentId = 1;
    mapping(uint256 => string) private _uris;

    event Registered(uint256 indexed agentId, string agentURI, address indexed owner);

    constructor() ERC721("ERC-8004 Agent (mock)", "AGENT") {}

    function register(string calldata agentURI) external returns (uint256 agentId) {
        agentId = nextAgentId++;
        _uris[agentId] = agentURI;
        _safeMint(msg.sender, agentId);
        emit Registered(agentId, agentURI, msg.sender);
    }

    function tokenURI(uint256 agentId) public view override returns (string memory) {
        _requireOwned(agentId);
        return _uris[agentId];
    }

    function totalAgents() external view returns (uint256) {
        return nextAgentId - 1;
    }
}
