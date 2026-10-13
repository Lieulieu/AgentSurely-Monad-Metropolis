/** Offline checks for the catalog: provenance fields, placeholders, step wiring. npm run catalog:selftest */
import assert from "node:assert/strict";
import { catalog } from "../src/generated/catalog";
import { buildStepMessages, fillPlaceholders, runCatalogAgent } from "../src/catalog-core";

const tiers = { basic: 0, pro: 0, vip: 0 };
const projects = new Set<string>();
for (const a of catalog) {
  tiers[a.tier]++;
  projects.add(a.source.project);
  assert.ok(a.changes.length > 0, `${a.id}: changes`);
  for (const s of a.steps) {
    assert.match(s.source.commit, /^[0-9a-f]{40}$/, `${a.id}: commit`);
    assert.match(s.source.license, /MIT|Apache-2\.0/, `${a.id}: license`);
    assert.ok(s.source.url.startsWith(s.source.repo + "/blob/" + s.source.commit), `${a.id}: permalink`);
    assert.ok(s.instructions.includes("AgentSurely runtime"), `${a.id}: adapter`);
  }
}
assert.equal(projects.size, 10, "10 sources");
assert.ok(tiers.basic >= 3, "at least 3 basic agents for the Free plan");

assert.equal(fillPlaceholders("Q: {question} on {today}; reqs={reqs}; x={DB_SCHEMA}", { spec: "S", today: "D", previous: "P" }), "Q: S on D; reqs=P; x=(see TASK)");
const multi = catalog.find((a) => a.steps.length > 1)!;
const m = buildStepMessages(multi, 1, "spec", { name: multi.steps[0].name, output: "draft" });
assert.ok(m[1].content.includes("OUTPUT OF THE PREVIOUS STEP") && m[1].content.includes("draft"));

(async () => {
  const calls: number[] = [];
  const out = await runCatalogAgent(multi, "spec", async (msgs) => (calls.push(msgs.length), `out${calls.length}`));
  assert.equal(calls.length, multi.steps.length);
  assert.equal(out, `out${multi.steps.length}`);
  console.log(`catalog selftest ok · ${catalog.length} agents (basic ${tiers.basic}, pro ${tiers.pro}, vip ${tiers.vip}) from ${projects.size} sources`);
})();
