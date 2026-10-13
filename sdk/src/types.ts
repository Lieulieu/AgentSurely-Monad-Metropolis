import type { Address, Hex } from "viem";

export type Deployment = {
  /** mUSD — reward token only (paid by the vault for passed jobs). */
  MockUSD: Address;
  IdentityRegistry: Address;
  SurelyVault: Address;
  /** ERC-8004 Reputation Registry the vault writes verdict feedback to. */
  ReputationRegistry?: Address;
  /** ERC-8004 Validation Registry the vault answers validation requests in. */
  ValidationRegistry?: Address;
  /** upgrade-02 plans (Free/Pro/VIP), agent listings and $1 rentals; also the vault's hire gate. */
  SubscriptionManager?: Address;
  /** USDC — bonds, fees, coverage, plans and rentals. Circle testnet USDC on Monad, a MockStable locally. */
  USDC?: Address;
  /** upgrade-07 playbook market: creators publish ready-to-run tasks for their agents, renters vote. */
  PlaybookRegistry?: Address;
  /** upgrade-08 jobs by domain: Free 1 job × 3 agents · PRO 5 × 5 · VIP 30 × 30. */
  JobBoard?: Address;
  forwarder: Address;
  startBlock: number;
};

export const JOB_STATUS = ["None", "Open", "Submitted", "Passed", "Failed", "Expired", "Refunded"] as const;
export type JobStatus = (typeof JOB_STATUS)[number];

export type Job = {
  id: bigint;
  agentId: bigint;
  client: Address;
  fee: bigint;
  coverage: bigint;
  createdAt: number;
  deadline: number;
  submittedAt: number;
  minScore: number;
  score: number;
  status: JobStatus;
  specHash: Hex;
  outputHash: Hex;
  reportHash: Hex;
  spec?: string;
  output?: string;
  verdictReason?: string;
  /** ERC-8004 validation requestHash for this job (0x0… before submission). */
  validationRequestHash?: Hex;
};

/** What ERC-8004 registries say about an agent, as recorded by this vault. */
export type Erc8004Summary = {
  /** Feedback entries written by the vault (tag1 = "agentsurely"). */
  feedbackCount: number;
  /** Average verdict score across that feedback (0-100). */
  averageScore: number;
  /** Validation responses written by the vault. */
  validations: number;
  averageValidation: number;
};

export type AgentProfile = {
  name: string;
  description?: string;
  skills?: string[];
  endpoint?: string;
  [k: string]: unknown;
};

export type Agent = {
  id: bigint;
  owner: Address;
  uri: string;
  profile: AgentProfile;
  bond: { total: bigint; locked: bigint; pendingWithdraw: bigint; unlockAt: number; available: bigint };
  stats: { passed: number; failed: number; expired: number; earned: bigint; slashed: bigint };
  /** Pass rate in basis points; 0 for agents with no history. */
  reputationBps: number;
  /** mUSD rewards earned from passed jobs. */
  rewardsEarned: bigint;
};

export type HireParams = {
  agentId: bigint;
  spec: string;
  /** Fee paid to the agent on success (token units, 6 decimals). */
  fee: bigint;
  /** Bond locked and paid to the client on failure. */
  coverage: bigint;
  /** Unix seconds. */
  deadline: number;
  /** 0-100 score required to pass. */
  minScore: number;
};

export const PLANS = ["Free", "Pro", "Vip"] as const;
export type PlanName = (typeof PLANS)[number];
export const TIERS = ["Open", "Basic", "Pro", "Vip"] as const;
export type TierName = (typeof TIERS)[number];

export type PlanLimits = {
  /** Agents the wallet may create (register with AgentSurely). */
  create: number;
  /** Agents the wallet may list for rent. */
  list: number;
  /** Active rentals the wallet may hold. */
  rent: number;
};

export type PlanInfo = PlanLimits & { price: bigint };

export type Subscription = {
  plan: PlanName;
  /** Unix seconds; 0 for Free. */
  expiresAt: number;
  limits: PlanLimits;
  /** Agents this wallet created. */
  created: bigint[];
  /** Of `created`, the ones listed for rent. */
  listed: bigint[];
  /** Active rentals: agentId → expiry (unix seconds). */
  rentals: { agentId: bigint; expiresAt: number }[];
};

export type CatalogSource = {
  project: string;
  repo: string;
  path: string;
  lines: string;
  commit: string;
  license: string;
  url: string;
  owner?: string;
};

export type CatalogAgent = {
  id: string;
  name: string;
  tier: "basic" | "pro" | "vip";
  skills: string[];
  description: string;
  source: CatalogSource;
  changes: string[];
  steps: { name: string; instructions: string; source: CatalogSource }[];
};

/** A ready-to-run task a renter can start in one click (catalog/playbooks.json). */
export type Playbook = {
  title: string;
  /** What the renter gets out of it. */
  outcome: string;
  /** Job spec; example details are meant to be edited before running. */
  template: string;
};

/** A playbook stored in the PlaybookRegistry (published by the agent's creator). */
export type OnchainPlaybook = Playbook & {
  agentId: bigint;
  index: number;
  author: Address;
  updatedAt: number;
  active: boolean;
  /** Number of renters who marked it useful. */
  useful: number;
};

/** Playbook shown to renters: the creator's on-chain ones first, then AgentSurely starter tasks. */
export type PlaybookEntry = Playbook & ({ source: "creator"; onchain: OnchainPlaybook } | { source: "starter"; onchain?: undefined });

/** A ready-to-create job in a domain: pre-filled title/brief, up to 3 suggested catalog agents, a first task each. */
export type JobTemplate = {
  id: string;
  title: string;
  brief: string;
  /** Catalog ids (catalog/index.json). */
  agents: string[];
  /** catalog id → first task spec for that agent. */
  tasks: Record<string, string>;
};

export type Domain = {
  id: string;
  name: string;
  /** Vietnamese name. */
  vi: string;
  /** lucide icon name. */
  icon: string;
  /** Why people rent agents here. */
  demand: string;
  jobs: JobTemplate[];
};

/** A job on the JobBoard: a project in a domain staffed with rented agents. */
export type BoardJob = {
  id: bigint;
  owner: Address;
  createdAt: number;
  updatedAt: number;
  open: boolean;
  domain: string;
  title: string;
  brief: string;
  agents: bigint[];
};

export type JobLimits = { jobs: number; agentsPerJob: number; openJobs: number; unlimited: boolean };

export type PayTokenSymbol = "USDC";
export type PayToken = {
  symbol: PayTokenSymbol;
  address: Address;
  /** "contract" = call faucet() on the token; otherwise a URL to an external faucet. */
  faucet: "contract" | string;
};
