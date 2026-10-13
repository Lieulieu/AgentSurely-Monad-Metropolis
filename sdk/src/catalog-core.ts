/**
 * Pure helpers that turn a catalog agent (catalog/index.json) into LLM calls.
 * Shared by the catalog runner and its self-test; no network or chain access.
 */
import type { CatalogAgent } from "./types";

export type ChatMessage = { role: "system" | "user"; content: string };

const SPEC_KEYS = ["original_task", "question", "user_prompt", "query", "task"];
const PREV_KEYS = ["reqs", "sub_questions", "briefing", "additional_information", "evidence"];

/** Fills upstream template variables (see docs/upgrade-01/01-SOURCES.md, "Runtime placeholders"). */
export function fillPlaceholders(text: string, ctx: { spec: string; previous?: string; today: string }): string {
  return text.replace(/\{([A-Za-z_][A-Za-z0-9_.()]*)\}/g, (_m, key: string) => {
    if (SPEC_KEYS.includes(key)) return ctx.spec;
    if (key === "today" || key === "date.today()") return ctx.today;
    if (PREV_KEYS.includes(key)) return ctx.previous?.trim() || "(none provided — use your own knowledge and say what is missing)";
    return "(see TASK)";
  });
}

/** Messages for step `index` of an agent, given the previous step's output. */
export function buildStepMessages(
  agent: CatalogAgent,
  index: number,
  spec: string,
  previous: { name: string; output: string } | undefined,
  today = new Date().toISOString().slice(0, 10)
): ChatMessage[] {
  const step = agent.steps[index];
  const system = fillPlaceholders(step.instructions, { spec, previous: previous?.output, today });
  let user = `TASK:\n${spec}`;
  if (previous) user += `\n\nOUTPUT OF THE PREVIOUS STEP (${previous.name}):\n${previous.output}`;
  if (index < agent.steps.length - 1) user += `\n\nThis is step ${index + 1} of ${agent.steps.length} (${step.name}); a later step will produce the final deliverable.`;
  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}

/** SurelyVault stores at most 4096 bytes (UTF-8) of output. */
export function fitBytes(text: string, max = 3800): string {
  const enc = new TextEncoder();
  let out = text;
  while (enc.encode(out).length > max) out = out.slice(0, Math.floor(out.length * 0.95));
  return out;
}

/** Runs all steps with the given chat function and returns the final deliverable. */
export async function runCatalogAgent(
  agent: CatalogAgent,
  spec: string,
  chat: (messages: ChatMessage[]) => Promise<string>,
  onStep?: (name: string, output: string) => void
): Promise<string> {
  let previous: { name: string; output: string } | undefined;
  for (let i = 0; i < agent.steps.length; i++) {
    const output = (await chat(buildStepMessages(agent, i, spec, previous))).trim();
    onStep?.(agent.steps[i].name, output);
    previous = { name: agent.steps[i].name, output };
  }
  return fitBytes(previous?.output ?? "");
}

/** ERC-8004 registration file for a catalog agent, with source attribution. */
export function catalogAgentUri(agent: CatalogAgent): string {
  const profile = {
    type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
    name: agent.name,
    description: agent.description,
    skills: agent.skills,
    catalogId: agent.id,
    tier: agent.tier,
    operator: "AgentSurely catalog",
    source: {
      project: agent.source.project,
      repo: agent.source.repo,
      commit: agent.source.commit,
      license: agent.source.license,
      url: agent.source.url,
    },
  };
  return `data:application/json,${encodeURIComponent(JSON.stringify(profile))}`;
}
