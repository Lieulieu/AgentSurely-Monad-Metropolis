// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IHireGate} from "./interfaces/IHireGate.sol";
import {IERC8004Identity} from "./interfaces/IERC8004Identity.sol";

/// @title  SubscriptionManager — AgentSurely plans, agent listings and rentals (upgrade-02)
/// @notice The account is the wallet address. Plans (30-day periods) are paid in USDC (the vault's bond token,
///         upgrade-04) or any other accepted $1 stablecoin with the same decimals:
///
///           plan │ price │ create │ list for rent │ rent (max)
///           ─────┼───────┼────────┼───────────────┼───────────
///           Free │   $0  │    3   │       0       │      3
///           Pro  │   $5  │    5   │       5       │     50
///           VIP  │  $30  │   30   │      30       │    300
///
///         • Create  = register an ERC-8004 agent you own with AgentSurely (`registerAgent`).
///                     Free agents are for testing: only their creator can hire them.
///         • List    = put a created agent up for rent (`setListed`). Needs Pro or VIP.
///         • Rent    = `rent(agentId, periods)`: $1 per agent per 30 days. 90% goes to the agent's
///                     creator, 10% (platformFeeBps) to the AgentSurely treasury.
///         A client can hire (SurelyVault.createJob) an agent only if they created it or hold an
///         active rental for it. Paid rentals stay valid until they expire, even after a plan lapses.
contract SubscriptionManager is IHireGate, Ownable {
    using SafeERC20 for IERC20;

    enum Plan {
        Free,
        Pro,
        Vip
    }

    struct PlanInfo {
        uint256 price; //       per 30-day period, in token units
        uint32 createLimit; //  agents a wallet may register
        uint32 listLimit; //    agents a wallet may list for rent
        uint32 rentLimit; //    active rentals a wallet may hold
    }

    uint64 public constant PERIOD = 30 days;
    uint8 public constant MAX_PERIODS = 12;
    uint16 public constant MAX_FEE_BPS = 3_000; // platform fee can never exceed 30%

    /// @notice Default payment token: USDC (the vault's bond token). mUSD is only a reward, never a payment.
    IERC20 public immutable token;
    /// @notice Stablecoins accepted for plans and rentals (all priced 1:1 in USD, same decimals as `token`).
    mapping(address payToken => bool) public acceptedToken;
    IERC8004Identity public immutable identity;
    address public treasury;

    /// @notice Rent per agent per period (default 1 token = $1).
    uint256 public rentPrice;
    /// @notice Platform share of every rental, in basis points (default 1000 = 10%).
    uint16 public platformFeeBps;

    mapping(Plan => PlanInfo) public plans;
    mapping(address user => Plan) public planOf;
    mapping(address user => uint64) public expiresAt;

    /// @notice Platform operators (e.g. the catalog wallet) are not bound by create/list limits.
    mapping(address account => bool) public unlimited;

    // ── created agents ──
    mapping(uint256 agentId => address) public creatorOf;
    mapping(uint256 agentId => bool) public listed;
    mapping(address creator => uint32) public listedCount;
    mapping(address creator => uint256[]) internal _created;
    mapping(address creator => mapping(uint256 agentId => uint256)) internal _createdPos; // index + 1

    // ── rentals ──
    mapping(address renter => mapping(uint256 agentId => uint64)) public rentalExpiry;
    mapping(address renter => uint256[]) internal _rentals;
    mapping(address renter => mapping(uint256 agentId => uint256)) internal _rentalPos; // index + 1

    event Subscribed(address indexed user, Plan plan, uint8 periods, address payToken, uint256 paid, uint64 expiresAt);
    event AgentRegistered(address indexed creator, uint256 indexed agentId);
    event AgentUnregistered(address indexed creator, uint256 indexed agentId);
    event AgentListed(address indexed creator, uint256 indexed agentId, bool listed);
    event Rented(
        address indexed renter,
        uint256 indexed agentId,
        uint8 periods,
        address payToken,
        uint256 paid,
        uint256 platformFee,
        uint64 expiresAt
    );
    event AcceptedTokenUpdated(address payToken, bool accepted);
    event RentalCancelled(address indexed renter, uint256 indexed agentId);
    event PlanUpdated(Plan plan, uint256 price, uint32 createLimit, uint32 listLimit, uint32 rentLimit);
    event RentPriceUpdated(uint256 rentPrice, uint16 platformFeeBps);
    event TreasuryUpdated(address treasury);
    event UnlimitedUpdated(address account, bool unlimited);

    error InvalidPlan();
    error InvalidPeriods();
    error InvalidParams();
    error NotAgentOwner(uint256 agentId);
    error NotCreator(uint256 agentId);
    error AlreadyRegistered(uint256 agentId);
    error CreateLimitReached(uint32 limit);
    error ListLimitReached(uint32 limit);
    error RentLimitReached(uint32 limit);
    error NotForRent(uint256 agentId);
    error OwnAgent(uint256 agentId);
    error NotRented(uint256 agentId);
    error TokenNotAccepted(address payToken);

    /// @param unit one whole token (1e6 for a 6-decimal stablecoin) — sets $5 / $30 / $1 prices.
    constructor(IERC20 token_, IERC8004Identity identity_, address treasury_, uint256 unit) Ownable(msg.sender) {
        token = token_;
        acceptedToken[address(token_)] = true;
        identity = identity_;
        treasury = treasury_;
        plans[Plan.Free] = PlanInfo(0, 3, 0, 3);
        plans[Plan.Pro] = PlanInfo(5 * unit, 5, 5, 50);
        plans[Plan.Vip] = PlanInfo(30 * unit, 30, 30, 300);
        rentPrice = unit;
        platformFeeBps = 1_000;
        unlimited[msg.sender] = true;
        emit TreasuryUpdated(treasury_);
        emit RentPriceUpdated(unit, 1_000);
        emit UnlimitedUpdated(msg.sender, true);
    }

    // ───────────────────────────── Plans ─────────────────────────────

    /// @notice Buy `periods` × 30 days of Pro or VIP. Renewing the same plan extends it.
    ///         Switching plan while active converts the remaining time at the price ratio
    ///         (Pro → VIP keeps the value you already paid), then adds the new periods.
    function subscribe(Plan plan, uint8 periods) external {
        _subscribe(token, plan, periods);
    }

    /// @notice Same as `subscribe`, paid in another accepted stablecoin (e.g. USDC).
    function subscribeWith(IERC20 payToken, Plan plan, uint8 periods) external {
        _subscribe(payToken, plan, periods);
    }

    function _subscribe(IERC20 payToken, Plan plan, uint8 periods) internal {
        if (!acceptedToken[address(payToken)]) revert TokenNotAccepted(address(payToken));
        if (plan == Plan.Free) revert InvalidPlan();
        if (periods == 0 || periods > MAX_PERIODS) revert InvalidPeriods();
        uint256 cost = plans[plan].price * periods;
        payToken.safeTransferFrom(msg.sender, treasury, cost);

        uint64 nowTs = uint64(block.timestamp);
        uint64 start = nowTs;
        if (expiresAt[msg.sender] > nowTs) {
            uint256 remaining = expiresAt[msg.sender] - nowTs;
            Plan current = planOf[msg.sender];
            if (current == plan) {
                start = expiresAt[msg.sender];
            } else {
                start = nowTs + uint64((remaining * plans[current].price) / plans[plan].price);
            }
        }
        uint64 expiry = start + PERIOD * periods;
        planOf[msg.sender] = plan;
        expiresAt[msg.sender] = expiry;
        emit Subscribed(msg.sender, plan, periods, address(payToken), cost, expiry);
    }

    function activePlan(address user) public view returns (Plan) {
        return expiresAt[user] > block.timestamp ? planOf[user] : Plan.Free;
    }

    /// @notice (create, list, rent) limits of the user's active plan.
    function limitsOf(address user) public view returns (uint32 createLimit, uint32 listLimit, uint32 rentLimit) {
        PlanInfo storage p = plans[activePlan(user)];
        return (p.createLimit, p.listLimit, p.rentLimit);
    }

    // ───────────────────────── Create & list ─────────────────────────

    /// @notice Register an ERC-8004 agent you own as one of your AgentSurely agents.
    function registerAgent(uint256 agentId) public {
        if (identity.ownerOf(agentId) != msg.sender) revert NotAgentOwner(agentId);
        if (creatorOf[agentId] != address(0)) revert AlreadyRegistered(agentId);
        if (!unlimited[msg.sender]) {
            uint32 limit = plans[activePlan(msg.sender)].createLimit;
            if (_created[msg.sender].length >= limit) revert CreateLimitReached(limit);
        }
        creatorOf[agentId] = msg.sender;
        _created[msg.sender].push(agentId);
        _createdPos[msg.sender][agentId] = _created[msg.sender].length;
        emit AgentRegistered(msg.sender, agentId);
    }

    /// @notice Free a create slot. Unlists the agent; existing rentals keep running until they expire.
    function unregisterAgent(uint256 agentId) external {
        if (creatorOf[agentId] != msg.sender) revert NotCreator(agentId);
        if (listed[agentId]) _setListed(agentId, false);
        uint256 pos = _createdPos[msg.sender][agentId];
        uint256[] storage c = _created[msg.sender];
        uint256 last = c[c.length - 1];
        c[pos - 1] = last;
        _createdPos[msg.sender][last] = pos;
        c.pop();
        delete _createdPos[msg.sender][agentId];
        delete creatorOf[agentId];
        emit AgentUnregistered(msg.sender, agentId);
    }

    /// @notice List (or unlist) one of your agents for rent. Listing needs Pro (5) or VIP (30).
    function setListed(uint256 agentId, bool on) public {
        if (creatorOf[agentId] != msg.sender) revert NotCreator(agentId);
        if (listed[agentId] == on) return;
        if (on && !unlimited[msg.sender]) {
            uint32 limit = plans[activePlan(msg.sender)].listLimit;
            if (listedCount[msg.sender] >= limit) revert ListLimitReached(limit);
        }
        _setListed(agentId, on);
    }

    /// @notice Register (if needed) and list several agents in one call.
    function publishAgents(uint256[] calldata agentIds) external {
        for (uint256 i; i < agentIds.length; i++) {
            if (creatorOf[agentIds[i]] == address(0)) registerAgent(agentIds[i]);
            setListed(agentIds[i], true);
        }
    }

    function _setListed(uint256 agentId, bool on) internal {
        address creator = creatorOf[agentId];
        listed[agentId] = on;
        if (on) listedCount[creator]++;
        else listedCount[creator]--;
        emit AgentListed(creator, agentId, on);
    }

    /// @notice True when the agent can be rented right now: listed, and its creator's plan
    ///         still covers all of their listings (a lapsed Pro/VIP pauses new rentals).
    function forRent(uint256 agentId) public view returns (bool) {
        if (!listed[agentId]) return false;
        address creator = creatorOf[agentId];
        return unlimited[creator] || listedCount[creator] <= plans[activePlan(creator)].listLimit;
    }

    function createdAgents(address creator) external view returns (uint256[] memory) {
        return _created[creator];
    }

    // ───────────────────────────── Rent ──────────────────────────────

    /// @notice Rent an agent for `periods` × 30 days at `rentPrice` per period.
    ///         Renting an agent you already rent extends it (no extra slot).
    function rent(uint256 agentId, uint8 periods) external {
        _rent(token, agentId, periods);
    }

    /// @notice Same as `rent`, paid in another accepted stablecoin (e.g. USDC). The creator is paid in that token.
    function rentWith(IERC20 payToken, uint256 agentId, uint8 periods) external {
        _rent(payToken, agentId, periods);
    }

    function _rent(IERC20 payToken, uint256 agentId, uint8 periods) internal {
        if (!acceptedToken[address(payToken)]) revert TokenNotAccepted(address(payToken));
        if (periods == 0 || periods > MAX_PERIODS) revert InvalidPeriods();
        if (!forRent(agentId)) revert NotForRent(agentId);
        address creator = creatorOf[agentId];
        if (creator == msg.sender) revert OwnAgent(agentId);

        uint64 nowTs = uint64(block.timestamp);
        uint64 current = rentalExpiry[msg.sender][agentId];
        uint64 start = current > nowTs ? current : nowTs;
        if (_rentalPos[msg.sender][agentId] == 0) {
            _pruneExpired(msg.sender);
            uint32 limit = plans[activePlan(msg.sender)].rentLimit;
            if (_rentals[msg.sender].length >= limit) revert RentLimitReached(limit);
            _rentals[msg.sender].push(agentId);
            _rentalPos[msg.sender][agentId] = _rentals[msg.sender].length;
        }
        uint64 expiry = start + PERIOD * periods;
        rentalExpiry[msg.sender][agentId] = expiry;

        uint256 cost = rentPrice * periods;
        uint256 fee = (cost * platformFeeBps) / 10_000;
        if (fee > 0) payToken.safeTransferFrom(msg.sender, treasury, fee);
        if (cost > fee) payToken.safeTransferFrom(msg.sender, creator, cost - fee);
        emit Rented(msg.sender, agentId, periods, address(payToken), cost, fee, expiry);
    }

    /// @notice Drop a rental to free a slot (no refund).
    function cancelRental(uint256 agentId) external {
        if (_rentalPos[msg.sender][agentId] == 0) revert NotRented(agentId);
        _removeRental(msg.sender, agentId);
        emit RentalCancelled(msg.sender, agentId);
    }

    function _pruneExpired(address renter) internal {
        uint256[] storage r = _rentals[renter];
        uint256 i;
        while (i < r.length) {
            if (rentalExpiry[renter][r[i]] <= block.timestamp) _removeRental(renter, r[i]);
            else i++;
        }
    }

    function _removeRental(address renter, uint256 agentId) internal {
        uint256 pos = _rentalPos[renter][agentId];
        uint256[] storage r = _rentals[renter];
        uint256 last = r[r.length - 1];
        r[pos - 1] = last;
        _rentalPos[renter][last] = pos;
        r.pop();
        delete _rentalPos[renter][agentId];
        delete rentalExpiry[renter][agentId];
    }

    /// @notice Agents the user rents (may include expired entries until the next `rent`).
    function rentals(address renter) external view returns (uint256[] memory) {
        return _rentals[renter];
    }

    function activeRentalCount(address renter) public view returns (uint256 n) {
        uint256[] storage r = _rentals[renter];
        for (uint256 i; i < r.length; i++) if (rentalExpiry[renter][r[i]] > block.timestamp) n++;
    }

    function isRenting(address renter, uint256 agentId) public view returns (bool) {
        return rentalExpiry[renter][agentId] > block.timestamp;
    }

    /// @inheritdoc IHireGate
    /// @dev Creator (or current ERC-8004 owner of an unregistered agent) may always test their own
    ///      agent; anyone else needs an active rental.
    function canHire(address client, uint256 agentId) external view override returns (bool) {
        address creator = creatorOf[agentId];
        if (creator == client) return true;
        if (creator == address(0)) return identity.ownerOf(agentId) == client;
        return isRenting(client, agentId);
    }

    // ───────────────────────────── Admin ─────────────────────────────

    function setPlan(Plan plan, uint256 price, uint32 createLimit, uint32 listLimit, uint32 rentLimit) external onlyOwner {
        if (plan != Plan.Free && price == 0) revert InvalidPlan();
        if (plan == Plan.Free && price != 0) revert InvalidPlan();
        plans[plan] = PlanInfo(price, createLimit, listLimit, rentLimit);
        emit PlanUpdated(plan, price, createLimit, listLimit, rentLimit);
    }

    function setRentPrice(uint256 price, uint16 feeBps) external onlyOwner {
        if (price == 0 || feeBps > MAX_FEE_BPS) revert InvalidParams();
        rentPrice = price;
        platformFeeBps = feeBps;
        emit RentPriceUpdated(price, feeBps);
    }

    function setTreasury(address treasury_) external onlyOwner {
        if (treasury_ == address(0)) revert InvalidParams();
        treasury = treasury_;
        emit TreasuryUpdated(treasury_);
    }

    /// @notice Accept / stop accepting a stablecoin. It must have the same decimals as `token`, since prices
    ///         are stored once (1 unit = $1). The default token cannot be switched off.
    function setAcceptedToken(IERC20 payToken, bool on) external onlyOwner {
        if (address(payToken) == address(token) && !on) revert InvalidParams();
        if (on && IERC20Metadata(address(payToken)).decimals() != IERC20Metadata(address(token)).decimals()) {
            revert InvalidParams();
        }
        acceptedToken[address(payToken)] = on;
        emit AcceptedTokenUpdated(address(payToken), on);
    }

    function setUnlimited(address account, bool on) external onlyOwner {
        unlimited[account] = on;
        emit UnlimitedUpdated(account, on);
    }
}
