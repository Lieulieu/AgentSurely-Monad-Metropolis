// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC8004Identity} from "./interfaces/IERC8004Identity.sol";
import {IHireGate} from "./interfaces/IHireGate.sol";

/// @title PlaybookRegistry — AgentSurely playbook market (upgrade-07)
/// @notice Agent creators publish ready-to-run tasks ("playbooks") for their own ERC-8004 agents, so renters
///         know exactly what to do after paying the 1 USDC rent. Renters vote playbooks "useful"; the market
///         ranks creators' playbooks by those votes.
/// @dev Standalone: does not touch SurelyVault or SubscriptionManager (deployed next to them, no redeploy).
///      Control follows the ERC-721 owner of the agent in the identity registry. Votes are limited to wallets
///      the hire gate lets hire the agent (its renters), one vote per wallet per playbook, never the owner.
contract PlaybookRegistry {
    uint256 public constant MAX_ACTIVE = 10;
    uint256 public constant MAX_TITLE = 80;
    uint256 public constant MAX_OUTCOME = 200;
    uint256 public constant MAX_TEMPLATE = 2000;

    struct Playbook {
        address author;
        uint64 updatedAt;
        bool active;
        uint32 useful;
        string title;
        string outcome;
        string template;
    }

    IERC8004Identity public immutable identity;
    /// @notice SubscriptionManager (renters). Zero address = any non-owner wallet may vote.
    IHireGate public immutable hireGate;

    mapping(uint256 => Playbook[]) private _books;
    mapping(uint256 => uint256) public activeCount;
    mapping(uint256 => mapping(uint256 => mapping(address => bool))) public votedUseful;
    uint256[] private _agents;
    mapping(uint256 => bool) private _known;

    event PlaybookPublished(uint256 indexed agentId, uint256 indexed index, address indexed author, string title);
    event PlaybookEdited(uint256 indexed agentId, uint256 indexed index, string title);
    event PlaybookActiveSet(uint256 indexed agentId, uint256 indexed index, bool active);
    event PlaybookMarkedUseful(uint256 indexed agentId, uint256 indexed index, address indexed voter, uint32 useful);

    error NotAgentOwner();
    error BadIndex();
    error EmptyField();
    error TooLong();
    error TooManyActive();
    error NotRenter();
    error AlreadyVoted();
    error Inactive();

    constructor(IERC8004Identity identity_, IHireGate hireGate_) {
        identity = identity_;
        hireGate = hireGate_;
    }

    modifier onlyAgentOwner(uint256 agentId) {
        if (identity.ownerOf(agentId) != msg.sender) revert NotAgentOwner();
        _;
    }

    // ───────────────────────────── Creators ─────────────────────────────

    function publish(uint256 agentId, string calldata title, string calldata outcome, string calldata template)
        external
        onlyAgentOwner(agentId)
        returns (uint256 index)
    {
        _check(title, outcome, template);
        if (activeCount[agentId] >= MAX_ACTIVE) revert TooManyActive();
        index = _books[agentId].length;
        _books[agentId].push(Playbook(msg.sender, uint64(block.timestamp), true, 0, title, outcome, template));
        activeCount[agentId] += 1;
        if (!_known[agentId]) {
            _known[agentId] = true;
            _agents.push(agentId);
        }
        emit PlaybookPublished(agentId, index, msg.sender, title);
    }

    /// @notice Edits text; keeps the useful votes (fix typos, refresh details).
    function edit(uint256 agentId, uint256 index, string calldata title, string calldata outcome, string calldata template)
        external
        onlyAgentOwner(agentId)
    {
        _check(title, outcome, template);
        Playbook storage p = _at(agentId, index);
        p.title = title;
        p.outcome = outcome;
        p.template = template;
        p.updatedAt = uint64(block.timestamp);
        emit PlaybookEdited(agentId, index, title);
    }

    function setActive(uint256 agentId, uint256 index, bool active) external onlyAgentOwner(agentId) {
        Playbook storage p = _at(agentId, index);
        if (p.active == active) return;
        if (active) {
            if (activeCount[agentId] >= MAX_ACTIVE) revert TooManyActive();
            activeCount[agentId] += 1;
        } else {
            activeCount[agentId] -= 1;
        }
        p.active = active;
        p.updatedAt = uint64(block.timestamp);
        emit PlaybookActiveSet(agentId, index, active);
    }

    // ───────────────────────────── Renters ─────────────────────────────

    function markUseful(uint256 agentId, uint256 index) external {
        Playbook storage p = _at(agentId, index);
        if (!p.active) revert Inactive();
        if (!canVote(msg.sender, agentId)) revert NotRenter();
        if (votedUseful[agentId][index][msg.sender]) revert AlreadyVoted();
        votedUseful[agentId][index][msg.sender] = true;
        p.useful += 1;
        emit PlaybookMarkedUseful(agentId, index, msg.sender, p.useful);
    }

    function canVote(address voter, uint256 agentId) public view returns (bool) {
        if (identity.ownerOf(agentId) == voter) return false;
        return address(hireGate) == address(0) || hireGate.canHire(voter, agentId);
    }

    // ───────────────────────────── Views ─────────────────────────────

    function playbooksOf(uint256 agentId) external view returns (Playbook[] memory) {
        return _books[agentId];
    }

    function playbookCount(uint256 agentId) external view returns (uint256) {
        return _books[agentId].length;
    }

    /// @notice Every agent that ever had a playbook (for the market page).
    function agentsWithPlaybooks() external view returns (uint256[] memory) {
        return _agents;
    }

    // ───────────────────────────── Internal ─────────────────────────────

    function _at(uint256 agentId, uint256 index) private view returns (Playbook storage) {
        if (index >= _books[agentId].length) revert BadIndex();
        return _books[agentId][index];
    }

    function _check(string calldata title, string calldata outcome, string calldata template) private pure {
        if (bytes(title).length == 0 || bytes(template).length == 0) revert EmptyField();
        if (bytes(title).length > MAX_TITLE || bytes(outcome).length > MAX_OUTCOME || bytes(template).length > MAX_TEMPLATE) {
            revert TooLong();
        }
    }
}
