import {
  keccak256,
  maxUint256,
  toBytes,
  zeroHash,
  parseEventLogs,
  type Account,
  type Address,
  type Chain,
  type Hash,
  type Hex,
  type PublicClient,
  type Transport,
  type WalletClient,
} from "viem";

import { identityRegistryAbi, jobBoardAbi, mockUsdAbi, playbookRegistryAbi, reputationRegistryAbi, subscriptionManagerAbi, surelyVaultAbi, validationRegistryAbi } from "./generated/abis";
import { catalog, catalogDeployments, domains, playbooks } from "./generated/catalog";
import { deployments } from "./generated/deployments";
import { parseAgentUri } from "./format";
import { USDC_FAUCET_URL } from "./format";
import { JOB_STATUS, PLANS, type Agent, type BoardJob, type Domain, type JobLimits, type JobTemplate, type CatalogAgent, type Deployment, type Erc8004Summary, type HireParams, type Job, type OnchainPlaybook, type PayToken, type PayTokenSymbol, type Playbook, type PlaybookEntry, type PlanInfo, type PlanName, type Subscription } from "./types";

/** Promise.all with at most `limit` tasks in flight (keeps public RPCs under their rate limit). */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  const worker = async () => {
    while (i < items.length) {
      const k = i++;
      out[k] = await fn(items[k]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

export type AgentSurelyClientOptions = {
  publicClient: PublicClient;
  walletClient?: WalletClient<Transport, Chain | undefined, Account | undefined>;
  /** Override addresses; defaults to the synced deployment for the client's chain. */
  addresses?: Deployment;
};

/**
 * Thin, typed wrapper around SurelyVault + ERC-8004 identity + bond token.
 *
 * ```ts
 * const sdk = new AgentSurelyClient({ publicClient, walletClient });
 * const agentId = await sdk.registerAgent({ name: "ResearchBot", skills: ["research"] });
 * await sdk.depositBond(agentId, toUnits(1_000));
 * const jobId = await sdk.hire({ agentId, spec: "…", fee: toUnits(20), coverage: toUnits(300), deadline, minScore: 70 });
 * ```
 */
export class AgentSurelyClient {
  readonly pub: PublicClient;
  readonly wallet?: AgentSurelyClientOptions["walletClient"];
  readonly addresses: Deployment;

  constructor(opts: AgentSurelyClientOptions) {
    this.pub = opts.publicClient;
    this.wallet = opts.walletClient;
    const chainId = opts.publicClient.chain?.id;
    const addresses = opts.addresses ?? (chainId !== undefined ? deployments[chainId] : undefined);
    if (!addresses) throw new Error(`AgentSurely is not deployed on chain ${chainId}. Run deploy + sync.`);
    this.addresses = addresses;
  }

  static isDeployed(chainId: number) {
    return Boolean(deployments[chainId]);
  }

  // ───────────────────────────── reads ─────────────────────────────

  private vaultRead<T>(functionName: string, args: readonly unknown[] = []): Promise<T> {
    return this.pub.readContract({ address: this.addresses.SurelyVault, abi: surelyVaultAbi, functionName, args } as never) as Promise<T>;
  }

  /** USDC balance (default) or another ERC-20 balance, 6 decimals. */
  async tokenBalance(owner: Address, token: Address = this.usdc): Promise<bigint> {
    return this.pub.readContract({ address: token, abi: mockUsdAbi, functionName: "balanceOf", args: [owner] });
  }

  /**
   * Tokens accepted for plans and rentals: USDC (upgrade-04). On Monad testnet it is Circle's USDC
   * (faucet.circle.com, 20 USDC / 2h); locally a MockStable with its own faucet. mUSD is reward-only.
   */
  payTokens(): PayToken[] {
    return [{ symbol: "USDC", address: this.usdc, faucet: this.isLocal ? "contract" : USDC_FAUCET_URL }];
  }

  private get isLocal() {
    return this.pub.chain?.id === 31337;
  }

  /** USDC — the money for bonds, fees, coverage, plans and rentals (upgrade-04). */
  get usdc(): Address {
    const a = this.addresses.USDC;
    if (!a) throw new Error("This deployment has no USDC — redeploy with the upgrade-04 contracts (npm run deploy:monad)");
    return a;
  }

  /** mUSD reward balance (paid by the vault for every passed job). */
  rewardBalance(owner: Address): Promise<bigint> {
    return this.pub.readContract({ address: this.addresses.MockUSD, abi: mockUsdAbi, functionName: "balanceOf", args: [owner] });
  }

  /** mUSD paid per passed job and what is left in the vault's reward pool. */
  async rewardInfo(): Promise<{ perPass: bigint; pool: bigint }> {
    const [perPass, pool] = await Promise.all([this.vaultRead<bigint>("rewardPerPass"), this.vaultRead<bigint>("rewardPool")]);
    return { perPass, pool };
  }

  private payTokenAddress(symbol: PayTokenSymbol): Address {
    const t = this.payTokens().find((x) => x.symbol === symbol);
    if (!t) throw new Error(`${symbol} is not configured on this deployment`);
    return t.address;
  }

  /** Agents that have posted a bond in this vault (works with a shared, canonical identity registry). */
  async bondedAgentIds(): Promise<bigint[]> {
    return [...(await this.vaultRead<readonly bigint[]>("bondedAgents"))];
  }

  async agentCount(): Promise<number> {
    return (await this.bondedAgentIds()).length;
  }

  async getAgent(agentId: bigint): Promise<Agent> {
    const reg = { address: this.addresses.IdentityRegistry, abi: identityRegistryAbi } as const;
    const [owner, uri, bond, stats, available, reputation, rewards] = await Promise.all([
      this.pub.readContract({ ...reg, functionName: "ownerOf", args: [agentId] }),
      this.pub.readContract({ ...reg, functionName: "tokenURI", args: [agentId] }),
      this.vaultRead<readonly [bigint, bigint, bigint, bigint]>("bonds", [agentId]),
      this.vaultRead<readonly [number, number, number, bigint, bigint]>("stats", [agentId]),
      this.vaultRead<bigint>("availableBond", [agentId]),
      this.vaultRead<bigint>("reputationBps", [agentId]),
      this.vaultRead<bigint>("rewardsEarned", [agentId]).catch(() => 0n),
    ]);
    return {
      id: agentId,
      owner,
      uri,
      profile: parseAgentUri(uri),
      bond: { total: bond[0], locked: bond[1], pendingWithdraw: bond[2], unlockAt: Number(bond[3]), available },
      stats: { passed: stats[0], failed: stats[1], expired: stats[2], earned: stats[3], slashed: stats[4] },
      reputationBps: Number(reputation),
      rewardsEarned: rewards,
    };
  }

  async listAgents(): Promise<Agent[]> {
    return mapLimit(await this.bondedAgentIds(), 2, (id) => this.getAgent(id));
  }

  /** Jobs currently waiting for a CRE verdict (the cron fallback's queue). */
  async pendingJobIds(max = 50): Promise<bigint[]> {
    return [...(await this.vaultRead<readonly bigint[]>("pendingJobs", [BigInt(max)]))];
  }

  /** ERC-8004 reputation + validation recorded for an agent by this vault. Zeros if registries are off. */
  async getErc8004Summary(agentId: bigint): Promise<Erc8004Summary> {
    const vault = [this.addresses.SurelyVault] as const;
    const empty: Erc8004Summary = { feedbackCount: 0, averageScore: 0, validations: 0, averageValidation: 0 };
    const [rep, val] = await Promise.all([
      this.addresses.ReputationRegistry
        ? this.pub
            .readContract({ address: this.addresses.ReputationRegistry, abi: reputationRegistryAbi, functionName: "getSummary", args: [agentId, vault, "agentsurely", ""] })
            .catch(() => null)
        : null,
      this.addresses.ValidationRegistry
        ? this.pub
            .readContract({ address: this.addresses.ValidationRegistry, abi: validationRegistryAbi, functionName: "getSummary", args: [agentId, vault, "agentsurely"] })
            .catch(() => null)
        : null,
    ]);
    return {
      ...empty,
      ...(rep ? { feedbackCount: Number(rep[0]), averageScore: Number(rep[1]) / 10 ** Number(rep[2]) } : {}),
      ...(val ? { validations: Number(val[0]), averageValidation: Number(val[1]) } : {}),
    };
  }

  async jobCount(): Promise<number> {
    return Number(await this.vaultRead<bigint>("jobCount"));
  }

  async getJob(jobId: bigint, withText = true): Promise<Job> {
    type RawJob = {
      agentId: bigint; client: Address; fee: bigint; coverage: bigint; createdAt: bigint; deadline: bigint;
      submittedAt: bigint; minScore: number; score: number; status: number; specHash: `0x${string}`;
      outputHash: `0x${string}`; reportHash: `0x${string}`;
    };
    if (withText) {
      const [[raw, spec, output], verdictReason, validationRequestHash] = await Promise.all([
        this.vaultRead<readonly [RawJob, string, string]>("getJobForVerification", [jobId]),
        this.vaultRead<string>("verdictReason", [jobId]),
        this.vaultRead<Hex>("validationRequestHash", [jobId]).catch(() => zeroHash),
      ]);
      return { ...toJob(jobId, raw), spec, output, verdictReason, validationRequestHash };
    }
    return toJob(jobId, await this.vaultRead<RawJob>("getJob", [jobId]));

    function toJob(id: bigint, r: RawJob): Job {
      return {
        id,
        agentId: r.agentId,
        client: r.client,
        fee: r.fee,
        coverage: r.coverage,
        createdAt: Number(r.createdAt),
        deadline: Number(r.deadline),
        submittedAt: Number(r.submittedAt),
        minScore: Number(r.minScore),
        score: Number(r.score),
        status: JOB_STATUS[Number(r.status)],
        specHash: r.specHash,
        outputHash: r.outputHash,
        reportHash: r.reportHash,
      };
    }
  }

  /** Most recent first. */
  async listJobs(opts: { agentId?: bigint; client?: Address; limit?: number } = {}): Promise<Job[]> {
    const n = await this.jobCount();
    const ids = Array.from({ length: n }, (_, i) => BigInt(n - 1 - i));
    const jobs = await mapLimit(ids, 3, (id) => this.getJob(id, true));
    return jobs
      .filter((j) => (opts.agentId === undefined || j.agentId === opts.agentId))
      .filter((j) => (!opts.client || j.client.toLowerCase() === opts.client.toLowerCase()))
      .slice(0, opts.limit ?? Infinity);
  }

  // ───────────────────────────── writes ────────────────────────────

  private get account(): Account | Address {
    const acc = this.wallet?.account;
    if (!acc) throw new Error("A walletClient with an account is required for writes");
    return acc;
  }

  private async send(address: Address, abi: readonly unknown[], functionName: string, args: readonly unknown[]): Promise<Hash> {
    if (!this.wallet) throw new Error("walletClient required");
    const { request } = await this.pub.simulateContract({
      address, abi, functionName, args, account: this.account, chain: this.pub.chain,
    } as never);
    const hash = await this.wallet.writeContract(request as never);
    const receipt = await this.pub.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error(`Transaction reverted: ${hash}`);
    return hash;
  }

  private async ensureAllowance(amount: bigint, spender: Address = this.addresses.SurelyVault, token: Address = this.usdc) {
    const owner = typeof this.account === "string" ? this.account : this.account.address;
    const allowance = await this.pub.readContract({
      address: token, abi: mockUsdAbi, functionName: "allowance", args: [owner, spender],
    });
    if (allowance < amount) await this.send(token, mockUsdAbi, "approve", [spender, maxUint256]);
  }

  // ─────────────────────── catalog & subscriptions ──────────────────────

  private get subs(): Address {
    const a = this.addresses.SubscriptionManager;
    if (!a) throw new Error("No SubscriptionManager in this deployment");
    return a;
  }

  /** Catalog agents with their onchain agentId on this chain (undefined if not registered here). */
  catalog(): (CatalogAgent & { agentId?: bigint })[] {
    const ids = catalogDeployments[this.pub.chain?.id ?? 0] ?? {};
    return catalog.map((a) => ({ ...a, agentId: ids[a.id] !== undefined ? BigInt(ids[a.id]) : undefined }));
  }

  catalogAgentFor(agentId: bigint) {
    return this.catalog().find((a) => a.agentId === agentId);
  }

  /**
   * What to do with an agent after renting it: catalog playbooks, else generic ones matched by skill.
   * Always returns at least one playbook.
   */
  playbooksFor(agentId: bigint, skills: string[] = []): Playbook[] {
    const cat = this.catalogAgentFor(agentId);
    if (cat && playbooks.agents[cat.id]?.length) return playbooks.agents[cat.id];
    const allSkills = [...(cat?.skills ?? []), ...skills];
    const matched = allSkills.flatMap((s) => playbooks.generic[s] ?? []);
    return matched.length ? matched.slice(0, 3) : playbooks.generic._default ?? [];
  }

  // ─────────────────── playbook market (upgrade-07, PlaybookRegistry) ───────────────────

  /** True when this deployment has a PlaybookRegistry (creators can publish playbooks). */
  get hasPlaybookMarket(): boolean {
    return Boolean(this.addresses.PlaybookRegistry);
  }

  private get books(): Address {
    const a = this.addresses.PlaybookRegistry;
    if (!a) throw new Error("No PlaybookRegistry in this deployment — run `npm run playbooks:monad`");
    return a;
  }

  /** Playbooks the agent's creator published on-chain (active only unless `includeInactive`). */
  async getPlaybooks(agentId: bigint, opts: { includeInactive?: boolean } = {}): Promise<OnchainPlaybook[]> {
    if (!this.hasPlaybookMarket) return [];
    const raw = await this.pub.readContract({ address: this.books, abi: playbookRegistryAbi, functionName: "playbooksOf", args: [agentId] });
    return raw
      .map((p, index) => ({
        agentId,
        index,
        author: p.author,
        updatedAt: Number(p.updatedAt),
        active: p.active,
        useful: Number(p.useful),
        title: p.title,
        outcome: p.outcome,
        template: p.template,
      }))
      .filter((p) => opts.includeInactive || p.active);
  }

  /**
   * What a renter can run with this agent: the creator's on-chain playbooks (most useful first), then
   * AgentSurely starter playbooks (catalog/playbooks.json) so there is always something to run.
   */
  async playbooksForAgent(agentId: bigint, skills: string[] = []): Promise<PlaybookEntry[]> {
    const onchain = (await this.getPlaybooks(agentId).catch(() => [] as OnchainPlaybook[])).sort((a, b) => b.useful - a.useful || b.updatedAt - a.updatedAt);
    const titles = new Set(onchain.map((p) => p.title.toLowerCase()));
    const starter = this.playbooksFor(agentId, skills).filter((p) => !titles.has(p.title.toLowerCase()));
    return [
      ...onchain.map((p): PlaybookEntry => ({ title: p.title, outcome: p.outcome, template: p.template, source: "creator", onchain: p })),
      ...starter.map((p): PlaybookEntry => ({ ...p, source: "starter" })),
    ];
  }

  /** Every active creator playbook across agents, most useful first (the market page). */
  async playbookMarket(): Promise<OnchainPlaybook[]> {
    if (!this.hasPlaybookMarket) return [];
    const ids = await this.pub.readContract({ address: this.books, abi: playbookRegistryAbi, functionName: "agentsWithPlaybooks" });
    const all = (await Promise.all(ids.map((id) => this.getPlaybooks(id)))).flat();
    return all.sort((a, b) => b.useful - a.useful || b.updatedAt - a.updatedAt);
  }

  /** Publishes a playbook for an agent you own; returns its index. */
  async publishPlaybook(agentId: bigint, p: Playbook): Promise<number> {
    const hash = await this.send(this.books, playbookRegistryAbi, "publish", [agentId, p.title, p.outcome, p.template]);
    const receipt = await this.pub.getTransactionReceipt({ hash });
    const [ev] = parseEventLogs({ abi: playbookRegistryAbi, logs: receipt.logs, eventName: "PlaybookPublished" });
    return Number(ev.args.index);
  }

  editPlaybook(agentId: bigint, index: number, p: Playbook) {
    return this.send(this.books, playbookRegistryAbi, "edit", [agentId, BigInt(index), p.title, p.outcome, p.template]);
  }

  setPlaybookActive(agentId: bigint, index: number, active: boolean) {
    return this.send(this.books, playbookRegistryAbi, "setActive", [agentId, BigInt(index), active]);
  }

  /** Renters (not the owner) vote a playbook useful, once each. */
  markPlaybookUseful(agentId: bigint, index: number) {
    return this.send(this.books, playbookRegistryAbi, "markUseful", [agentId, BigInt(index)]);
  }

  async canVotePlaybook(voter: Address, agentId: bigint): Promise<boolean> {
    if (!this.hasPlaybookMarket) return false;
    return this.pub.readContract({ address: this.books, abi: playbookRegistryAbi, functionName: "canVote", args: [voter, agentId] });
  }

  async votedUseful(agentId: bigint, index: number, voter: Address): Promise<boolean> {
    if (!this.hasPlaybookMarket) return false;
    return this.pub.readContract({ address: this.books, abi: playbookRegistryAbi, functionName: "votedUseful", args: [agentId, BigInt(index), voter] });
  }

  // ─────────────────── jobs by domain (upgrade-08, JobBoard) ───────────────────

  /** Domains with ready-to-create jobs (catalog/domains.json). */
  domains(): Domain[] {
    return domains;
  }

  jobTemplate(templateId: string): { domain: Domain; template: JobTemplate } | undefined {
    for (const d of domains) {
      const t = d.jobs.find((j) => j.id === templateId);
      if (t) return { domain: d, template: t };
    }
    return undefined;
  }

  /** ERC-8004 agentId of a catalog agent on this chain. */
  catalogAgentId(catalogId: string): bigint | undefined {
    const n = (catalogDeployments[this.pub.chain?.id ?? 0] ?? {})[catalogId];
    return n === undefined ? undefined : BigInt(n);
  }

  get hasJobBoard(): boolean {
    return Boolean(this.addresses.JobBoard);
  }

  private get board(): Address {
    const a = this.addresses.JobBoard;
    if (!a) throw new Error("No JobBoard in this deployment — run `npm run jobs:monad`");
    return a;
  }

  /** Limits per plan: Free 1 job × 3 agents · Pro 5 × 5 · VIP 30 × 30 (admin-configurable). */
  async planJobLimits(): Promise<Record<PlanName, { jobs: number; agentsPerJob: number }>> {
    const read = (i: number) => this.pub.readContract({ address: this.board, abi: jobBoardAbi, functionName: "limits", args: [i] });
    const rows = await Promise.all([0, 1, 2].map(read));
    return Object.fromEntries(PLANS.map((p, i) => [p, { jobs: Number(rows[i][0]), agentsPerJob: Number(rows[i][1]) }])) as Record<PlanName, { jobs: number; agentsPerJob: number }>;
  }

  async jobLimits(user: Address): Promise<JobLimits> {
    const c = { address: this.board, abi: jobBoardAbi } as const;
    const [l, open] = await Promise.all([
      this.pub.readContract({ ...c, functionName: "limitsOf", args: [user] }),
      this.pub.readContract({ ...c, functionName: "openJobs", args: [user] }),
    ]);
    const unlimited = l.jobs === 0xffffffff;
    return { jobs: l.jobs, agentsPerJob: l.agentsPerJob, openJobs: Number(open), unlimited };
  }

  async getBoardJob(jobId: bigint): Promise<BoardJob> {
    const j = await this.pub.readContract({ address: this.board, abi: jobBoardAbi, functionName: "getJob", args: [jobId] });
    return {
      id: jobId,
      owner: j.owner,
      createdAt: Number(j.createdAt),
      updatedAt: Number(j.updatedAt),
      open: j.open,
      domain: j.domain,
      title: j.title,
      brief: j.brief,
      agents: [...j.agents],
    };
  }

  /** Jobs of a wallet, newest first. */
  async listBoardJobs(owner: Address): Promise<BoardJob[]> {
    if (!this.hasJobBoard) return [];
    const ids = await this.pub.readContract({ address: this.board, abi: jobBoardAbi, functionName: "jobsOf", args: [owner] });
    const jobs = await Promise.all(ids.map((id) => this.getBoardJob(id)));
    return jobs.sort((a, b) => b.createdAt - a.createdAt);
  }

  /** Rents (1 USDC / 30 days each) every agent the connected wallet can't hire yet. Returns the ids rented. */
  async rentMissing(agentIds: bigint[]): Promise<bigint[]> {
    const me = typeof this.account === "string" ? this.account : this.account.address;
    const can = await Promise.all(agentIds.map((id) => this.canHire(me, id)));
    const missing = agentIds.filter((_, i) => !can[i]);
    for (const id of missing) await this.rent(id, 1);
    return missing;
  }

  /**
   * Creates a job and puts agents on it. With `rentMissing` (default) agents you don't rent yet are rented
   * first (1 USDC each), so a suggested job is created in one click (a few wallet confirmations).
   */
  async createBoardJob(p: { domain: string; title: string; brief: string; agentIds: bigint[]; rentMissing?: boolean }): Promise<bigint> {
    if (p.rentMissing !== false) await this.rentMissing(p.agentIds);
    const hash = await this.send(this.board, jobBoardAbi, "createJob", [p.domain, p.title, p.brief, p.agentIds]);
    const receipt = await this.pub.getTransactionReceipt({ hash });
    const [ev] = parseEventLogs({ abi: jobBoardAbi, logs: receipt.logs, eventName: "JobCreated" });
    return ev.args.jobId;
  }

  updateBoardJob(jobId: bigint, p: { domain: string; title: string; brief: string }) {
    return this.send(this.board, jobBoardAbi, "updateJob", [jobId, p.domain, p.title, p.brief]);
  }

  async addJobAgents(jobId: bigint, agentIds: bigint[], rentMissing = true) {
    if (rentMissing) await this.rentMissing(agentIds);
    return this.send(this.board, jobBoardAbi, "addAgents", [jobId, agentIds]);
  }

  removeJobAgent(jobId: bigint, agentId: bigint) {
    return this.send(this.board, jobBoardAbi, "removeAgent", [jobId, agentId]);
  }

  setBoardJobOpen(jobId: bigint, open: boolean) {
    return this.send(this.board, jobBoardAbi, "setOpen", [jobId, open]);
  }

  /** Price (per 30 days) and create / list / rent limits of every plan. */
  async planPrices(): Promise<Record<PlanName, PlanInfo>> {
    const read = (i: number) => this.pub.readContract({ address: this.subs, abi: subscriptionManagerAbi, functionName: "plans", args: [i] });
    const rows = await Promise.all(PLANS.map((_, i) => read(i)));
    return Object.fromEntries(
      PLANS.map((p, i) => [p, { price: rows[i][0], create: Number(rows[i][1]), list: Number(rows[i][2]), rent: Number(rows[i][3]) }])
    ) as Record<PlanName, PlanInfo>;
  }

  /** Rent per agent per 30 days and the platform fee (basis points). */
  async rentTerms(): Promise<{ price: bigint; feeBps: number }> {
    const c = { address: this.subs, abi: subscriptionManagerAbi } as const;
    const [price, feeBps] = await Promise.all([
      this.pub.readContract({ ...c, functionName: "rentPrice" }),
      this.pub.readContract({ ...c, functionName: "platformFeeBps" }),
    ]);
    return { price, feeBps: Number(feeBps) };
  }

  async getSubscription(user: Address): Promise<Subscription> {
    const c = { address: this.subs, abi: subscriptionManagerAbi } as const;
    const [plan, expiresAt, limits, created, rented] = await Promise.all([
      this.pub.readContract({ ...c, functionName: "activePlan", args: [user] }),
      this.pub.readContract({ ...c, functionName: "expiresAt", args: [user] }),
      this.pub.readContract({ ...c, functionName: "limitsOf", args: [user] }),
      this.pub.readContract({ ...c, functionName: "createdAgents", args: [user] }),
      this.pub.readContract({ ...c, functionName: "rentals", args: [user] }),
    ]);
    const [listedFlags, expiries] = await Promise.all([
      Promise.all(created.map((id) => this.pub.readContract({ ...c, functionName: "listed", args: [id] }))),
      Promise.all(rented.map((id) => this.pub.readContract({ ...c, functionName: "rentalExpiry", args: [user, id] }))),
    ]);
    const now = Math.floor(Date.now() / 1000);
    return {
      plan: PLANS[Number(plan)],
      expiresAt: Number(expiresAt),
      limits: { create: Number(limits[0]), list: Number(limits[1]), rent: Number(limits[2]) },
      created: [...created],
      listed: created.filter((_, i) => listedFlags[i]),
      rentals: rented.map((agentId, i) => ({ agentId, expiresAt: Number(expiries[i]) })).filter((r) => r.expiresAt > now),
    };
  }

  /** Creator of an agent registered with AgentSurely (zero address if none). */
  creatorOf(agentId: bigint): Promise<Address> {
    return this.pub.readContract({ address: this.subs, abi: subscriptionManagerAbi, functionName: "creatorOf", args: [agentId] });
  }

  /** True when the agent is listed and can be rented right now. */
  forRent(agentId: bigint): Promise<boolean> {
    return this.pub.readContract({ address: this.subs, abi: subscriptionManagerAbi, functionName: "forRent", args: [agentId] });
  }

  canHire(client: Address, agentId: bigint): Promise<boolean> {
    if (!this.addresses.SubscriptionManager) return Promise.resolve(true);
    return this.pub.readContract({ address: this.subs, abi: subscriptionManagerAbi, functionName: "canHire", args: [client, agentId] });
  }

  /** Pays `periods` × the plan price in USDC (approves the SubscriptionManager first if needed). */
  async subscribe(plan: Exclude<PlanName, "Free">, periods = 1, pay: PayTokenSymbol = "USDC") {
    const prices = await this.planPrices();
    const token = this.payTokenAddress(pay);
    await this.ensureAllowance(prices[plan].price * BigInt(periods), this.subs, token);
    if (token === this.usdc) return this.send(this.subs, subscriptionManagerAbi, "subscribe", [PLANS.indexOf(plan), periods]);
    return this.send(this.subs, subscriptionManagerAbi, "subscribeWith", [token, PLANS.indexOf(plan), periods]);
  }

  /** Count an ERC-8004 agent you own against your plan's create limit (Free 3 · Pro 5 · VIP 30). */
  registerWithPlan(agentId: bigint) {
    return this.send(this.subs, subscriptionManagerAbi, "registerAgent", [agentId]);
  }

  unregisterFromPlan(agentId: bigint) {
    return this.send(this.subs, subscriptionManagerAbi, "unregisterAgent", [agentId]);
  }

  /** List / unlist one of your agents for rent (Pro 5 · VIP 30). */
  setListed(agentId: bigint, listed: boolean) {
    return this.send(this.subs, subscriptionManagerAbi, "setListed", [agentId, listed]);
  }

  /** Register (if needed) and list several agents in one transaction. */
  publishAgents(agentIds: bigint[]) {
    return this.send(this.subs, subscriptionManagerAbi, "publishAgents", [agentIds]);
  }

  /** Rent an agent for `periods` × 30 days ($1 each; 90% to its creator, 10% platform fee). */
  async rent(agentId: bigint, periods = 1, pay: PayTokenSymbol = "USDC") {
    const { price } = await this.rentTerms();
    const token = this.payTokenAddress(pay);
    await this.ensureAllowance(price * BigInt(periods), this.subs, token);
    if (token === this.usdc) return this.send(this.subs, subscriptionManagerAbi, "rent", [agentId, periods]);
    return this.send(this.subs, subscriptionManagerAbi, "rentWith", [token, agentId, periods]);
  }

  cancelRental(agentId: bigint) {
    return this.send(this.subs, subscriptionManagerAbi, "cancelRental", [agentId]);
  }

  /**
   * USDC faucet. Local: the MockStable mints 20 USDC. Monad testnet: Circle's USDC can't be minted —
   * this throws with the link (https://faucet.circle.com, Monad Testnet, 20 USDC / 2h per address).
   */
  faucet() {
    if (!this.isLocal) throw new Error(`Get testnet USDC at ${USDC_FAUCET_URL} (choose Monad Testnet)`);
    return this.send(this.usdc, mockUsdAbi, "faucet", []);
  }

  /** Local dev only: mint MockStable USDC to any address (scripts). */
  mintUsdcLocal(to: Address, amount: bigint) {
    if (!this.isLocal) throw new Error("USDC can only be minted on a local chain");
    return this.send(this.usdc, mockUsdAbi, "mint", [to, amount]);
  }

  /** @deprecated use faucet() */
  usdcFaucet() {
    return this.faucet();
  }

  /** Registers an agent in the ERC-8004 identity registry and returns its agentId. */
  async registerAgent(profileOrUri: Record<string, unknown> | string): Promise<bigint> {
    const uri =
      typeof profileOrUri === "string"
        ? profileOrUri
        : `data:application/json,${encodeURIComponent(JSON.stringify(profileOrUri))}`;
    const hash = await this.send(this.addresses.IdentityRegistry, identityRegistryAbi, "register", [uri]);
    const receipt = await this.pub.getTransactionReceipt({ hash });
    const [ev] = parseEventLogs({ abi: identityRegistryAbi, logs: receipt.logs, eventName: "Registered" });
    return ev.args.agentId;
  }

  async depositBond(agentId: bigint, amount: bigint) {
    await this.ensureAllowance(amount);
    return this.send(this.addresses.SurelyVault, surelyVaultAbi, "depositBond", [agentId, amount]);
  }

  requestWithdraw(agentId: bigint, amount: bigint) {
    return this.send(this.addresses.SurelyVault, surelyVaultAbi, "requestWithdraw", [agentId, amount]);
  }

  withdraw(agentId: bigint) {
    return this.send(this.addresses.SurelyVault, surelyVaultAbi, "withdraw", [agentId]);
  }

  /** Hires an agent: pays the fee into escrow, locks coverage from its bond. Returns the jobId. */
  async hire(p: HireParams): Promise<bigint> {
    await this.ensureAllowance(p.fee);
    const hash = await this.send(this.addresses.SurelyVault, surelyVaultAbi, "createJob", [
      p.agentId, p.spec, p.fee, p.coverage, BigInt(p.deadline), p.minScore,
    ]);
    const receipt = await this.pub.getTransactionReceipt({ hash });
    const [ev] = parseEventLogs({ abi: surelyVaultAbi, logs: receipt.logs, eventName: "JobCreated" });
    return ev.args.jobId;
  }

  /**
   * Called by the agent owner. Emits ResultSubmitted → triggers the CRE workflow.
   * If a Validation Registry is configured, first opens an ERC-8004 validation
   * request naming the vault as validator, so the verdict is also recorded there
   * (one extra tx; pass `{ erc8004Validation: false }` to skip).
   */
  async submitResult(jobId: bigint, output: string, opts: { erc8004Validation?: boolean } = {}) {
    if (opts.erc8004Validation !== false && this.addresses.ValidationRegistry) {
      await this.requestValidation(jobId, output).catch((e: Error) => {
        console.warn(`ERC-8004 validation request skipped: ${e.message.split("\n")[0]}`);
      });
    }
    return this.send(this.addresses.SurelyVault, surelyVaultAbi, "submitResult", [jobId, output]);
  }

  /** Opens the ERC-8004 validation request for a job's output (idempotent). Returns the requestHash. */
  async requestValidation(jobId: bigint, output: string): Promise<Hex> {
    const registry = this.addresses.ValidationRegistry;
    if (!registry) throw new Error("No ValidationRegistry in this deployment");
    const requestHash = await this.vaultRead<Hex>("computeRequestHash", [jobId, keccak256(toBytes(output))]);
    const [validator] = await this.pub.readContract({ address: registry, abi: validationRegistryAbi, functionName: "getValidationStatus", args: [requestHash] });
    if (validator.toLowerCase() === this.addresses.SurelyVault.toLowerCase()) return requestHash;
    const job = await this.getJob(jobId, false);
    const chainId = this.pub.chain?.id ?? 0;
    await this.send(registry, validationRegistryAbi, "validationRequest", [
      this.addresses.SurelyVault, job.agentId, `agentsurely://${chainId}/${this.addresses.SurelyVault}/jobs/${jobId}`, requestHash,
    ]);
    return requestHash;
  }

  claimExpired(jobId: bigint) {
    return this.send(this.addresses.SurelyVault, surelyVaultAbi, "claimExpired", [jobId]);
  }

  refundUnverified(jobId: bigint) {
    return this.send(this.addresses.SurelyVault, surelyVaultAbi, "refundUnverified", [jobId]);
  }
}
