/**
 * Tests for .import file parser.
 */

import { describe, it, expect } from "vitest";
import { parseImportFile } from "../parser.js";

describe("parseImportFile", () => {
	it("parses a typical .import file", () => {
		const result = parseImportFile(`
[remap]

importer="texture"
type="CompressedTexture2D"
uid="uid://cecaux1sm7mo0"
path="res://.godot/imported/icon.svg-218a8f2b3041b504a71029e15.ctex"

[deps]

source_file="res://icon.svg"
dest_files=["res://.godot/imported/icon.svg-218a8f2b3041b504a71029e15.ctex"]

[params]

compress/mode=0
compress/high_quality=false
compress/lossy_quality=0.7
`);
		expect(result.remap.importer).toBe("texture");
		expect(result.remap.type).toBe("CompressedTexture2D");
		expect(result.remap.uid).toBe("uid://cecaux1sm7mo0");
		expect(result.deps.sourceFile).toBe("res://icon.svg");
		expect(result.deps.destFiles).toHaveLength(1);
		expect(result.params["compress/mode"]).toBe(0);
		expect(result.params["compress/high_quality"]).toBe(false);
		expect(result.params["compress/lossy_quality"]).toBe(0.7);
	});

	it("handles empty content", () => {
		const result = parseImportFile("");
		expect(result.remap.importer).toBe("");
		expect(result.deps.destFiles).toHaveLength(0);
	});

	it("skips comments", () => {
		const result = parseImportFile(`
[remap]
; this is a comment
# this too
importer="texture"
`);
		expect(result.remap.importer).toBe("texture");
	});

	it("handles missing sections", () => {
		const result = parseImportFile(`
[remap]
importer="font"
type="FontFile"
path="res://.godot/imported/font.ttf-hash.fontdata"
`);
		expect(result.remap.importer).toBe("font");
		expect(result.deps.sourceFile).toBe("");
	});
});
