import { describe, it, expect } from "vitest";
import { parseExportPresets, validateExportPresets, generateGodotCIWorkflow } from "../parser.js";

const SAMPLE = `
[preset.0]

name="Windows Desktop"
platform="Windows Desktop"
runnable=true
export_path="builds/game.exe"

[preset.0.options]

binary_format/embed_pck=false

[preset.1]

name="Linux"
platform="Linux"
runnable=false
export_path="builds/game.x86_64"

[preset.1.options]

binary_format/embed_pck=true
`;

describe("parseExportPresets", () => {
	it("parses multiple presets", () => {
		const result = parseExportPresets(SAMPLE);
		expect(result.presets).toHaveLength(2);
		expect(result.presets[0].name).toBe("Windows Desktop");
		expect(result.presets[0].runnable).toBe(true);
		expect(result.presets[1].name).toBe("Linux");
	});

	it("parses options", () => {
		const result = parseExportPresets(SAMPLE);
		expect(result.presets[0].options["binary_format/embed_pck"]).toBe(false);
		expect(result.presets[1].options["binary_format/embed_pck"]).toBe(true);
	});

	it("handles empty content", () => {
		const result = parseExportPresets("");
		expect(result.presets).toHaveLength(0);
	});
});

describe("validateExportPresets", () => {
	it("validates good presets", () => {
		const result = parseExportPresets(SAMPLE);
		const issues = validateExportPresets(result);
		expect(issues).toHaveLength(0);
	});

	it("catches empty presets", () => {
		const issues = validateExportPresets({ presets: [] });
		expect(issues).toContain("No export presets configured");
	});
});

describe("generateGodotCIWorkflow", () => {
	it("generates valid YAML structure", () => {
		const presets = parseExportPresets(SAMPLE);
		const workflow = generateGodotCIWorkflow(presets);
		expect(workflow).toContain("name: Godot Export");
		expect(workflow).toContain("Windows Desktop");
		expect(workflow).toContain("--export-release");
	});
});
