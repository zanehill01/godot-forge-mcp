/**
 * Godot Standards Tool Group — Tools for modern Godot 4.3/4.4 development.
 *
 * Covers: UID management, export pipeline, VCS tooling, GDExtension support,
 * plugin management, project linting, test framework integration, and resource awareness.
 *
 * Single unified tool: godot_standards with action-based dispatch.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import type { ToolContext } from "../registry.js";

export function registerGodotStandardsTools(server: McpServer, ctx: ToolContext): void {
	server.tool(
		"godot_standards",
		`Godot project standards and tooling. Actions:

- uid_integrity: Check UID integrity across the project (missing/duplicate/orphaned .uid files). No params.
- uid_generate: Generate missing .uid files. Params: dryRun (boolean, default true).
- safe_move: Move a file with its .uid. Params: from (string, res:// path), to (string, res:// path).
- export_presets: Parse and validate export_presets.cfg. No params.
- generate_ci: Generate GitHub Actions CI/CD workflow. Params: outputPath (string, default ".github/workflows/godot-export.yml").
- gitignore: Generate .gitignore (and optionally .gitattributes). Params: godotVersion ("4.0"|"4.1"|"4.2"|"4.3"|"4.4", default "4.4"), includeGitAttributes (boolean, default true).
- gdextension_info: Parse/validate a .gdextension file. Params: path (string, res:// path).
- gdextension_scaffold: Scaffold a new GDExtension. Params: name (string), entrySymbol (string), minVersion (string, default "4.3"), platforms (string[], default ["windows","linux","macos"]).
- plugin_scaffold: Generate a new editor plugin. Params: name (string), author (string), description (string), version (string, default "1.0.0").
- plugin_info: List installed plugins from addons/. No params.
- lint: Lint project for Godot conventions. No params.
- scaffold_test: Generate a GUT/GdUnit4 test file. Params: scriptPath (string, res://), framework ("gut"|"gdunit4", default "gut").
- run_tests: Run tests headlessly. Params: framework ("gut"|"gdunit4", default "gut"), timeout (number, default 60000).
- resource_types: Analyze .tres files by resource type. No params.`,
		{
			action: z.enum([
				"uid_integrity",
				"uid_generate",
				"safe_move",
				"export_presets",
				"generate_ci",
				"gitignore",
				"gdextension_info",
				"gdextension_scaffold",
				"plugin_scaffold",
				"plugin_info",
				"lint",
				"scaffold_test",
				"run_tests",
				"resource_types",
			]).describe("The action to perform"),
			// uid_generate
			dryRun: z.boolean().optional().describe("Preview without writing (uid_generate, default true)"),
			// safe_move
			from: z.string().optional().describe("Source res:// path (safe_move)"),
			to: z.string().optional().describe("Destination res:// path (safe_move)"),
			// generate_ci
			outputPath: z.string().optional().describe("CI workflow output path (generate_ci, default '.github/workflows/godot-export.yml')"),
			// gitignore
			godotVersion: z.enum(["4.0", "4.1", "4.2", "4.3", "4.4"]).optional().describe("Godot version (gitignore, default '4.4')"),
			includeGitAttributes: z.boolean().optional().describe("Also generate .gitattributes (gitignore, default true)"),
			// gdextension_info / gdextension_scaffold path overload
			path: z.string().optional().describe("res:// path to .gdextension file (gdextension_info)"),
			// gdextension_scaffold
			name: z.string().optional().describe("Extension or plugin name (gdextension_scaffold, plugin_scaffold)"),
			entrySymbol: z.string().optional().describe("C entry function name (gdextension_scaffold)"),
			minVersion: z.string().optional().describe("Minimum Godot version (gdextension_scaffold, default '4.3')"),
			platforms: z.array(z.string()).optional().describe("Target platforms (gdextension_scaffold, default ['windows','linux','macos'])"),
			// plugin_scaffold
			author: z.string().optional().describe("Plugin author (plugin_scaffold)"),
			description: z.string().optional().describe("Plugin description (plugin_scaffold)"),
			version: z.string().optional().describe("Plugin version (plugin_scaffold, default '1.0.0')"),
			// scaffold_test / run_tests
			scriptPath: z.string().optional().describe("res:// path to script (scaffold_test)"),
			framework: z.enum(["gut", "gdunit4"]).optional().describe("Test framework (scaffold_test, run_tests, default 'gut')"),
			timeout: z.number().optional().describe("Test timeout in ms (run_tests, default 60000)"),
		},
		async (params) => {
			try {
				switch (params.action) {
					// ═══════════════════════════════════════════════════════════
					// UID Management
					// ═══════════════════════════════════════════════════════════

					case "uid_integrity": {
						const { checkUidIntegrity } = await import("../../parsers/uid/parser.js");
						const report = checkUidIntegrity(ctx.projectRoot);
						return { content: [{ type: "text", text: JSON.stringify(report, null, 2) }] };
					}

					case "uid_generate": {
						const dryRun = params.dryRun ?? true;
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
					}

					case "safe_move": {
						if (!params.from || !params.to) {
							return { content: [{ type: "text", text: "Error: 'from' and 'to' params are required for safe_move" }], isError: true };
						}
						const { resToAbsolute } = await import("../../utils/path.js");
						const { safeFileMove } = await import("../../parsers/uid/parser.js");
						const absFrom = resToAbsolute(params.from, ctx.projectRoot);
						const absTo = resToAbsolute(params.to, ctx.projectRoot);
						const result = safeFileMove(absFrom, absTo);
						ctx.getAssetManager().invalidate();
						return {
							content: [{
								type: "text",
								text: JSON.stringify({ from: params.from, to: params.to, ...result }, null, 2),
							}],
						};
					}

					// ═══════════════════════════════════════════════════════════
					// Export Pipeline
					// ═══════════════════════════════════════════════════════════

					case "export_presets": {
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
					}

					case "generate_ci": {
						const outputPath = params.outputPath ?? ".github/workflows/godot-export.yml";
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
					}

					// ═══════════════════════════════════════════════════════════
					// Version Control
					// ═══════════════════════════════════════════════════════════

					case "gitignore": {
						const godotVersion = params.godotVersion ?? "4.4";
						const includeGitAttributes = params.includeGitAttributes ?? true;

						const gitignore = generateGitignore(godotVersion);
						writeFileSync(join(ctx.projectRoot, ".gitignore"), gitignore, "utf-8");

						let resultText = `Generated .gitignore for Godot ${godotVersion}`;

						if (includeGitAttributes) {
							const gitattributes = generateGitattributes();
							writeFileSync(join(ctx.projectRoot, ".gitattributes"), gitattributes, "utf-8");
							resultText += "\nGenerated .gitattributes with Git LFS patterns";
						}

						return { content: [{ type: "text", text: resultText }] };
					}

					// ═══════════════════════════════════════════════════════════
					// GDExtension
					// ═══════════════════════════════════════════════════════════

					case "gdextension_info": {
						if (!params.path) {
							return { content: [{ type: "text", text: "Error: 'path' param is required for gdextension_info" }], isError: true };
						}
						const { resToAbsolute } = await import("../../utils/path.js");
						const absPath = resToAbsolute(params.path, ctx.projectRoot);
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
					}

					case "gdextension_scaffold": {
						if (!params.name || !params.entrySymbol) {
							return { content: [{ type: "text", text: "Error: 'name' and 'entrySymbol' params are required for gdextension_scaffold" }], isError: true };
						}
						const extName = params.name;
						const entrySymbol = params.entrySymbol;
						const minVersion = params.minVersion ?? "4.3";
						const platforms = params.platforms ?? ["windows", "linux", "macos"];

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
								{ platform: p, buildType: "debug", architecture: "x86_64", path: `res://bin/lib${extName}.${p}.template_debug.x86_64${platformExt(p)}`, rawKey: `${p}.debug.x86_64` },
								{ platform: p, buildType: "release", architecture: "x86_64", path: `res://bin/lib${extName}.${p}.template_release.x86_64${platformExt(p)}`, rawKey: `${p}.release.x86_64` },
							]),
							icons: [],
							dependencies: [],
						};

						const content = writeGDExtension(ext);
						const extPath = join(ctx.projectRoot, `${extName}.gdextension`);
						writeFileSync(extPath, content, "utf-8");
						mkdirSync(join(ctx.projectRoot, "bin"), { recursive: true });

						return {
							content: [{
								type: "text",
								text: `Scaffolded GDExtension "${extName}":\n- ${extName}.gdextension\n- bin/ directory\n\nConfigured for: ${platforms.join(", ")}`,
							}],
						};
					}

					// ═══════════════════════════════════════════════════════════
					// Plugin Management
					// ═══════════════════════════════════════════════════════════

					case "plugin_scaffold": {
						if (!params.name) {
							return { content: [{ type: "text", text: "Error: 'name' param is required for plugin_scaffold" }], isError: true };
						}
						const pluginName = params.name;
						const author = params.author ?? "";
						const description = params.description ?? "";
						const version = params.version ?? "1.0.0";

						const { generatePluginScaffold, writePluginCfg } = await import("../../parsers/plugin-cfg/parser.js");
						const pluginDir = join(ctx.projectRoot, "addons", pluginName.toLowerCase().replace(/\s+/g, "_"));
						mkdirSync(pluginDir, { recursive: true });

						const files = generatePluginScaffold({
							name: pluginName,
							description: description || `${pluginName} editor plugin`,
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
								text: `Created plugin scaffold at addons/${pluginName.toLowerCase().replace(/\s+/g, "_")}/\nFiles: ${Object.keys(files).join(", ")}`,
							}],
						};
					}

					case "plugin_info": {
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
					}

					// ═══════════════════════════════════════════════════════════
					// Project Linting
					// ═══════════════════════════════════════════════════════════

					case "lint": {
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
					}

					// ═══════════════════════════════════════════════════════════
					// Test Framework Integration
					// ═══════════════════════════════════════════════════════════

					case "scaffold_test": {
						if (!params.scriptPath) {
							return { content: [{ type: "text", text: "Error: 'scriptPath' param is required for scaffold_test" }], isError: true };
						}
						const scriptPath = params.scriptPath;
						const framework = params.framework ?? "gut";

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
					}

					case "run_tests": {
						const framework = params.framework ?? "gut";
						const timeout = params.timeout ?? 60000;

						if (!ctx.godotBinary) {
							return { content: [{ type: "text", text: "Godot binary not found." }], isError: true };
						}

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
					}

					// ═══════════════════════════════════════════════════════════
					// Resource Type Awareness
					// ═══════════════════════════════════════════════════════════

					case "resource_types": {
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
					}

					default:
						return { content: [{ type: "text", text: `Unknown action: ${params.action}` }], isError: true };
				}
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
