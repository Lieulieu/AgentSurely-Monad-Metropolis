// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";

import {IReceiver} from "./interfaces/IReceiver.sol";
import {IERC8004Identity} from "./interfaces/IERC8004Identity.sol";
import {IERC8004Reputation} from "./interfaces/IERC8004Reputation.sol";
import {IERC8004Validation} from "./interfaces/IERC8004Validation.sol";
import {IHireGate} from "./interfaces/IHireGate.sol";

/// @title  SurelyVault — performance bonds for ERC-8004 AI agents
/// @notice Agents post a bond. Clients hire an agent for a job and pay a fee
///         into escrow; part of the agent's bond is locked as coverage.
///         A Chainlink CRE workflow verifies the agent's output (LLM judge +
///         deterministic checks) and delivers a signed report through the
///         KeystoneForwarder. Pass → agent is paid. Fail → coverage is slashed
///         to the client and the fee is refunded.
///         Money (bonds, fees, coverage) is USDC. mUSD is only a reward: every
///         passed job pays the agent's owner `rewardPerPass` mUSD from the
///         vault's reward pool (upgrade-04).
///         Every verdict is also published to ERC-8004: as feedback in the
///         Reputation Registry (tag1 "agentsurely") and, when the agent
///         opened a validation request naming this vault, as a response in
///         the Validation Registry.
contract SurelyVault is IReceiver, Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ─────────────────────────────── Types ───────────────────────────────

    enum Status {
        None,
        Open, //       hired, waiting for the agent's output
        Submitted, //  output delivered, waiting for CRE verdict
        Passed, //     verified — fee released to agent
        Failed, //     verification failed — coverage slashed to client
        Expired, //    agent missed the deadline — coverage slashed to client
        Refunded //    verifier never answered — fee refunded, no slash
    }

    struct Bond {
        uint256 total; //          bond deposited and not yet withdrawn/slashed
        uint256 locked; //         reserved as coverage for open jobs
        uint256 pendingWithdraw; // queued for withdrawal (still slashable)
        uint64 unlockAt; //        when pendingWithdraw can be claimed
    }

    struct Stats {
        uint32 passed;
        uint32 failed;
        uint32 expired;
        uint256 earned;
        uint256 slashed;
    }

    struct Job {
        uint256 agentId;
        address client;
        uint256 fee;
        uint256 coverage;
        uint64 createdAt;
        uint64 deadline;
        uint64 submittedAt;
        uint8 minScore; // 0-100 threshold to pass
        uint8 score; //    0-100 verdict from the verifier
        Status status;
        bytes32 specHash;
        bytes32 outputHash;
        bytes32 reportHash; // hash of the full off-chain verification report
    }

    // ────────────────────────────── Storage ──────────────────────────────

    uint256 public constant MAX_TEXT = 4096;
    string public constant TAG = "agentsurely";

    /// @notice Bonds, fees and coverage — USDC (Circle testnet USDC on Monad).
    IERC20 public immutable bondToken;
    /// @notice Reward token (mUSD). Paid from this contract's own balance; never taken from users.
    IERC20 public rewardToken;
    /// @notice mUSD paid to the agent owner for every passed job (0 = rewards off).
    uint256 public rewardPerPass;
    mapping(uint256 agentId => uint256) public rewardsEarned;
    IERC8004Identity public immutable identity;

    /// @notice CRE KeystoneForwarder (or a relayer EOA for local dev).
    address public forwarder;
    uint64 public withdrawDelay = 1 days;
    uint64 public verifyWindow = 1 hours;

    mapping(uint256 agentId => Bond) public bonds;
    mapping(uint256 agentId => Stats) public stats;

    Job[] internal _jobs;
    mapping(uint256 jobId => string) public jobSpec;
    mapping(uint256 jobId => string) public jobOutput;
    mapping(uint256 jobId => string) public verdictReason;

    /// @notice Optional ERC-8004 registries verdicts are published to (0 = off).
    IERC8004Reputation public reputationRegistry;
    IERC8004Validation public validationRegistry;

    /// @notice Optional hire check (subscription rosters for catalog agents). 0 = everyone may hire.
    IHireGate public hireGate;

    /// @dev Agents that have ever posted a bond — lets clients list bonded
    ///      agents without scanning a shared (canonical) identity registry.
    uint256[] internal _bondedAgents;
    mapping(uint256 agentId => bool) public isBonded;

    /// @dev Jobs in Submitted state, for the CRE cron fallback (swap-and-pop set).
    uint256[] internal _pending;
    mapping(uint256 jobId => uint256) internal _pendingPos; // index + 1

    // ─────────────────────────────── Events ──────────────────────────────

    event ForwarderUpdated(address forwarder);
    event BondDeposited(uint256 indexed agentId, address indexed from, uint256 amount);
    event WithdrawRequested(uint256 indexed agentId, uint256 amount, uint64 unlockAt);
    event BondWithdrawn(uint256 indexed agentId, address indexed to, uint256 amount);
    event JobCreated(
        uint256 indexed jobId, uint256 indexed agentId, address indexed client, uint256 fee, uint256 coverage, uint64 deadline
    );
    event ResultSubmitted(uint256 indexed jobId, uint256 indexed agentId, bytes32 outputHash);
    event JobVerified(uint256 indexed jobId, uint256 indexed agentId, bool passed, uint8 score, bytes32 reportHash);
    event BondSlashed(uint256 indexed agentId, uint256 indexed jobId, address indexed client, uint256 amount);
    event JobExpired(uint256 indexed jobId, uint256 indexed agentId);
    event JobRefunded(uint256 indexed jobId);
    event HireGateUpdated(address hireGate);
    event RegistriesUpdated(address reputationRegistry, address validationRegistry);
    /// @dev kind: 1 = reputation feedback, 2 = validation response. Settlement is never blocked.
    event RegistryPublishFailed(uint256 indexed jobId, uint8 kind);
    event RewardConfigUpdated(address rewardToken, uint256 rewardPerPass);
    event RewardPaid(uint256 indexed jobId, uint256 indexed agentId, address indexed to, uint256 amount);
    /// @dev Reward pool ran dry — settlement still happens, only the bonus is skipped.
    event RewardSkipped(uint256 indexed jobId, uint256 poolBalance);

    // ─────────────────────────────── Errors ──────────────────────────────

    error NotAgentOwner();
    error NotForwarder();
    error InsufficientBond(uint256 available, uint256 required);
    error BadStatus(Status current);
    error DeadlinePassed();
    error TooEarly();
    error InvalidParams();
    error TextTooLong();
    error HireNotAllowed(address client, uint256 agentId);

    constructor(IERC20 bondToken_, IERC8004Identity identity_, address forwarder_) Ownable(msg.sender) {
        bondToken = bondToken_;
        identity = identity_;
        forwarder = forwarder_;
        emit ForwarderUpdated(forwarder_);
    }

    modifier onlyAgentOwner(uint256 agentId) {
        if (identity.ownerOf(agentId) != msg.sender) revert NotAgentOwner();
        _;
    }

    // ─────────────────────────────── Admin ───────────────────────────────

    function setForwarder(address forwarder_) external onlyOwner {
        forwarder = forwarder_;
        emit ForwarderUpdated(forwarder_);
    }

    function setRegistries(IERC8004Reputation reputation_, IERC8004Validation validation_) external onlyOwner {
        reputationRegistry = reputation_;
        validationRegistry = validation_;
        emit RegistriesUpdated(address(reputation_), address(validation_));
    }

    function setHireGate(IHireGate gate) external onlyOwner {
        hireGate = gate;
        emit HireGateUpdated(address(gate));
    }

    /// @notice Configure the mUSD reward (fund it by sending mUSD to this contract). 0 / address(0) = off.
    function setReward(IERC20 rewardToken_, uint256 rewardPerPass_) external onlyOwner {
        if (address(rewardToken_) == address(bondToken)) revert InvalidParams(); // rewards never touch escrow
        rewardToken = rewardToken_;
        rewardPerPass = rewardPerPass_;
        emit RewardConfigUpdated(address(rewardToken_), rewardPerPass_);
    }

    /// @notice mUSD left in the reward pool.
    function rewardPool() public view returns (uint256) {
        return address(rewardToken) == address(0) ? 0 : rewardToken.balanceOf(address(this));
    }

    function setWindows(uint64 withdrawDelay_, uint64 verifyWindow_) external onlyOwner {
        withdrawDelay = withdrawDelay_;
        verifyWindow = verifyWindow_;
    }

    // ─────────────────────────────── Bonds ───────────────────────────────

    /// @notice Bond that can back new jobs right now.
    function availableBond(uint256 agentId) public view returns (uint256) {
        Bond storage b = bonds[agentId];
        return b.total - b.locked - b.pendingWithdraw;
    }

    function depositBond(uint256 agentId, uint256 amount) external nonReentrant onlyAgentOwner(agentId) {
        if (amount == 0) revert InvalidParams();
        bondToken.safeTransferFrom(msg.sender, address(this), amount);
        bonds[agentId].total += amount;
        if (!isBonded[agentId]) {
            isBonded[agentId] = true;
            _bondedAgents.push(agentId);
        }
        emit BondDeposited(agentId, msg.sender, amount);
    }

    /// @notice Queue a withdrawal. The amount stays slashable until claimed,
    ///         so an agent cannot front-run a pending slash.
    function requestWithdraw(uint256 agentId, uint256 amount) external onlyAgentOwner(agentId) {
        uint256 avail = availableBond(agentId);
        if (amount == 0 || amount > avail) revert InsufficientBond(avail, amount);
        Bond storage b = bonds[agentId];
        b.pendingWithdraw += amount;
        b.unlockAt = uint64(block.timestamp) + withdrawDelay;
        emit WithdrawRequested(agentId, amount, b.unlockAt);
    }

    function withdraw(uint256 agentId) external nonReentrant onlyAgentOwner(agentId) {
        Bond storage b = bonds[agentId];
        if (block.timestamp < b.unlockAt) revert TooEarly();
        uint256 amount = b.pendingWithdraw;
        if (amount == 0) revert InvalidParams();
        b.pendingWithdraw = 0;
        b.total -= amount;
        bondToken.safeTransfer(msg.sender, amount);
        emit BondWithdrawn(agentId, msg.sender, amount);
    }

    // ──────────────────────────────── Jobs ───────────────────────────────

    function createJob(
        uint256 agentId,
        string calldata spec,
        uint256 fee,
        uint256 coverage,
        uint64 deadline,
        uint8 minScore
    ) external nonReentrant returns (uint256 jobId) {
        if (bytes(spec).length == 0 || bytes(spec).length > MAX_TEXT) revert TextTooLong();
        if (deadline <= block.timestamp || minScore > 100 || coverage == 0) revert InvalidParams();
        identity.ownerOf(agentId); // reverts if the agent does not exist
        if (address(hireGate) != address(0) && !hireGate.canHire(msg.sender, agentId)) {
            revert HireNotAllowed(msg.sender, agentId);
        }

        uint256 avail = availableBond(agentId);
        if (avail < coverage) revert InsufficientBond(avail, coverage);
        bonds[agentId].locked += coverage;

        if (fee > 0) bondToken.safeTransferFrom(msg.sender, address(this), fee);

        jobId = _jobs.length;
        _jobs.push(
            Job({
                agentId: agentId,
                client: msg.sender,
                fee: fee,
                coverage: coverage,
                createdAt: uint64(block.timestamp),
                deadline: deadline,
                submittedAt: 0,
                minScore: minScore,
                score: 0,
                status: Status.Open,
                specHash: keccak256(bytes(spec)),
                outputHash: bytes32(0),
                reportHash: bytes32(0)
            })
        );
        jobSpec[jobId] = spec;
        emit JobCreated(jobId, agentId, msg.sender, fee, coverage, deadline);
    }

    /// @notice Agent delivers its output. Emits the event the CRE workflow listens to.
    function submitResult(uint256 jobId, string calldata output) external {
        Job storage j = _jobs[jobId];
        if (identity.ownerOf(j.agentId) != msg.sender) revert NotAgentOwner();
        if (j.status != Status.Open) revert BadStatus(j.status);
        if (block.timestamp > j.deadline) revert DeadlinePassed();
        if (bytes(output).length == 0 || bytes(output).length > MAX_TEXT) revert TextTooLong();

        j.status = Status.Submitted;
        j.submittedAt = uint64(block.timestamp);
        j.outputHash = keccak256(bytes(output));
        jobOutput[jobId] = output;
        _pending.push(jobId);
        _pendingPos[jobId] = _pending.length;
        emit ResultSubmitted(jobId, j.agentId, j.outputHash);
    }

    /// @notice Agent missed the deadline → anyone can trigger the slash.
    function claimExpired(uint256 jobId) external nonReentrant {
        Job storage j = _jobs[jobId];
        if (j.status != Status.Open) revert BadStatus(j.status);
        if (block.timestamp <= j.deadline) revert TooEarly();
        j.status = Status.Expired;
        stats[j.agentId].expired++;
        _slash(jobId, j);
        emit JobExpired(jobId, j.agentId);
        _publish(jobId, j, "expired");
    }

    /// @notice Verifier never answered → refund the client, release coverage, no slash.
    function refundUnverified(uint256 jobId) external nonReentrant {
        Job storage j = _jobs[jobId];
        if (j.status != Status.Submitted) revert BadStatus(j.status);
        if (block.timestamp <= j.submittedAt + verifyWindow) revert TooEarly();
        j.status = Status.Refunded;
        _removePending(jobId);
        bonds[j.agentId].locked -= j.coverage;
        if (j.fee > 0) bondToken.safeTransfer(j.client, j.fee);
        emit JobRefunded(jobId);
    }

    // ─────────────────────────── CRE receiver ────────────────────────────

    /// @notice Called by the KeystoneForwarder with a DON-signed report.
    /// @dev report = abi.encode(uint256 jobId, uint8 score, bytes32 reportHash, string reason)
    function onReport(bytes calldata, /* metadata */ bytes calldata report) external override nonReentrant {
        if (msg.sender != forwarder) revert NotForwarder();
        (uint256 jobId, uint8 score, bytes32 reportHash, string memory reason) =
            abi.decode(report, (uint256, uint8, bytes32, string));
        _resolve(jobId, score, reportHash, reason);
    }

    function supportsInterface(bytes4 interfaceId) public pure override returns (bool) {
        return interfaceId == type(IReceiver).interfaceId || interfaceId == type(IERC165).interfaceId;
    }

    function _resolve(uint256 jobId, uint8 score, bytes32 reportHash, string memory reason) internal {
        Job storage j = _jobs[jobId];
        if (j.status != Status.Submitted) revert BadStatus(j.status);
        if (score > 100) revert InvalidParams();

        j.score = score;
        j.reportHash = reportHash;
        verdictReason[jobId] = reason;
        _removePending(jobId);
        bool passed = score >= j.minScore;

        if (passed) {
            j.status = Status.Passed;
            bonds[j.agentId].locked -= j.coverage;
            Stats storage s = stats[j.agentId];
            s.passed++;
            s.earned += j.fee;
            address agentOwner = identity.ownerOf(j.agentId);
            if (j.fee > 0) bondToken.safeTransfer(agentOwner, j.fee);
            _reward(jobId, j.agentId, agentOwner);
        } else {
            j.status = Status.Failed;
            stats[j.agentId].failed++;
            _slash(jobId, j);
        }
        emit JobVerified(jobId, j.agentId, passed, score, reportHash);
        _publish(jobId, j, passed ? "pass" : "fail");
    }

    function _removePending(uint256 jobId) internal {
        uint256 pos = _pendingPos[jobId];
        if (pos == 0) return;
        uint256 last = _pending[_pending.length - 1];
        _pending[pos - 1] = last;
        _pendingPos[last] = pos;
        _pending.pop();
        delete _pendingPos[jobId];
    }

    /// @dev Best-effort ERC-8004 publishing. Funds have already moved; a
    ///      registry failure only emits RegistryPublishFailed.
    function _publish(uint256 jobId, Job storage j, string memory outcome) internal {
        if (address(reputationRegistry) != address(0)) {
            try reputationRegistry.giveFeedback(
                j.agentId, int128(uint128(j.score)), 0, TAG, outcome, "", "", j.reportHash
            ) {} catch {
                emit RegistryPublishFailed(jobId, 1);
            }
        }
        bytes32 requestHash = validationRequestHash(jobId);
        if (address(validationRegistry) != address(0) && requestHash != bytes32(0)) {
            try validationRegistry.validationResponse(requestHash, j.score, "", j.reportHash, TAG) {} catch {
                emit RegistryPublishFailed(jobId, 2);
            }
        }
    }

    /// @dev Best-effort mUSD bonus for a passed job.
    function _reward(uint256 jobId, uint256 agentId, address to) internal {
        uint256 amount = rewardPerPass;
        if (amount == 0 || address(rewardToken) == address(0)) return;
        uint256 pool = rewardToken.balanceOf(address(this));
        if (pool < amount) {
            emit RewardSkipped(jobId, pool);
            return;
        }
        rewardsEarned[agentId] += amount;
        rewardToken.safeTransfer(to, amount);
        emit RewardPaid(jobId, agentId, to, amount);
    }

    /// @dev Coverage goes to the client together with a full fee refund.
    function _slash(uint256 jobId, Job storage j) internal {
        Bond storage b = bonds[j.agentId];
        b.locked -= j.coverage;
        b.total -= j.coverage;
        // If a queued withdrawal no longer fits, shrink it.
        uint256 free = b.total - b.locked;
        if (b.pendingWithdraw > free) b.pendingWithdraw = free;
        stats[j.agentId].slashed += j.coverage;
        bondToken.safeTransfer(j.client, j.coverage + j.fee);
        emit BondSlashed(j.agentId, jobId, j.client, j.coverage);
    }

    // ──────────────────────────────── Views ──────────────────────────────

    function jobCount() external view returns (uint256) {
        return _jobs.length;
    }

    function getJob(uint256 jobId) external view returns (Job memory) {
        return _jobs[jobId];
    }

    /// @notice Everything the CRE workflow needs in a single call.
    function getJobForVerification(uint256 jobId)
        external
        view
        returns (Job memory job, string memory spec, string memory output)
    {
        return (_jobs[jobId], jobSpec[jobId], jobOutput[jobId]);
    }

    /// @notice The ERC-8004 validation requestHash an agent should register
    ///         (validationRequest(address(this), agentId, uri, hash)) to get
    ///         this job's verdict recorded in the Validation Registry.
    ///         Depends on the output, so agents compute it before submitting.
    function validationRequestHash(uint256 jobId) public view returns (bytes32) {
        bytes32 outputHash = _jobs[jobId].outputHash;
        return outputHash == bytes32(0) ? bytes32(0) : computeRequestHash(jobId, outputHash);
    }

    function computeRequestHash(uint256 jobId, bytes32 outputHash) public view returns (bytes32) {
        return keccak256(abi.encode(block.chainid, address(this), jobId, outputHash));
    }

    /// @notice Up to `max` jobs awaiting a verdict — polled by the CRE cron trigger.
    function pendingJobs(uint256 max) external view returns (uint256[] memory ids) {
        uint256 n = _pending.length < max ? _pending.length : max;
        ids = new uint256[](n);
        for (uint256 i; i < n; i++) ids[i] = _pending[i];
    }

    function pendingCount() external view returns (uint256) {
        return _pending.length;
    }

    function bondedAgents() external view returns (uint256[] memory) {
        return _bondedAgents;
    }

    /// @notice Pass rate in basis points (10000 = 100%). New agents return 0.
    function reputationBps(uint256 agentId) external view returns (uint256) {
        Stats storage s = stats[agentId];
        uint256 total = uint256(s.passed) + s.failed + s.expired;
        return total == 0 ? 0 : (uint256(s.passed) * 10_000) / total;
    }
}
