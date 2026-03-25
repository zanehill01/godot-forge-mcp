/**
 * Godot Standards Tool Group — Tools for modern Godot 4.3/4.4 development.
 *
 * Covers: UID management, export pipeline, VCS tooling, GDExtension support,
 * plugin management, project linting, test framework integration, and resource awareness.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import type { ToolContext } from "../registry.js";

export function registerGodotStandardsTools(server: McpServer, ctx: ToolContext): void {
	// ═══════════════════════════════════════════════════════════
	// UID Management (Godot 4.4+)
	// ═══════════════════════════════════════════════════════════

	server.tool(
		"godot_uid_integrity",
		"Check UID integrity across the project: find missing .uid files, duplicate UIDs, orphaned .uid files. Critical for Godot 4.4+ projects.",
		{},
		async () => {
			try {
				const { checkUidIntegrity } = await import("../../parsers/uid/parser.js");
				const report = checkUidIntegrity(ctx.projectRoot);
				return { content: [{ type: "text", text: JSON.stringify(report, null, 2) }] };
			} catch (e) {
				return { content: [{ type: "text", text: `Error: ${e instanceof Error ? e.message : String(e)}` }], isError: true };
			}
		},
	);

	server.tool(
		"godot_uid_generate",
		"Generate missing .uid files for all scripts and shaders. Safe to run multiple times — only creates files that don't exist yet.",
		{
			dryRun: z.boolean().optional().default(true).describe("Preview what would be generated without writing files"),
		},
		async ({ dryRun }) => {
			try {
				const { checkUidIntegrity, generateMissingUids } = await import("../../parsers/uid/parser.js");

				if (dryRun) {
					const report = checkUidIntegrity(ctx.projectRoot);
					return {
						content: [{
							type: "text",
							text: JSON.stringify({
								dryRun: true,
								wouldGenerate: report.missingUid.length,
								files: report.missingUid,
							}, null, 2),
						}],
					};
				}

				const generated = generateMissingUids(ctx.projectRoot);
				return {
					content: [{
						type: "text",
						text: JSON.stringify({ generated: generated.length, files: generated }, null, 2),
					}],
				};
			} catch (e) {
				return { content: [{ type: "text", text: `Error: ${e instanceof Error ? e.message : String(e)}` }], isError: true };
			}
		},
	);

	server.tool(
		"godot_safe_move",
		"Move a script/shader file along with its .uid file to preserve Godot's UID tracking.",
		{
			from: z.string().describe("Source res:// path"),
			to: z.string().describe("Destination res:// path"),
		},
		async ({ from, to }) => {
			try {
				const { resToAbsolute } = await import("../../utils/path.js");
				const { safeFileMove } = await import("../../parsers/uid/parser.js");
				const absFrom = resToAbsolute(from, ctx.projectRoot);
				const absTo = resToAbsolute(to, ctx.projectRoot);
				const result = safeFileMove(absFrom, absTo);
				ctx.getAssetManager().invalidate();
				return {
					content: [{
						type: "text",
						text: JSON.stringify({ from, to, ...result }, null, 2),
					}],
				};
			} catch (e) {
				return { content: [{ type: "text", text: `Error: ${e instanceof Error ? e.message : String(e)}` }], isError: true };
			}
		},
	);

	// ═══════════════════════════════════════════════════════════
	// Export Pipeline
	// ═══════════════════════════════════════════════════════════

	server.tool(
		"godot_export_presets",
		"Parse and validate export_presets.cfg. Shows all configured export targets, platforms, and issues.",
		{},
		async () => {
			try {
				const presetsPath = join(ctx.projectRoot, "export_presets.cfg");
				if (!existsSync(presetsPath)) {
					return { content: [{ type: "text", text: "No export_presets.cfg found. Configure exports via Project > Export in the Godot editor." }] };
				}
				const { parseExportPresets, validateExportPresets } = await import("../../parsers/export-presets/parser.js");
				const presets = parseExportPresets(readFileSync(presetsPath, "utf-8"));
				const issues = validateExportPresets(presets);
				return {
					content: [{
						type: "text",
						text: JSON.stringify({
							presetCount: presets.presets.length,
							presets: presets.presets.map((p) => ({
								name: p.name,
								platform: p.platform,
								runnable: p.runnable,
								exportPath: p.exportPath,
							})),
							issues,
						}, null, 2),
					}],
				};
			} catch (e) {
				return { content: [{ type: "text", text: `Error: ${e instanceof Error ? e.message : String(e)}` }], isError: true };
			}
		},
	);

	server.tool(
		"godot_generate_ci",
		"Generate a GitHub Actions CI/CD workflow for automated Godot exports based on export_presets.cfg.",
		{
			outputPath: z.string().optional().default(".github/workflows/godot-export.yml"),
		},
		async ({ outputPath }) => {
			try {
				const presetsPath = join(ctx.projectRoot, "export_presets.cfg");
				if (!existsSync(presetsPath)) {
					return { content: [{ type: "text", text: "No export_presets.cfg found. Configure exports first." }], isError: true };
				}

				const { parseExportPresets, generateGodotCIWorkflow } = await import("../../parsers/export-presets/parser.js");
				const presets = parseExportPresets(readFileSync(presetsPath, "utf-8"));
				const workflow = generateGodotCIWorkflow(presets);

				const fullPath = join(ctx.projectRoot, outputPath);
				mkdirSync(dirname(fullPath), { recursive: true });
				writeFileSync(fullPath, workflow, "utf-8");

				return {
					content: [{
						type: "text",
						text: `Generated CI workflow at ${outputPath}\n\n${workflow}`,
					}],
				};
			} catch (e) {
				return { content: [{ type: "text", text: `Error: ${e instanceof Error ? e.message : String(e)}` }], isError: true };
			}
		},
	);

	// ═══════════════════════════════════════════════════════════
	// Version Control
	// ═══════════════════════════════════════════════════════════

	server.tool(
		"godot_generate_gitignore",
		"Generate a Godot-appropriate .gitignore file. Version-aware: handles .uid files for 4.4+.",
		{
			godotVersion: z.enum(["4.0", "4.1", "4.2", "4.3", "4.4"]).optional().default("4.4"),
			includeGitAttributes: z.boolean().optional().default(true).describe("Also generate .gitattributes with LFS patterns"),
		},
		async ({ godotVersion, includeGitAttributes }) => {
			try {
				const gitignore = generateGitignore(godotVersion);
				writeFileSync(join(ctx.projectRoot, ".gitignore"), gitignore, "utf-8");

				let result = `Generated .gitignore for Godot ${godotVersion}`;

				if (includeGitAttributes) {
					const gitattributes = generateGitattributes();
					writeFileSync(join(ctx.projectRoot, ".gitattributes"), gitattributes, "utf-8");
					result += "\nGenerated .gitattributes with Git LFS patterns";
				}

				return { content: [{ type: "text", text: result }] };
			} catch (e) {
				return { content: [{ type: "text", text: `Error: ${e instanceof Error ? e.message : String(e)}` }], isError: true };
			}
		},
	);

	// ═══════════════════════════════════════════════════════════
	// GDExtension
	// ═══════════════════════════════════════════════════════════

	server.tool(
		"godot_gdextension_info",
		"Parse and validate a .gdextension file. Shows configuration, platform matrix, and any issues.",
		{
			path: z.string().describe("res:// path to the .gdextension file"),
		},
		async ({ path }) => {
			try {
				const { resToAbsolute } = await import("../../utils/path.js");
				const absPath = resToAbsolute(path, ctx.projectRoot);
				const { parseGDExtension, validateGDExtension, getPlatformMatrix } = await import("../../parsers/gdextension/parser.js");
				const ext = parseGDExtension(readFileSync(absPath, "utf-8"));
				const issues = validateGDExtension(ext);
				const matrix = getPlatformMatrix(ext);

				return {
					content: [{
						type: "text",
						text: JSON.stringify({
							configuration: ext.configuration,
							platformMatrix: matrix,
							libraryCount: ext.libraries.length,
							iconCount: ext.icons.length,
							issues,
						}, null, 2),
					}],
				};
			} catch (e) {
				return { content: [{ type: "text", text: `Error: ${e instanceof Error ? e.message : String(e)}` }], isError: true };
			}
		},
	);

	server.tool(
		"godot_gdextension_scaffold",
		"Generate a new GDExtension scaffolding with .gdextension file and directory structure.",
		{
			name: z.string().describe("Extension name (snake_case)"),
			entrySymbol: z.string().describe("C entry function name (e.g., 'my_ext_init')"),
			minVersion: z.string().optional().default("4.3"),
			platforms: z.array(z.string()).optional().default(["windows", "linux", "macos"]),
		},
		async ({ name, entrySymbol, minVersion, platforms }) => {
			try {
				const { writeGDExtension } = await import("../../parsers/gdextension/parser.js");
				const ext = {
					configuration: {
						entrySymbol,
						compatibilityMinimum: minVersion,
						compatibilityMaximum: null,
						reloadable: true,
						androidAarPlugin: false,
					},
					libraries: platforms.flatMap((p) => [
						{ platform: p, buildType: "debug", architecture: "x86_64", path: `res://bin/lib${name}.${p}.template_debug.x86_64${platformExt(p)}`, rawKey: `${p}.debug.x86_64` },
						{ platform: p, buildType: "release", architecture: "x86_64", path: `res://bin/lib${name}.${p}.template_release.x86_64${platformExt(p)}`, rawKey: `${p}.release.x86_64` },
					]),
					icons: [],
					dependencies: [],
				};

				const content = writeGDExtension(ext);
				const extPath = join(ctx.projectRoot, `${name}.gdextension`);
				writeFileSync(extPath, content, "utf-8");
				mkdirSync(join(ctx.projectRoot, "bin"), { recursive: true });

				return {
					content: [{
						type: "text",
						text: `Scaffolded GDExtension "${name}":\n- ${name}.gdextension\n- bin/ directory\n\nConfigured for: ${platforms.join(", ")}`,
					}],
				};
			} catch (e) {
				return { content: [{ type: "text", text: `Error: ${e instanceof Error ? e.message : String(e)}` }], isError: true };
			}
		},
	);

	// ═══════════════════════════════════════════════════════════
	// Plugin Management
	// ═══════════════════════════════════════════════════════════

	server.tool(
		"godot_plugin_scaffold",
		"Generate a new Godot editor plugin with plugin.cfg and plugin.gd scaffold.",
		{
			name: z.string().describe("Plugin name"),
			author: z.string().optional().default(""),
			description: z.string().optional().default(""),
			version: z.string().optional().default("1.0.0"),
		},
		async ({ name, author, description, version }) => {
			try {
				const { generatePluginScaffold, writePluginCfg } = await import("../../parsers/plugin-cfg/parser.js");
				const pluginDir = join(ctx.projectRoot, "addons", name.toLowerCase().replace(/\s+/g, "_"));
				mkdirSync(pluginDir, { recursive: true });

				const files = generatePluginScaffold({
					name,
					description: description || `${name} editor plugin`,
					author,
					version,
					script: "plugin.gd",
				});

				for (const [filename, content] of Object.entries(files)) {
					writeFileSync(join(pluginDir, filename), content, "utf-8");
				}

				ctx.getAssetManager().invalidate();
				return {
					content: [{
						type: "text",
						text: `Created plugin scaffold at addons/${name.toLowerCase().replace(/\s+/g, "_")}/\nFiles: ${Object.keys(files).join(", ")}`,
					}],
				};
			} catch (e) {
				return { content: [{ type: "text", text: `Error: ${e instanceof Error ? e.message : String(e)}` }], isError: true };
			}
		},
	);

	server.tool(
		"godot_plugin_info",
		"Read plugin.cfg files from addons/ and show installed plugin details.",
		{},
		async () => {
			try {
				const { parsePluginCfg, validatePluginCfg } = await import("../../parsers/plugin-cfg/parser.js");
				const addonsDir = join(ctx.projectRoot, "addons");
				if (!existsSync(addonsDir)) {
					return { content: [{ type: "text", text: "No addons/ directory found." }] };
				}

				const { readdirSync } = await import("node:fs");
				const plugins: Array<{ dir: string; config: ReturnType<typeof parsePluginCfg>; issues: string[] }> = [];

				for (const entry of readdirSync(addonsDir)) {
					const cfgPath = join(addonsDir, entry, "plugin.cfg");
					if (existsSync(cfgPath)) {
						const config = parsePluginCfg(readFileSync(cfgPath, "utf-8"));
						plugins.push({ dir: entry, config, issues: validatePluginCfg(config) });
					}
				}

				return { content: [{ type: "text", text: JSON.stringify(plugins, null, 2) }] };
			} catch (e) {
				return { content: [{ type: "text", text: `Error: ${e instanceof Error ? e.message : String(e)}` }], isError: true };
			}
		},
	);

	// ═══════════════════════════════════════════════════════════
	// Project Linting
	// ═══════════════════════════════════════════════════════════

	server.tool(
		"godot_lint_project",
		"Lint the project for Godot conventions: snake_case filenames, PascalCase nodes, directory structure, naming antipatterns.",
		{},
		async () => {
			try {
				const assets = ctx.getAssetManager().getAssets();
				const issues: Array<{ file: string; issue: string; severity: "warning" | "error" }> = [];

				for (const a of assets) {
					const filename = a.resPath.split("/").pop() ?? "";
					const nameWithoutExt = filename.replace(/\.[^.]+$/, "");

					// Check snake_case for scripts
					if (a.category === "script" || a.category === "scene" || a.category === "shader") {
						if (nameWithoutExt !== nameWithoutExt.toLowerCase()) {
							issues.push({
								file: a.resPath,
								issue: `Filename should be snake_case: "${filename}" → "${toSnakeCase(nameWithoutExt)}${a.ext}"`,
								severity: "warning",
							});
						}
					}

					// Check for spaces in filenames
					if (filename.includes(" ")) {
						issues.push({
							file: a.resPath,
							issue: `Filename contains spaces: "${filename}"`,
							severity: "error",
						});
					}
				}

				// Check for common antipatterns
				const hasAddons = assets.some((a) => a.resPath.startsWith("res://addons/"));
				const hasScriptsInRoot = assets.some((a) => a.category === "script" && !a.resPath.includes("/", 6));

				if (hasScriptsInRoot) {
					issues.push({
						file: "res://",
						issue: "Scripts found in project root. Consider organizing into a scripts/ or src/ directory.",
						severity: "warning",
					});
				}

				return {
					content: [{
						type: "text",
						text: JSON.stringify({
							totalFiles: assets.length,
							issueCount: issues.length,
							errors: issues.filter((i) => i.severity === "error"),
							warnings: issues.filter((i) => i.severity === "warning"),
						}, null, 2),
					}],
				};
			} catch (e) {
				return { content: [{ type: "text", text: `Error: ${e instanceof Error ? e.message : String(e)}` }], isError: true };
			}
		},
	);

	// ═══════════════════════════════════════════════════════════
	// Test Framework Integration
	// ═══════════════════════════════════════════════════════════

	server.tool(
		"godot_scaffold_test",
		"Generate a GUT or GdUnit4 test file for a given script.",
		{
			scriptPath: z.string().describe("res:// path to the script to test"),
			framework: z.enum(["gut", "gdunit4"]).optional().default("gut"),
		},
		async ({ scriptPath, framework }) => {
			try {
				const { ScriptManager } = await import("../../engine/script-manager.js");
				const mgr = new ScriptManager(ctx.projectRoot);
				const analysis = mgr.analyze(scriptPath);

				const testMethods = analysis.methods
					.filter((m) => !m.isVirtual && !m.name.startsWith("_"))
					.map((m) => m.name);

				let testContent: string;
				const className = analysis.className ?? scriptPath.split("/").pop()?.replace(".gd", "") ?? "Script";

				if (framework === "gut") {
					const methods = testMethods.map((m) => `func test_${m}() -> void:\n\t# TODO: Test ${m}\n\tpass`).join("\n\n");
					testContent = `extends GutTest
## Tests for ${className}

var _instance: ${analysis.extends ?? "Node"}

func before_each() -> void:
\t_instance = preload("${scriptPath}").new()
\tadd_child_autofree(_instance)

func after_each() -> void:
\t_instance = null

${methods || "func test_example() -> void:\n\tpass"}
`;
				} else {
					const methods = testMethods.map((m) => `func test_${m}() -> void:\n\t# TODO: Test ${m}\n\tassert_that(true).is_true()`).join("\n\n");
					testContent = `class_name Test${className}
extends GdUnitTestSuite
## Tests for ${className}

var _instance: ${analysis.extends ?? "Node"}

func before_test() -> void:
\t_instance = preload("${scriptPath}").new()
\tadd_child(_instance)

func after_test() -> void:
\t_instance.queue_free()

${methods || "func test_example() -> void:\n\tassert_that(true).is_true()"}
`;
				}

				// Write to test directory
				const testDir = framework === "gut" ? "test" : "test";
				const testFileName = scriptPath.split("/").pop()?.replace(".gd", `_test.gd`) ?? "test.gd";
				const testPath = join(ctx.projectRoot, testDir, testFileName);
				mkdirSync(dirname(testPath), { recursive: true });
				writeFileSync(testPath, testContent, "utf-8");

				return {
					content: [{
						type: "text",
						text: `Generated ${framework} test at ${testDir}/${testFileName}\n\nTest methods for: ${testMethods.join(", ") || "none (only virtual methods found)"}`,
					}],
				};
			} catch (e) {
				return { content: [{ type: "text", text: `Error: ${e instanceof Error ? e.message : String(e)}` }], isError: true };
			}
		},
	);

	server.tool(
		"godot_run_tests",
		"Run GUT or GdUnit4 tests headlessly via the CLI bridge.",
		{
			framework: z.enum(["gut", "gdunit4"]).optional().default("gut"),
			timeout: z.number().optional().default(60000),
		},
		async ({ framework, timeout }) => {
			if (!ctx.godotBinary) {
				return { content: [{ type: "text", text: "Godot binary not found." }], isError: true };
			}

			try {
				const { CliBridge } = await import("../../bridges/cli-bridge.js");
				const cli = new CliBridge(ctx.godotBinary, ctx.projectRoot);

				let result;
				if (framework === "gut") {
					result = await cli.run(["--headless", "-s", "addons/gut/gut_cmdln.gd"], timeout);
				} else {
					result = await cli.run(["--headless", "-s", "addons/gdUnit4/bin/GdUnitCmdTool.gd", "--run-all"], timeout);
				}

				return {
					content: [{
						type: "text",
						text: JSON.stringify({
							exitCode: result.exitCode,
							passed: !result.timedOut && result.exitCode === 0,
							stdout: result.stdout.slice(0, 5000),
							stderr: result.stderr.slice(0, 2000),
							timedOut: result.timedOut,
						}, null, 2),
					}],
				};
			} catch (e) {
				return { content: [{ type: "text", text: `Error: ${e instanceof Error ? e.message : String(e)}` }], isError: true };
			}
		},
	);

	// ═══════════════════════════════════════════════════════════
	// Resource Type Awareness
	// ═══════════════════════════════════════════════════════════

	server.tool(
		"godot_resource_types",
		"Analyze all .tres files in the project and categorize by resource type (Theme, Environment, PhysicsMaterial, etc.).",
		{},
		async () => {
			try {
				const resources = ctx.getAssetManager().byCategory("resource");
				const typeMap: Record<string, string[]> = {};

				for (const r of resources) {
					try {
						const content = readFileSync(r.absPath, "utf-8");
						const match = content.match(/\[gd_resource\s+type="([^"]+)"/);
						const type = match ? match[1] : "Unknown";
						if (!typeMap[type]) typeMap[type] = [];
						typeMap[type].push(r.resPath);
					} catch { /* skip */ }
				}

				return {
					content: [{
						type: "text",
						text: JSON.stringify({
							totalResources: resources.length,
							types: Object.entries(typeMap).map(([type, files]) => ({
								type,
								count: files.length,
								files,
							})).sort((a, b) => b.count - a.count),
						}, null, 2),
					}],
				};
			} catch (e) {
				return { content: [{ type: "text", text: `Error: ${e instanceof Error ? e.message : String(e)}` }], isError: true };
			}
		},
	);
}

// ═══════════════════════════════════════════════════════════════
// Helper Functions
// ═══════════════════════════════════════════════════════════════

function generateGitignore(version: string): string {
	let content = `# Godot ${version} .gitignore

# Godot-specific ignores
.godot/

# Mono-specific ignores
.mono/
data_*/
mono_crash.*.json

# System/editor ignores
.import/
*.translation

# OS generated files
.DS_Store
Thumbs.db
*.swp
*~

# Build outputs
builds/
export/
`;

	if (parseFloat(version) >= 4.4) {
		content += `
# IMPORTANT: Do NOT ignore these in Godot 4.4+
# *.uid files MUST be committed (they track resource identity)
# export_presets.cfg SHOULD be committed
`;
	}

	return content;
}

function generateGitattributes(): string {
	return `# Auto-detect text files and normalize line endings
* text=auto eol=lf

# Godot text files
*.gd text diff
*.tscn text diff
*.tres text diff
*.godot text diff
*.cfg text diff
*.gdshader text diff
*.import text diff
*.uid text diff

# Binary assets — consider using Git LFS for large files
*.png binary
*.jpg binary
*.jpeg binary
*.webp binary
*.svg binary
*.bmp binary
*.tga binary
*.wav binary
*.ogg binary
*.mp3 binary
*.glb binary
*.gltf binary
*.fbx binary
*.obj binary
*.blend binary
*.ttf binary
*.otf binary
*.woff binary
*.woff2 binary
*.res binary
*.scn binary
`;
}

function toSnakeCase(s: string): string {
	return s
		.replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2")
		.replace(/([a-z\d])([A-Z])/g, "$1_$2")
		.replace(/[\s-]+/g, "_")
		.toLowerCase();
}

function platformExt(platform: string): string {
	switch (platform) {
		case "windows": return ".dll";
		case "linux": case "linuxbsd": return ".so";
		case "macos": return ".dylib";
		case "web": return ".wasm";
		case "android": return ".so";
		case "ios": return ".dylib";
		default: return ".so";
	}
}
