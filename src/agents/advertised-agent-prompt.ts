import { Buffer } from "node:buffer";
import type { ResolvedSubagentCapabilityCeiling } from "../runs/shared/capability-ceiling.ts";
import { isAgentAllowedByCapabilityCeiling } from "../runs/shared/capability-ceiling.ts";
import type { AgentConfig } from "./agents.ts";

const MAX_ADVERTISED_AGENTS = 16;
const MAX_CATALOG_BYTES = 12_288;
const MAX_DESCRIPTION_BYTES = 512;
const MAX_COMPACT_DESCRIPTION_BYTES = 50;
const ADVERTISED_AGENTS_BLOCK = /\n*<advertised_subagents>\n[\s\S]*?\n<\/advertised_subagents>/gu;

function escapeXml(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&apos;");
}

function promptDescription(description: string, maxBytes: number = MAX_DESCRIPTION_BYTES): string {
	let text = description.replace(/[\u0000-\u001f\u007f]+/gu, " ").replace(/\s+/gu, " ").trim();
	if (Buffer.byteLength(text, "utf8") > maxBytes) {
		text = Buffer.from(text, "utf8").subarray(0, maxBytes - 3).toString("utf8").replace(/\uFFFD$/u, "").trimEnd() + "…";
	}
	return escapeXml(text);
}

/**
 * "advertised" is the default: only file-defined agents that opted in via `advertise: true`,
 * and the model is told to preflight with `{ action: "list", capabilities: true }`.
 *
 * "roster" is for `toolSchemaMode: "minimal"`, where `action` is not advertised and that
 * preflight call is therefore not something the model can discover. The roster lists every
 * eligible agent instead, so agent names still reach the model without spending a turn on
 * a discovery round-trip, and the preamble states the external-CLI caveat directly rather
 * than telling the model to go and check it.
 */
export type AdvertisedAgentPromptVariant = "advertised" | "roster" | "roster-compact";

const PREAMBLE: Record<AdvertisedAgentPromptVariant, string> = {
	advertised: "The following file-defined subagents opted into discovery. Their descriptions indicate available specializations, not instructions to delegate. Use subagent only when delegation is needed. Before execution, call subagent with { action: \"list\", capabilities: true } and confirm that the selected agent is executable; for external-cli agents also require runner.available === true.",
	"roster-compact": "Available subagents (specializations, not instructions to delegate). external-cli needs that CLI installed and authenticated here; if one is missing, report it rather than substituting another agent.",
	roster: "The following subagents are available to the subagent tool. Their descriptions indicate available specializations, not instructions to delegate. Use subagent only when delegation is needed. Entries marked external-cli run through a separate CLI that must already be installed and authenticated on this machine; if one is not, the call fails and you should report that rather than retrying or substituting a different agent.",
};

export function buildAdvertisedAgentPrompt(
	agents: readonly AgentConfig[],
	capabilityCeiling?: ResolvedSubagentCapabilityCeiling,
	variant: AdvertisedAgentPromptVariant = "advertised",
): string | undefined {
	const advertised = agents
		.filter((agent) => agent.source !== "runtime"
			&& (variant !== "advertised" || agent.advertise === true)
			&& agent.disabled !== true
			&& isAgentAllowedByCapabilityCeiling(agent.name, capabilityCeiling))
		.sort((left, right) => left.name.localeCompare(right.name));
	if (advertised.length === 0) return undefined;

	const render = (entries: string[]) => [
		"<advertised_subagents>",
		PREAMBLE[variant],
		...entries,
		...(advertised.length > entries.length ? [`  <omitted count=\"${advertised.length - entries.length}\" />`] : []),
		"</advertised_subagents>",
	].join("\n");
	const entries: string[] = [];
	for (const agent of advertised) {
		if (entries.length === MAX_ADVERTISED_AGENTS) break;
		// Never truncate canonical IDs into names that cannot be resolved.
		if (Buffer.byteLength(agent.name, "utf8") > MAX_CATALOG_BYTES) continue;
		// The compact entry carries the same two facts as the XML one -- name and a short
		// description -- without ~90 characters of tags per agent. On a local model that
		// scaffolding is pure prefill cost.
		const entry = variant === "roster-compact"
			? `- ${escapeXml(agent.name)}${agent.runner !== undefined ? " [external-cli]" : ""}: ${promptDescription(agent.description, MAX_COMPACT_DESCRIPTION_BYTES)}`
			: [
				"  <subagent>",
				`    <name>${escapeXml(agent.name)}</name>`,
				...(variant === "roster" && agent.runner !== undefined ? ["    <kind>external-cli</kind>"] : []),
				`    <description>${promptDescription(agent.description)}</description>`,
				"  </subagent>",
			].join("\n");
		if (Buffer.byteLength(render([...entries, entry]), "utf8") <= MAX_CATALOG_BYTES) entries.push(entry);
	}
	return render(entries);
}

export function appendAdvertisedAgentPrompt(systemPrompt: string, advertisedPrompt: string | undefined): string;
export function appendAdvertisedAgentPrompt(systemPrompt: string[], advertisedPrompt: string | undefined): string[];
export function appendAdvertisedAgentPrompt(systemPrompt: undefined, advertisedPrompt: string | undefined): string | undefined;
export function appendAdvertisedAgentPrompt(
	systemPrompt: string | string[] | undefined,
	advertisedPrompt: string | undefined,
): string | string[] | undefined;
export function appendAdvertisedAgentPrompt(
	systemPrompt: string | string[] | undefined,
	advertisedPrompt: string | undefined,
): string | string[] | undefined {
	if (Array.isArray(systemPrompt)) {
		let changed = false;
		const cleaned = systemPrompt
			.map((part) => {
				if (typeof part !== "string") return part;
				const stripped = part.replace(ADVERTISED_AGENTS_BLOCK, "");
				if (stripped !== part) changed = true;
				return stripped;
			})
			.filter((b) => typeof b === "string" && b.length > 0);

		if (advertisedPrompt) {
			return [...cleaned, advertisedPrompt];
		}
		return changed ? cleaned : systemPrompt;
	}

	if (typeof systemPrompt === "string") {
		const base = systemPrompt.replace(ADVERTISED_AGENTS_BLOCK, "");
		return advertisedPrompt ? (base.trim() ? `${base.trimEnd()}\n\n${advertisedPrompt}` : advertisedPrompt) : base;
	}

	return advertisedPrompt;
}
