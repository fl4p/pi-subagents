import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { appendAdvertisedAgentPrompt, buildAdvertisedAgentPrompt } from "../../src/agents/advertised-agent-prompt.ts";
import type { AgentConfig } from "../../src/agents/agents.ts";

function agent(name: string, overrides: Partial<AgentConfig> = {}): AgentConfig {
	return {
		name,
		description: `${name} agent`,
		systemPrompt: `${name} prompt`,
		systemPromptMode: "replace",
		inheritProjectContext: false,
		inheritSkills: false,
		source: "project",
		filePath: `/tmp/${name}.md`,
		...overrides,
	};
}

describe("advertised agent prompt", () => {
	it("includes only opted-in, capability-permitted agents in stable order", () => {
		const prompt = buildAdvertisedAgentPrompt([
			agent("zeta", { advertise: true }),
			agent("hidden"),
			agent("disabled", { advertise: true, disabled: true }),
			agent("alpha", { advertise: true }),
		], {
			version: 1,
			allowedAgents: ["alpha", "hidden", "zeta"],
			denyExtensions: false,
			sources: ["test"],
		});

		assert.ok(prompt);
		assert.match(prompt, /<name>alpha<\/name>/);
		assert.match(prompt, /<name>zeta<\/name>/);
		assert.doesNotMatch(prompt, /hidden|disabled/);
		assert.ok(prompt.indexOf("alpha") < prompt.indexOf("zeta"));
	});

	it("escapes agent-owned metadata and bounds the catalog", () => {
		const agents = Array.from({ length: 18 }, (_, index) => agent(`agent-${String(index).padStart(2, "0")}`, {
			advertise: true,
			description: index === 0 ? `<route>&${"x".repeat(700)}` : `agent ${index}`,
		}));
		const prompt = buildAdvertisedAgentPrompt(agents);

		assert.ok(prompt);
		assert.match(prompt, /&lt;route&gt;&amp;/);
		assert.doesNotMatch(prompt, /<route>/);
		assert.match(prompt, /…<\/description>/);
		assert.match(prompt, /<omitted count="2" \/>/);
	});

	it("replaces an existing catalog instead of duplicating it", () => {
		const first = buildAdvertisedAgentPrompt([agent("alpha", { advertise: true })]);
		const second = buildAdvertisedAgentPrompt([agent("beta", { advertise: true })]);
		assert.ok(first);
		assert.ok(second);

		const systemPrompt = appendAdvertisedAgentPrompt(appendAdvertisedAgentPrompt("base prompt", first), second);
		assert.equal(systemPrompt.match(/<advertised_subagents>/gu)?.length, 1);
		assert.doesNotMatch(systemPrompt, /<name>alpha<\/name>/);
		assert.match(systemPrompt, /<name>beta<\/name>/);
	});

	it("returns no catalog when no agent opts in", () => {
		assert.equal(buildAdvertisedAgentPrompt([agent("hidden")]), undefined);
		assert.equal(appendAdvertisedAgentPrompt("base prompt\n\n", undefined), "base prompt\n\n");
	});

	it("admits an exact-budget canonical name and omits it one byte over", () => {
		const emptyName = buildAdvertisedAgentPrompt([agent("", { advertise: true, description: "small" })])!;
		const name = "x".repeat(12_288 - Buffer.byteLength(emptyName));
		const exact = buildAdvertisedAgentPrompt([agent(name, { advertise: true, description: "small" })])!;
		assert.equal(Buffer.byteLength(exact), 12_288);
		assert.ok(exact.includes(`<name>${name}</name>`));
		const over = buildAdvertisedAgentPrompt([agent(`${name}x`, { advertise: true, description: "small" })])!;
		assert.doesNotMatch(over, /<name>/);
		assert.match(over, /<omitted count="1"/);
	});

	it("withdraws a reused catalog when the last advertised agent disappears", () => {
		const prior = appendAdvertisedAgentPrompt("base prompt", buildAdvertisedAgentPrompt([agent("alpha", { advertise: true })]));
		assert.equal(appendAdvertisedAgentPrompt(prior, buildAdvertisedAgentPrompt([])), "base prompt");
	});

	it("handles string array systemPrompt gracefully", () => {
		const initial = ["section 1", "section 2"];
		const catalog = buildAdvertisedAgentPrompt([agent("alpha", { advertise: true })]);
		const withCatalog = appendAdvertisedAgentPrompt(initial, catalog);
		assert.ok(Array.isArray(withCatalog));
		assert.equal(withCatalog.length, 3);
		assert.equal(withCatalog[0], "section 1");
		assert.equal(withCatalog[1], "section 2");
		assert.match(withCatalog[2]!, /<name>alpha<\/name>/);

		const withoutCatalog = appendAdvertisedAgentPrompt(withCatalog, undefined);
		assert.ok(Array.isArray(withoutCatalog));
		assert.equal(withoutCatalog.length, 2);
		assert.equal(withoutCatalog[0], "section 1");
		assert.equal(withoutCatalog[1], "section 2");
	});

	it("handles undefined systemPrompt gracefully", () => {
		const catalog = buildAdvertisedAgentPrompt([agent("alpha", { advertise: true })]);
		assert.equal(appendAdvertisedAgentPrompt(undefined, catalog), catalog);
		assert.equal(appendAdvertisedAgentPrompt(undefined, undefined), undefined);
	});
});

describe("advertised agent prompt: roster variant", () => {
	it("ignores the advertise opt-in so agent names reach a minimal-schema model", () => {
		const prompt = buildAdvertisedAgentPrompt([
			agent("opted-in", { advertise: true }),
			agent("not-opted-in"),
		], undefined, "roster");
		assert.ok(prompt);
		assert.match(prompt, /<name>opted-in<\/name>/u);
		assert.match(prompt, /<name>not-opted-in<\/name>/u);
	});

	it("still honours disabled, runtime source and the capability ceiling", () => {
		const prompt = buildAdvertisedAgentPrompt([
			agent("kept"),
			agent("turned-off", { disabled: true }),
			agent("runtime-made", { source: "runtime" }),
			agent("out-of-ceiling"),
		], {
			version: 1,
			allowedAgents: ["kept", "turned-off", "runtime-made"],
			denyExtensions: false,
		} as never, "roster");
		assert.ok(prompt);
		assert.match(prompt, /<name>kept<\/name>/u);
		for (const excluded of ["turned-off", "runtime-made", "out-of-ceiling"]) {
			assert.doesNotMatch(prompt, new RegExp(`<name>${excluded}</name>`, "u"));
		}
	});

	it("never tells the model to preflight with an action the minimal schema removed", () => {
		const prompt = buildAdvertisedAgentPrompt([agent("solo")], undefined, "roster");
		assert.ok(prompt);
		assert.doesNotMatch(prompt, /action/u);
		assert.match(prompt, /external-cli/u);
	});

	it("tags external-cli agents in roster mode only", () => {
		const cli = agent("via-cli", { advertise: true, runner: { kind: "external-cli" } as never });
		const roster = buildAdvertisedAgentPrompt([cli], undefined, "roster");
		const advertised = buildAdvertisedAgentPrompt([cli], undefined);
		assert.ok(roster);
		assert.ok(advertised);
		assert.match(roster, /<kind>external-cli<\/kind>/u);
		assert.doesNotMatch(advertised, /<kind>external-cli<\/kind>/u);
	});

	it("leaves the default variant byte-identical to the pre-existing behaviour", () => {
		const agents = [agent("alpha", { advertise: true }), agent("beta")];
		assert.equal(
			buildAdvertisedAgentPrompt(agents, undefined),
			buildAdvertisedAgentPrompt(agents, undefined, "advertised"),
		);
	});
});

describe("advertised agent prompt: roster-compact variant", () => {
	it("carries name and description without per-agent XML scaffolding", () => {
		const prompt = buildAdvertisedAgentPrompt([agent("scout")], undefined, "roster-compact");
		assert.ok(prompt);
		assert.doesNotMatch(prompt, /<subagent>|<name>|<description>/u);
		assert.match(prompt, /^- scout: /mu);
		assert.match(prompt, /^<advertised_subagents>$/mu, "outer tag must stay so stale blocks are still stripped");
	});

	it("is materially smaller than the XML roster for the same agents", () => {
		const agents = Array.from({ length: 13 }, (_, i) => agent(`agent-${i}`, {
			description: "A reasonably wordy agent description of the kind real agents carry.",
		}));
		const xml = buildAdvertisedAgentPrompt(agents, undefined, "roster");
		const compact = buildAdvertisedAgentPrompt(agents, undefined, "roster-compact");
		assert.ok(xml && compact);
		assert.ok(compact.length < xml.length / 2, `${compact.length} should be < half of ${xml.length}`);
	});

	it("marks external-cli inline and truncates long descriptions", () => {
		const prompt = buildAdvertisedAgentPrompt([
			agent("via-cli", { runner: { kind: "external-cli" } as never, description: "x".repeat(300) }),
		], undefined, "roster-compact");
		assert.ok(prompt);
		assert.match(prompt, /- via-cli \[external-cli\]: /u);
		const line = prompt.split("\n").find((l) => l.startsWith("- via-cli"));
		assert.ok(line && line.length < 120, `entry line should be short, got ${line?.length}`);
	});

	it("still drops disabled agents and honours the ceiling", () => {
		const prompt = buildAdvertisedAgentPrompt([
			agent("kept"),
			agent("turned-off", { disabled: true }),
		], undefined, "roster-compact");
		assert.ok(prompt);
		assert.match(prompt, /- kept:/u);
		assert.doesNotMatch(prompt, /- turned-off:/u);
	});
});
