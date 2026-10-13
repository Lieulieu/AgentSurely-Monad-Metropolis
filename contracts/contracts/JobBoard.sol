// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @notice What JobBoard reads from the SubscriptionManager.
interface ISubscriptionPlans {
    function activePlan(address user) external view returns (uint8);
    function unlimited(address account) external view returns (bool);
    function canHire(address client, uint256 agentId) external view returns (bool);
}

/// @title JobBoard — AgentSurely jobs (upgrade-08)
/// @notice A job is a project in a domain (finance, education, agriculture, …) with a brief and a team of
///         rented agents. Each agent then runs bonded, CRE-verified tasks in SurelyVault for that job.
///
///         Plan limits (open jobs · agents per job):  Free 1 · 3   PRO 5 · 5   VIP 30 · 30
///
/// @dev Standalone next to SurelyVault / SubscriptionManager (no redeploy). An agent can only be put on a job
///      by a wallet that may hire it (renting it, or its creator) — rentals stay in SubscriptionManager.
contract JobBoard is Ownable {
    uint256 public constant MAX_DOMAIN = 32;
    uint256 public constant MAX_TITLE = 120;
    uint256 public constant MAX_BRIEF = 2000;

    struct Limits {
        uint32 jobs;
        uint32 agentsPerJob;
    }

    struct Job {
        address owner;
        uint64 createdAt;
        uint64 updatedAt;
        bool open;
        string domain;
        string title;
        string brief;
        uint256[] agents;
    }

    ISubscriptionPlans public immutable subscriptions;
    /// @notice Limits per plan id (0 Free, 1 Pro, 2 Vip — same order as SubscriptionManager.Plan).
    mapping(uint8 => Limits) public limits;

    Job[] private _jobs;
    mapping(address => uint256[]) private _jobsOf;
    mapping(address => uint256) public openJobs;

    event JobCreated(uint256 indexed jobId, address indexed owner, string domain, string title);
    event JobUpdated(uint256 indexed jobId, string title);
    event JobOpenSet(uint256 indexed jobId, bool open);
    event AgentAdded(uint256 indexed jobId, uint256 indexed agentId);
    event AgentRemoved(uint256 indexed jobId, uint256 indexed agentId);
    event LimitsUpdated(uint8 indexed plan, uint32 jobs, uint32 agentsPerJob);

    error NotJobOwner();
    error BadJob();
    error EmptyField();
    error TooLong();
    error JobLimitReached(uint32 limit);
    error AgentLimitReached(uint32 limit);
    error CannotHireAgent(uint256 agentId);
    error AgentAlreadyOnJob(uint256 agentId);
    error AgentNotOnJob(uint256 agentId);
    error JobClosed();

    constructor(ISubscriptionPlans subscriptions_) Ownable(msg.sender) {
        subscriptions = subscriptions_;
        _setLimits(0, 1, 3); // Free
        _setLimits(1, 5, 5); // PRO
        _setLimits(2, 30, 30); // VIP
    }

    // ───────────────────────────── Jobs ─────────────────────────────

    /// @notice Creates a job and puts rented agents on it in one call.
    function createJob(string calldata domain, string calldata title, string calldata brief, uint256[] calldata agentIds)
        external
        returns (uint256 jobId)
    {
        _checkText(domain, title, brief);
        Limits memory l = limitsOf(msg.sender);
        if (openJobs[msg.sender] >= l.jobs) revert JobLimitReached(l.jobs);
        jobId = _jobs.length;
        Job storage j = _jobs.push();
        j.owner = msg.sender;
        j.createdAt = uint64(block.timestamp);
        j.updatedAt = uint64(block.timestamp);
        j.open = true;
        j.domain = domain;
        j.title = title;
        j.brief = brief;
        _jobsOf[msg.sender].push(jobId);
        openJobs[msg.sender] += 1;
        emit JobCreated(jobId, msg.sender, domain, title);
        for (uint256 i; i < agentIds.length; i++) _addAgent(jobId, j, agentIds[i], l.agentsPerJob);
    }

    function updateJob(uint256 jobId, string calldata domain, string calldata title, string calldata brief) external {
        Job storage j = _own(jobId);
        _checkText(domain, title, brief);
        j.domain = domain;
        j.title = title;
        j.brief = brief;
        j.updatedAt = uint64(block.timestamp);
        emit JobUpdated(jobId, title);
    }

    function addAgents(uint256 jobId, uint256[] calldata agentIds) external {
        Job storage j = _own(jobId);
        if (!j.open) revert JobClosed();
        uint32 max = limitsOf(msg.sender).agentsPerJob;
        for (uint256 i; i < agentIds.length; i++) _addAgent(jobId, j, agentIds[i], max);
        j.updatedAt = uint64(block.timestamp);
    }

    function removeAgent(uint256 jobId, uint256 agentId) external {
        Job storage j = _own(jobId);
        uint256 n = j.agents.length;
        for (uint256 i; i < n; i++) {
            if (j.agents[i] == agentId) {
                j.agents[i] = j.agents[n - 1];
                j.agents.pop();
                j.updatedAt = uint64(block.timestamp);
                emit AgentRemoved(jobId, agentId);
                return;
            }
        }
        revert AgentNotOnJob(agentId);
    }

    /// @notice Closing a job frees a slot of your plan; reopening needs a free slot again.
    function setOpen(uint256 jobId, bool open) external {
        Job storage j = _own(jobId);
        if (j.open == open) return;
        if (open) {
            uint32 max = limitsOf(msg.sender).jobs;
            if (openJobs[msg.sender] >= max) revert JobLimitReached(max);
            openJobs[msg.sender] += 1;
        } else {
            openJobs[msg.sender] -= 1;
        }
        j.open = open;
        j.updatedAt = uint64(block.timestamp);
        emit JobOpenSet(jobId, open);
    }

    // ───────────────────────────── Views ─────────────────────────────

    /// @notice Limits for a wallet: its active plan's, or unlimited for platform wallets.
    function limitsOf(address user) public view returns (Limits memory) {
        if (subscriptions.unlimited(user)) return Limits(type(uint32).max, type(uint32).max);
        return limits[subscriptions.activePlan(user)];
    }

    function getJob(uint256 jobId) external view returns (Job memory) {
        if (jobId >= _jobs.length) revert BadJob();
        return _jobs[jobId];
    }

    function jobsOf(address owner_) external view returns (uint256[] memory) {
        return _jobsOf[owner_];
    }

    function jobCount() external view returns (uint256) {
        return _jobs.length;
    }

    // ───────────────────────────── Admin ─────────────────────────────

    function setLimits(uint8 plan, uint32 jobs, uint32 agentsPerJob) external onlyOwner {
        _setLimits(plan, jobs, agentsPerJob);
    }

    // ───────────────────────────── Internal ─────────────────────────────

    function _setLimits(uint8 plan, uint32 jobs, uint32 agentsPerJob) private {
        limits[plan] = Limits(jobs, agentsPerJob);
        emit LimitsUpdated(plan, jobs, agentsPerJob);
    }

    function _own(uint256 jobId) private view returns (Job storage j) {
        if (jobId >= _jobs.length) revert BadJob();
        j = _jobs[jobId];
        if (j.owner != msg.sender) revert NotJobOwner();
    }

    function _addAgent(uint256 jobId, Job storage j, uint256 agentId, uint32 max) private {
        if (j.agents.length >= max) revert AgentLimitReached(max);
        if (!subscriptions.canHire(msg.sender, agentId)) revert CannotHireAgent(agentId);
        for (uint256 i; i < j.agents.length; i++) if (j.agents[i] == agentId) revert AgentAlreadyOnJob(agentId);
        j.agents.push(agentId);
        emit AgentAdded(jobId, agentId);
    }

    function _checkText(string calldata domain, string calldata title, string calldata brief) private pure {
        if (bytes(domain).length == 0 || bytes(title).length == 0) revert EmptyField();
        if (bytes(domain).length > MAX_DOMAIN || bytes(title).length > MAX_TITLE || bytes(brief).length > MAX_BRIEF) revert TooLong();
    }
}
