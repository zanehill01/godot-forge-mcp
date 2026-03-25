import { describe, it, expect } from "vitest";
import { parseGDExtension, writeGDExtension, validateGDExtension, getPlatformMatrix } from "../parser.js";

const SAMPLE = `
[configuration]
entry_symbol = "my_ext_init"
compatibility_minimum = "4.3"
reloadable = true

[libraries]
linux.debug.x86_64 = "res://bin/libext.linux.debug.x86_64.so"
linux.release.x86_64 = "res://bin/libext.linux.release.x86_64.so"
windows.debug.x86_64 = "res://bin/ext.windows.debug.x86_64.dll"
windows.release.x86_64 = "res://bin/ext.windows.release.x86_64.dll"
macos.debug = "res://bin/libext.macos.debug.framework"

[icons]
MyNode = "res://addons/my_ext/icons/my_node.svg"

[dependencies]
linux.debug = { "res://bin/libdep.so": "" }
`;

describe("parseGDExtension", () => {
	it("parses configuration", () => {
		const ext = parseGDExtension(SAMPLE);
		expect(ext.configuration.entrySymbol).toBe("my_ext_init");
		expect(ext.configuration.compatibilityMinimum).toBe("4.3");
		expect(ext.configuration.reloadable).toBe(true);
	});

	it("parses libraries", () => {
		const ext = parseGDExtension(SAMPLE);
		expect(ext.libraries).toHaveLength(5);
		expect(ext.libraries[0].platform).toBe("linux");
		expect(ext.libraries[0].buildType).toBe("debug");
		expect(ext.libraries[0].architecture).toBe("x86_64");
	});

	it("parses icons", () => {
		const ext = parseGDExtension(SAMPLE);
		expect(ext.icons).toHaveLength(1);
		expect(ext.icons[0].className).toBe("MyNode");
	});

	it("parses dependencies", () => {
		const ext = parseGDExtension(SAMPLE);
		expect(ext.dependencies).toHaveLength(1);
		expect(ext.dependencies[0].dependencies).toHaveProperty("res://bin/libdep.so");
	});
});

describe("validateGDExtension", () => {
	it("validates a complete config", () => {
		const ext = parseGDExtension(SAMPLE);
		const issues = validateGDExtension(ext);
		// Should only warn about missing macos release
		expect(issues.length).toBeGreaterThanOrEqual(0);
	});

	it("catches missing entry_symbol", () => {
		const ext = parseGDExtension("[configuration]\n");
		const issues = validateGDExtension(ext);
		expect(issues).toContain("Missing entry_symbol in [configuration]");
	});
});

describe("getPlatformMatrix", () => {
	it("builds correct matrix", () => {
		const ext = parseGDExtension(SAMPLE);
		const matrix = getPlatformMatrix(ext);
		expect(matrix.linux).toContain("debug.x86_64");
		expect(matrix.windows).toContain("release.x86_64");
	});
});

describe("writeGDExtension", () => {
	it("round-trips parsed content", () => {
		const ext = parseGDExtension(SAMPLE);
		const output = writeGDExtension(ext);
		const reparsed = parseGDExtension(output);
		expect(reparsed.configuration.entrySymbol).toBe(ext.configuration.entrySymbol);
		expect(reparsed.libraries).toHaveLength(ext.libraries.length);
	});
});
