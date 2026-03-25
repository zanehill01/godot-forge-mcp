import { describe, it, expect } from "vitest";
import { parsePluginCfg, writePluginCfg, validatePluginCfg, generatePluginScaffold } from "../parser.js";

const SAMPLE = `[plugin]

name="My Plugin"
description="A cool plugin"
author="Dev"
version="1.2.0"
script="plugin.gd"
`;

describe("parsePluginCfg", () => {
	it("parses all fields", () => {
		const cfg = parsePluginCfg(SAMPLE);
		expect(cfg.name).toBe("My Plugin");
		expect(cfg.description).toBe("A cool plugin");
		expect(cfg.author).toBe("Dev");
		expect(cfg.version).toBe("1.2.0");
		expect(cfg.script).toBe("plugin.gd");
	});

	it("handles empty content", () => {
		const cfg = parsePluginCfg("");
		expect(cfg.name).toBe("");
	});
});

describe("writePluginCfg", () => {
	it("round-trips", () => {
		const cfg = parsePluginCfg(SAMPLE);
		const output = writePluginCfg(cfg);
		const reparsed = parsePluginCfg(output);
		expect(reparsed.name).toBe(cfg.name);
		expect(reparsed.version).toBe(cfg.version);
	});
});

describe("validatePluginCfg", () => {
	it("passes valid config", () => {
		const cfg = parsePluginCfg(SAMPLE);
		expect(validatePluginCfg(cfg)).toHaveLength(0);
	});

	it("catches missing fields", () => {
		const issues = validatePluginCfg({ name: "", description: "", author: "", version: "", script: "" });
		expect(issues.length).toBeGreaterThan(0);
	});
});

describe("generatePluginScaffold", () => {
	it("generates plugin.cfg and plugin.gd", () => {
		const files = generatePluginScaffold({
			name: "Test Plugin",
			description: "Test",
			author: "Me",
			version: "1.0.0",
			script: "plugin.gd",
		});
		expect(files["plugin.cfg"]).toContain("Test Plugin");
		expect(files["plugin.gd"]).toContain("@tool");
		expect(files["plugin.gd"]).toContain("extends EditorPlugin");
	});
});
