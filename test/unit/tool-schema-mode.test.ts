import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createSubagentParamsSchema, MINIMAL_SUBAGENT_PARAM_KEYS } from "../../src/extension/schemas.ts";
import {
	buildSubagentToolDescription,
	DEFAULT_SUBAGENT_TOOL_DESCRIPTION,
	MINIMAL_SUBAGENT_TOOL_DESCRIPTION,
	resolveToolSchemaMode,
} from "../../src/extension/tool-description.ts";

const ENV_KEY = "PI_SUBAGENTS_TOOL_SCHEMA";

function propertyNames(schema: unknown): string[] {
	const properties = (schema as { properties?: Record<string, unknown> }).properties ?? {};
	return Object.keys(properties).sort();
}

function withEnv<T>(value: string | undefined, run: () => T): T {
	const previous = process.env[ENV_KEY];
	if (value === undefined) delete process.env[ENV_KEY];
	else process.env[ENV_KEY] = value;
	try {
		return run();
	} finally {
		if (previous === undefined) delete process.env[ENV_KEY];
		else process.env[ENV_KEY] = previous;
	}
}

describe("toolSchemaMode", () => {
	it("returns the unchanged full schema when called without config", () => {
		withEnv(undefined, () => {
			assert.equal(propertyNames(createSubagentParamsSchema()).length, propertyNames(createSubagentParamsSchema({})).length);
			assert.ok(propertyNames(createSubagentParamsSchema()).includes("action"));
		});
	});

	it("keeps the full schema for an unset or explicit full mode", () => {
		withEnv(undefined, () => {
			const full = propertyNames(createSubagentParamsSchema({}));
			assert.deepEqual(propertyNames(createSubagentParamsSchema({ toolSchemaMode: "full" })), full);
			assert.ok(full.length > MINIMAL_SUBAGENT_PARAM_KEYS.length);
		});
	});

	it("registers only the execution keep-list in minimal mode", () => {
		withEnv(undefined, () => {
			const minimal = propertyNames(createSubagentParamsSchema({ toolSchemaMode: "minimal" }));
			assert.deepEqual(minimal, [...MINIMAL_SUBAGENT_PARAM_KEYS].sort());
			assert.ok(!minimal.includes("action"));
		});
	});

	it("keeps top-level descriptions for the kept properties", () => {
		withEnv(undefined, () => {
			const properties = (createSubagentParamsSchema({ toolSchemaMode: "minimal" }) as { properties: Record<string, { description?: string }> }).properties;
			assert.equal(typeof properties.agent.description, "string");
			assert.equal(typeof properties.task.description, "string");
		});
	});

	it("lets the environment variable win over config", () => {
		withEnv("minimal", () => {
			assert.equal(resolveToolSchemaMode({ toolSchemaMode: "full" }), "minimal");
			assert.ok(!propertyNames(createSubagentParamsSchema({ toolSchemaMode: "full" })).includes("action"));
		});
		withEnv("full", () => {
			assert.equal(resolveToolSchemaMode({ toolSchemaMode: "minimal" }), "full");
		});
	});

	it("warns and falls back to full for invalid values", () => {
		const warnings: string[] = [];
		const options = { warn: (message: string) => warnings.push(message) };
		withEnv(undefined, () => {
			assert.equal(resolveToolSchemaMode({ toolSchemaMode: "minmal" as never }, options), "full");
		});
		withEnv("minmal", () => {
			assert.equal(resolveToolSchemaMode({}, options), "full");
		});
		assert.equal(warnings.length, 2);
		assert.ok(warnings.every((message) => message.includes("minmal")));
	});

	it("registers a short description in minimal mode", () => {
		withEnv(undefined, () => {
			assert.equal(buildSubagentToolDescription({ toolSchemaMode: "minimal" }), MINIMAL_SUBAGENT_TOOL_DESCRIPTION);
			assert.equal(buildSubagentToolDescription({}), DEFAULT_SUBAGENT_TOOL_DESCRIPTION);
			assert.ok(Buffer.byteLength(MINIMAL_SUBAGENT_TOOL_DESCRIPTION) < Buffer.byteLength(DEFAULT_SUBAGENT_TOOL_DESCRIPTION) / 2);
		});
	});
});

describe("toolSchemaMode: tiny", () => {
	it("registers only the tiny keep-list", () => {
		const schema = createSubagentParamsSchema({ toolSchemaMode: "tiny" }) as unknown as { properties: Record<string, unknown> };
		assert.deepEqual(
			Object.keys(schema.properties).sort(),
			["agent", "async", "cwd", "output", "outputSchema", "task", "timeoutMs", "workflowScript"],
		);
	});

	it("drops the config-equivalent overrides that minimal keeps", () => {
		const tiny = createSubagentParamsSchema({ toolSchemaMode: "tiny" }) as unknown as { properties: Record<string, unknown> };
		const minimal = createSubagentParamsSchema({ toolSchemaMode: "minimal" }) as unknown as { properties: Record<string, unknown> };
		for (const dropped of ["model", "thinking", "fast", "context"]) {
			assert.ok(dropped in minimal.properties, `${dropped} should be in minimal`);
			assert.ok(!(dropped in tiny.properties), `${dropped} should not be in tiny`);
		}
		// tiny is a strict subset of minimal
		for (const key of Object.keys(tiny.properties)) assert.ok(key in minimal.properties, `${key} missing from minimal`);
	});

	it("ships a description shorter than minimal's", () => {
		const tiny = buildSubagentToolDescription({ toolSchemaMode: "tiny" });
		const minimal = buildSubagentToolDescription({ toolSchemaMode: "minimal" });
		assert.ok(tiny.length < minimal.length, `${tiny.length} should be < ${minimal.length}`);
		assert.match(tiny, /workflowScript/u);
	});

	it("accepts tiny from the environment and from config", () => {
		const previous = process.env.PI_SUBAGENTS_TOOL_SCHEMA;
		try {
			process.env.PI_SUBAGENTS_TOOL_SCHEMA = "tiny";
			assert.equal(resolveToolSchemaMode({}), "tiny");
		} finally {
			if (previous === undefined) delete process.env.PI_SUBAGENTS_TOOL_SCHEMA;
			else process.env.PI_SUBAGENTS_TOOL_SCHEMA = previous;
		}
		assert.equal(resolveToolSchemaMode({ toolSchemaMode: "tiny" }), "tiny");
	});
});
