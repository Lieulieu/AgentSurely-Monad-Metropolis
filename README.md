<p align="center"><img src="docs/brand/agentsurely-logo-light.svg" alt="AgentSurely" width="320"></p>

# AgentSurely

> Chủ biên / Editor-in-chief: **Nguyễn Thị Liễu** · Formerly *AgentSurety* (renamed in upgrade-02 — see [`docs/upgrade-02`](docs/upgrade-02/00-OVERVIEW.md)).

**Performance bonds for ERC-8004 AI agents on Monad, verified by a Chainlink CRE workflow.**

Agents post a stablecoin bond. Clients hire them with *coverage*: part of the bond is locked for that job.
When the agent delivers, a Chainlink CRE workflow reads the output from Monad, runs deterministic checks
and an LLM judge (DON median), and writes a signed verdict back. Pass → the agent is paid. Fail or
missed deadline → the client receives the coverage plus a full refund.

> Track: **Trust, Identity & AI Infrastructure** · Bounties: Chainlink CRE, Qwen / Kimi, Dynamic (planned)

```
          ┌──────────── Monad ────────────┐            ┌──────── Chainlink CRE (surely-judge) ────────┐
 client ─▶│ SurelyVault.createJob          │            │ 1 log trigger  ResultSubmitted               │
 agent  ─▶│ SurelyVault.submitResult ──────┼─ event ──▶ │ 2 EVM read     getJobForVerification          │
          │                                │            │ 3 checks       state · keccak(spec/output)    │
          │ ERC-8004 IdentityRegistry      │            │ 4 HTTP         LLM judge, median across nodes │──▶ Qwen / Kimi / OpenAI
          │                                │◀─ report ──│ 5 report       abi.encode(jobId,score,…)      │
          │ onReport → pay agent | slash   │            │ 6 EVM write    KeystoneForwarder → onReport   │
          └────────────────────────────────┘            └───────────────────────────────────────────────┘
```

![AgentSurely](docs/screenshots/home.png)

## Live on Monad testnet

| | |
|---|---|
| SurelyVault | [`0x699e24B7CAf01Ff66F2d54F840b973c8139d28cA`](https://testnet.monadexplorer.com/address/0x699e24B7CAf01Ff66F2d54F840b973c8139d28cA) |
| ERC-8004 Identity / Reputation | canonical `0x8004A818…BD9e` / `0x8004B663…8713` · Validation `0x768d058e…E4dc` |
| CRE + OpenAI judge: PASS 100/70 (job #2) | [`0x75da49f6…2463`](https://testnet.monadexplorer.com/tx/0x75da49f69e4014597b1c21e1449f609db21c9002937c4629ab4ad413b1802463) |
| CRE + OpenAI judge: FAIL 0/70 → 400 mUSD slashed (job #3) | [`0xc762a99f…a354`](https://testnet.monadexplorer.com/tx/0xc762a99f55dc8f73812f8cf7efb13d83d008af3d21b1a24c66e5268350cda354) |
| Judge accuracy (gpt-4.1-mini, 10 labelled cases) | **10/10** — [`docs/judge-eval.md`](docs/judge-eval.md) |

Full table: [`docs/ONCHAIN-PROOF.md`](docs/ONCHAIN-PROOF.md). Re-run everything on Windows: `scripts\run-cre-monad.cmd`.

## Plans: create, list for rent, rent (upgrade 02)

| Plan | Price (onchain, USDC) | Create agents | List for rent | Rent agents (max) |
|---|---|---|---|---|
| **Free** | 0 | 3 (test only — only you can hire them) | 0 | 3 |
| **PRO** | 5 / 30 days | 5 | 5 | 50 |
| **VIP** | 30 / 30 days | 30 | 30 | 300 |

Money is **USDC** (Circle testnet USDC on Monad): bonds, fees, coverage, plans and rentals. **mUSD is only a reward** — 10 mUSD per passed job, paid by `SurelyVault`.

Rent: **1 USDC per agent per 30 days** — 90% to the agent's creator, 10% to the AgentSurely treasury.
`SubscriptionManager` is the vault's hire gate: you can hire an agent you created, or one you rent.
Details: [`docs/upgrade-02`](docs/upgrade-02/00-OVERVIEW.md).

## Agent catalog (upgrade 01)

Sign in with your wallet and pick from **20 bonded agents ported from 10 open-source projects** (OpenAI Agents SDK,
LangGraph, AutoGen, smolagents, Google ADK samples, Claude Cookbooks, elizaOS, Coinbase AgentKit, Olas mech tools,
Pydantic AI — MIT / Apache-2.0, every agent links its exact file, commit and license).

Catalog agents are listed for rent by the platform wallet (`unlimited`) at the same $1 / 30 days. The basic / pro / vip
labels only describe the agent (and its bond size) — any plan can rent any listed agent. Plan: [`docs/upgrade-01/00-PLAN.md`](docs/upgrade-01/00-PLAN.md) · sources: [`01-SOURCES.md`](docs/upgrade-01/01-SOURCES.md) ·
results: [`02-RESULTS.md`](docs/upgrade-01/02-RESULTS.md) · notices: [`catalog/THIRD_PARTY_NOTICES.md`](catalog/THIRD_PARTY_NOTICES.md).

```bash
npm run catalog:register            # register + bond + list the catalog for rent (add -- --chain monad)
npm run catalog:run                 # operate catalog agents with the LLM
npm run catalog:demo                # Free → rent 3 agents → 4th blocked → hire → PRO → rent + hire
```

## Who uses it

Agent builders (bond to win clients), agent marketplaces (embed `hire()` with coverage), clients and DAOs (automatic
refund + coverage on failure), orchestrator agents (bonded subcontracting), evaluation providers (plug a model into the
CRE judge) and underwriters (price risk from public slash history). Builders never hand over their agent — it stays on
their infrastructure; AgentSurely only verifies deliverables.

- Market analysis and 10 comparable projects (Virtuals ACP, Olas, UMA, Kleros, EigenLayer, Bittensor, Sherlock, Armilla,
  Munich Re / AIUC…): [`docs/01-MARKET.md`](docs/01-MARKET.md)
- What enterprises and builders need before trusting it, target architecture, gap analysis and roadmap:
  [`docs/02-TRUST-ARCHITECTURE.md`](docs/02-TRUST-ARCHITECTURE.md)
- Does the market need it, why agents bond, why trust the platform (economics, objections, 30-day demand tests):
  [`docs/03-WHY-BOND-AND-TRUST.md`](docs/03-WHY-BOND-AND-TRUST.md)
- Six more services agents would pay for (pre-submit check, skill certification, fair-exchange delivery, get-paid-now,
  SLA bonds for APIs/MCP servers, mandate bonds): [`docs/04-AGENT-SERVICES.md`](docs/04-AGENT-SERVICES.md)

## Repository

| Path | What | Stack |
|---|---|---|
| `contracts/` | `SurelyVault` (bonds, escrow, CRE receiver), mock ERC-8004 registry, mock USD | Solidity 0.8.24, Hardhat, OpenZeppelin 5 |
| `cre/surely-judge/` | CRE workflow — the orchestration layer | `@chainlink/cre-sdk` (TypeScript → WASM), viem, zod |
| `sdk/` | `AgentSurelyClient` + local judge relayer, demo agent, demo hire | TypeScript, viem |
| `app/` | Web app (agents, hire, jobs, live verdicts) | Next.js 15, React 19, wagmi 2, Tailwind |
| `docs/` | Architecture, Monad/CRE deploy guide (Windows), submission kit, 4-day plan, judge eval | |

## Quick start (local, ~3 minutes)

Requires Node ≥ 20. For the CRE workflow also [Bun](https://bun.sh) ≥ 1.2.21 and the [CRE CLI](https://docs.chain.link/cre/getting-started/cli-installation).

```bash
npm install
npm run chain                 # terminal 1 — Hardhat node on :8545
npm run deploy:local          # deploy + seed 3 agents + 1 job + sync ABIs into the SDK
npm run judge:local                        # terminal 2 — local verifier (same logic as the CRE workflow)
npm run agent:demo -- --agent 1            # terminal 3 — demo agent does the work and submits
npm run agent:demo -- --agent 3 --lazy     # terminal 4 — bad agent, to demo slashing
cp app/.env.example app/.env.local && npm run dev   # http://localhost:3000
npm run hire -- --agent 3 "Translate into Vietnamese: 'Hire AI agents that put money behind their work.'"
```

All scripts take `--flags` instead of env-var prefixes, so they run unchanged in Windows PowerShell.
Step-by-step for Windows, Monad testnet, CRE and Vercel: [`docs/DEPLOY-MONAD-WINDOWS.md`](docs/DEPLOY-MONAD-WINDOWS.md).

Add the Hardhat network (RPC `http://127.0.0.1:8545`, chain id 31337) and private key #0 to MetaMask.

No LLM key? Everything runs with a deterministic mock judge. Set `LLM_API_KEY` (any OpenAI-compatible
endpoint; default is Qwen via DashScope) to use a real model.

## Monad testnet

```bash
cp contracts/.env.example contracts/.env      # PRIVATE_KEY funded from https://faucet.monad.xyz
npm run preflight:monad                       # RPC, balance, deployment and forwarder checks
npm run deploy:monad                          # deploy + sync SDK + write vaultAddress into the CRE configs
npm run seed:monad                            # optional demo data
npm run judge:monad                           # relayer mode until the CRE forwarder is set
echo "NEXT_PUBLIC_CHAIN_ID=10143" > app/.env.local && npm run build && npm start -w @agentsurely/app
```

## Chainlink CRE workflow

```bash
cd cre/surely-judge && bun install            # runs cre-setup (Javy plugin)
bun test                                      # 6 unit tests with CRE capability mocks
# vaultAddress is filled by deploy:monad; LLM key in ../.env (or keep llm.mode = "mock")
cd .. && cre workflow simulate surely-judge --target staging-settings
#   → EVM log trigger: paste the tx hash of a submitResult() call, event index 0
#   → or the cron trigger (staging only): verifies the oldest job waiting in the last `scanWindow` jobs
cre workflow simulate surely-judge --target staging-settings --broadcast   # writes the verdict on Monad
```

For `--broadcast` (and a deployed workflow) the vault must accept reports from the CRE forwarder on
`monad-testnet`. Look up the address in the CRE docs *Forwarder Directory*, then:

```bash
# add FORWARDER_ADDRESS=0x… to contracts/.env
npm run forwarder:monad
```

Why it is a meaningful use of CRE: the workflow is the *only* thing that can move funds after delivery.
It connects Monad (log trigger, contract read, report write) with an external LLM API, and uses DON
consensus (median score) so no single server decides whether an agent is paid or slashed.

## ERC-8004 integration

| Registry | Monad testnet | What AgentSurely does |
|---|---|---|
| Identity | canonical `0x8004A818BFB912233c491871b3d84c89A494BD9e` | agents are ERC-8004 NFTs; only the owner can bond / deliver |
| Reputation | canonical `0x8004B663056A597Dffe9eCcC1965A193B7388713` | every verdict → `giveFeedback(agentId, score, 0, "agentsurely", "pass"/"fail"/"expired", …, reportHash)` from the vault |
| Validation | `ValidationRegistry.sol` (spec-shaped; no canonical deployment yet) | SDK opens `validationRequest(vault, …)` before delivery; vault answers `validationResponse(requestHash, score, …)` |

Registry writes are `try/catch`: a failure emits `RegistryPublishFailed` and never blocks payment or slashing.
Deploy in one command on Windows: `powershell -ExecutionPolicy Bypass -File scripts\deploy-monad.ps1` ([guide](docs/DEPLOY-MONAD-WINDOWS.md)).

## SDK

```ts
import { AgentSurelyClient, toUnits } from "@agentsurely/sdk";

const sdk = new AgentSurelyClient({ publicClient, walletClient });
const agentId = await sdk.registerAgent({ name: "ResearchBot", skills: ["research"] });
await sdk.depositBond(agentId, toUnits(5_000));
const jobId = await sdk.hire({ agentId, spec: "…", fee: toUnits(25), coverage: toUnits(500),
  deadline: Math.floor(Date.now() / 1000) + 86_400, minScore: 70 });
```

## Settlement rules

| Event | Result |
|---|---|
| Score ≥ `minScore` | Fee → agent owner; coverage unlocked; `passed++` |
| Score < `minScore` | Coverage + fee → client; bond reduced; `failed++` |
| Deadline missed | `claimExpired` (anyone) — same as fail |
| No verdict within 1h | `refundUnverified` — fee back, no slash |
| Withdraw bond | 24h delay; queued amount stays slashable |

## Tests

```bash
npm test                                      # Hardhat (18 tests) + SDK and app typecheck
cd cre/surely-judge && bun test               # CRE workflow (6 tests)
npm run eval:judge -- --mock                  # judge accuracy on 10 labelled cases
```

Offline / firewalled machines: `HARDHAT_SOLCJS=1 npm test` compiles with the solc npm package.

## UI theme

All colors, radii and fonts come from `app/src/styles/theme.css` (Chainlink-inspired palette). Replace
the values there with the tokens from `docs/ui-style` to restyle the whole app.

## Status / next

- [x] Contracts + tests, local end-to-end loop, CRE workflow compiled to WASM with unit tests
- [x] Cron fallback trigger, Windows-friendly scripts, Monad preflight, judge eval set, submission kit
- [x] Deployed to Monad testnet; `cre workflow simulate --broadcast` PASS + FAIL/slash verdicts onchain ([proof](docs/ONCHAIN-PROOF.md))
- [x] Canonical ERC-8004 Identity + Reputation registries; verdicts published to Reputation + Validation
- [x] Live LLM judge (OpenAI gpt-4.1-mini) through CRE, 10/10 on the eval set; Qwen / Kimi via `run-cre-monad.cmd live qwen|kimi`
- [ ] Vercel deployment, demo videos
- [ ] Dynamic embedded wallets; agent-to-agent hiring via the SDK
