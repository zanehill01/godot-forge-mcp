/**
 * Shader Tool Group — single unified "godot_shader" tool.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { mkdirSync } from "node:fs";
import { resToAbsolute } from "../../utils/path.js";
import { analyzeShader } from "../../parsers/gdshader/parser.js";
import { SHADER_TEMPLATES, listShaderTemplates } from "../../parsers/gdshader/templates.js";
import type { ToolContext } from "../registry.js";

export function registerShaderTools(server: McpServer, ctx: ToolContext): void {
	server.tool(
		"godot_shader",
		`Unified shader tool. Actions:
  create  — Generate a .gdshader file from description or template.
            Params: path (required), shaderType (required), template, code, renderModes, uniforms
  read    — Parse a .gdshader file, extract type/modes/uniforms/varyings/functions.
            Params: path (required)
  edit    — Modify a .gdshader: add/modify uniform, replace function, set render mode.
            Params: path (required), operation (required), name, code
  material — Create a ShaderMaterial .tres referencing a .gdshader with parameter values.
            Params: path (required), shaderPath (required), params
  params  — Extract all uniforms from a .gdshader with types, hints, defaults.
            Params: path (required)
  set_param — Set a shader parameter on a ShaderMaterial .tres file.
            Params: materialPath (required), param (required), value (required)
  validate — Validate .gdshader syntax/structure. Returns detected issues.
            Params: path (required)
  templates — List available shader templates or get a specific template's code.
            Params: name (optional)`,
		{
			action: z.enum(["create", "read", "edit", "material", "params", "set_param", "validate", "templates"]).describe("Action to perform"),
			path: z.string().optional().describe("Shader or output path (res:// format)"),
			shaderType: z.enum(["spatial", "canvas_item", "particles", "sky", "fog"]).optional().describe("Shader type (for create)"),
			template: z.string().optional().describe("Template name: water, dissolve, outline, toon, hologram, pixelation, wind, glow (for create)"),
			code: z.string().optional().describe("Full shader code or new code for edit operations"),
			renderModes: z.array(z.string()).optional().describe("Render modes, e.g. blend_mix, cull_back (for create)"),
			uniforms: z.array(z.object({
				name: z.string(),
				type: z.string().describe("GLSL type (float, vec2, vec3, vec4, sampler2D, etc.)"),
				hint: z.string().optional().describe("Hint (source_color, hint_range, etc.)"),
				defaultValue: z.string().optional(),
			})).optional().describe("Uniform declarations (for create)"),
			operation: z.enum(["add_uniform", "modify_uniform", "replace_function", "set_render_mode"]).optional().describe("Edit operation type (for edit)"),
			name: z.string().optional().describe("Uniform/function/template name (for edit, templates)"),
			shaderPath: z.string().optional().describe("Path to .gdshader file (for material)"),
			params: z.record(z.string(), z.string()).optional().describe("Shader parameter values as name→Variant string (for material)"),
			materialPath: z.string().optional().describe("ShaderMaterial .tres path (for set_param)"),
			param: z.string().optional().describe("Parameter name (for set_param)"),
			value: z.string().optional().describe("Value in Godot Variant format (for set_param)"),
		},
		async (args) => {
			const { action } = args;

			switch (action) {
				// ── create ───────────────────────────────────────────
				case "create": {
					const { path, shaderType, template, code, renderModes, uniforms } = args;
					if (!path) return { content: [{ type: "text" as const, text: "path is required for create" }], isError: true };
					if (!shaderType && !template && !code) return { content: [{ type: "text" as const, text: "shaderType, template, or code is required for create" }], isError: true };
					try {
						let shaderCode: string;

						if (template) {
							const tmpl = SHADER_TEMPLATES[template.toLowerCase()];
							if (!tmpl) {
								return { content: [{ type: "text" as const, text: `Unknown template: ${template}. Available: ${Object.keys(SHADER_TEMPLATES).join(", ")}` }], isError: true };
							}
							shaderCode = tmpl.code;
						} else if (code) {
							shaderCode = code;
						} else {
							const lines: string[] = [`shader_type ${shaderType};`];
							if (renderModes && renderModes.length > 0) {
								lines.push(`render_mode ${renderModes.join(", ")};`);
							}
							lines.push("");
							if (uniforms) {
								for (const u of uniforms) {
									let line = `uniform ${u.type} ${u.name}`;
									if (u.hint) line += ` : ${u.hint}`;
									if (u.defaultValue) line += ` = ${u.defaultValue}`;
									line += ";";
									lines.push(line);
								}
								lines.push("");
							}
							lines.push("void vertex() {\n\t// Vertex manipulation\n}\n");
							lines.push("void fragment() {\n\tALBEDO = vec3(1.0);\n}\n");
							shaderCode = lines.join("\n");
						}

						const absPath = resToAbsolute(path, ctx.projectRoot);
						mkdirSync(dirname(absPath), { recursive: true });
						writeFileSync(absPath, shaderCode, "utf-8");
						ctx.getAssetManager().invalidate();

						return { content: [{ type: "text" as const, text: `Created shader at ${path}` }] };
					} catch (e) {
						return { content: [{ type: "text" as const, text: `Error: ${e}` }], isError: true };
					}
				}

				// ── read ─────────────────────────────────────────────
				case "read": {
					const { path } = args;
					if (!path) return { content: [{ type: "text" as const, text: "path is required for read" }], isError: true };
					try {
						const absPath = resToAbsolute(path, ctx.projectRoot);
						const content = readFileSync(absPath, "utf-8");
						const analysis = analyzeShader(content);
						return { content: [{ type: "text" as const, text: JSON.stringify({ path, ...analysis, source: content }, null, 2) }] };
					} catch (e) {
						return { content: [{ type: "text" as const, text: `Error: ${e}` }], isError: true };
					}
				}

				// ── edit ─────────────────────────────────────────────
				case "edit": {
					const { path, operation, name, code } = args;
					if (!path) return { content: [{ type: "text" as const, text: "path is required for edit" }], isError: true };
					if (!operation) return { content: [{ type: "text" as const, text: "operation is required for edit" }], isError: true };
					try {
						const absPath = resToAbsolute(path, ctx.projectRoot);
						let content = readFileSync(absPath, "utf-8");

						switch (operation) {
							case "add_uniform": {
								if (!code) return { content: [{ type: "text" as const, text: "code is required" }], isError: true };
								const lines = content.split("\n");
								let insertIdx = 0;
								for (let i = 0; i < lines.length; i++) {
									if (lines[i].trim().startsWith("uniform ")) insertIdx = i + 1;
									else if (lines[i].trim().startsWith("shader_type ") || lines[i].trim().startsWith("render_mode ")) {
										if (insertIdx === 0) insertIdx = i + 1;
									}
								}
								lines.splice(insertIdx, 0, code);
								content = lines.join("\n");
								break;
							}
							case "modify_uniform": {
								if (!name || !code) return { content: [{ type: "text" as const, text: "name and code required" }], isError: true };
								const regex = new RegExp(`^uniform\\s+\\w+\\s+${name}\\b[^;]*;`, "m");
								content = content.replace(regex, code);
								break;
							}
							case "replace_function": {
								if (!name || !code) return { content: [{ type: "text" as const, text: "name and code required" }], isError: true };
								const funcRegex = new RegExp(`(\\w+\\s+${name}\\s*\\([^)]*\\)\\s*\\{)[^}]*(\\})`, "s");
								content = content.replace(funcRegex, `$1\n${code}\n$2`);
								break;
							}
							case "set_render_mode": {
								if (!code) return { content: [{ type: "text" as const, text: "code required (comma-separated modes)" }], isError: true };
								if (content.includes("render_mode")) {
									content = content.replace(/render_mode[^;]*;/, `render_mode ${code};`);
								} else {
									content = content.replace(/(shader_type\s+\w+;)/, `$1\nrender_mode ${code};`);
								}
								break;
							}
						}

						writeFileSync(absPath, content, "utf-8");
						return { content: [{ type: "text" as const, text: `Applied ${operation}${name ? ` for "${name}"` : ""} in ${path}` }] };
					} catch (e) {
						return { content: [{ type: "text" as const, text: `Error: ${e}` }], isError: true };
					}
				}

				// ── material ─────────────────────────────────────────
				case "material": {
					const { path, shaderPath, params } = args;
					if (!path) return { content: [{ type: "text" as const, text: "path is required for material" }], isError: true };
					if (!shaderPath) return { content: [{ type: "text" as const, text: "shaderPath is required for material" }], isError: true };
					try {
						const lines = [
							`[gd_resource type="ShaderMaterial" format=3]`,
							"",
							`[ext_resource type="Shader" path="${shaderPath}" id="1_shader"]`,
							"",
							"[resource]",
							`shader = ExtResource("1_shader")`,
						];
						if (params) {
							for (const [k, v] of Object.entries(params)) {
								lines.push(`shader_parameter/${k} = ${v}`);
							}
						}
						lines.push("");

						const absPath = resToAbsolute(path, ctx.projectRoot);
						mkdirSync(dirname(absPath), { recursive: true });
						writeFileSync(absPath, lines.join("\n"), "utf-8");
						ctx.getAssetManager().invalidate();

						return { content: [{ type: "text" as const, text: `Created ShaderMaterial at ${path} referencing ${shaderPath}` }] };
					} catch (e) {
						return { content: [{ type: "text" as const, text: `Error: ${e}` }], isError: true };
					}
				}

				// ── params ───────────────────────────────────────────
				case "params": {
					const { path } = args;
					if (!path) return { content: [{ type: "text" as const, text: "path is required for params" }], isError: true };
					try {
						const absPath = resToAbsolute(path, ctx.projectRoot);
						const content = readFileSync(absPath, "utf-8");
						const analysis = analyzeShader(content);
						return { content: [{ type: "text" as const, text: JSON.stringify(analysis.uniforms, null, 2) }] };
					} catch (e) {
						return { content: [{ type: "text" as const, text: `Error: ${e}` }], isError: true };
					}
				}

				// ── set_param ────────────────────────────────────────
				case "set_param": {
					const { materialPath, param, value } = args;
					if (!materialPath) return { content: [{ type: "text" as const, text: "materialPath is required for set_param" }], isError: true };
					if (!param) return { content: [{ type: "text" as const, text: "param is required for set_param" }], isError: true };
					if (!value) return { content: [{ type: "text" as const, text: "value is required for set_param" }], isError: true };
					try {
						const absPath = resToAbsolute(materialPath, ctx.projectRoot);
						let content = readFileSync(absPath, "utf-8");
						const key = `shader_parameter/${param}`;
						const regex = new RegExp(`^${key.replace("/", "\\/")}\\s*=.*$`, "m");
						if (regex.test(content)) {
							content = content.replace(regex, `${key} = ${value}`);
						} else {
							content = content.trimEnd() + `\n${key} = ${value}\n`;
						}
						writeFileSync(absPath, content, "utf-8");
						return { content: [{ type: "text" as const, text: `Set ${param} = ${value} on ${materialPath}` }] };
					} catch (e) {
						return { content: [{ type: "text" as const, text: `Error: ${e}` }], isError: true };
					}
				}

				// ── validate ─────────────────────────────────────────
				case "validate": {
					const { path } = args;
					if (!path) return { content: [{ type: "text" as const, text: "path is required for validate" }], isError: true };
					try {
						const absPath = resToAbsolute(path, ctx.projectRoot);
						const content = readFileSync(absPath, "utf-8");
						const issues: string[] = [];

						if (!content.includes("shader_type")) issues.push("Missing shader_type declaration");
						const analysis = analyzeShader(content);
						if (!["spatial", "canvas_item", "particles", "sky", "fog"].includes(analysis.shaderType)) {
							issues.push(`Invalid shader_type: ${analysis.shaderType}`);
						}

						if (analysis.shaderType === "spatial" && !analysis.functions.some((f: { name: string }) => f.name === "fragment" || f.name === "vertex")) {
							issues.push("Warning: spatial shader has no vertex() or fragment() function");
						}

						return {
							content: [{
								type: "text" as const,
								text: JSON.stringify({
									path,
									valid: issues.length === 0,
									issues,
									shaderType: analysis.shaderType,
									uniformCount: analysis.uniforms.length,
									functionCount: analysis.functions.length,
								}, null, 2),
							}],
						};
					} catch (e) {
						return { content: [{ type: "text" as const, text: `Error: ${e}` }], isError: true };
					}
				}

				// ── templates ────────────────────────────────────────
				case "templates": {
					const { name } = args;
					if (name) {
						const tmpl = SHADER_TEMPLATES[name.toLowerCase()];
						if (!tmpl) {
							return { content: [{ type: "text" as const, text: `Unknown template. Available: ${Object.keys(SHADER_TEMPLATES).join(", ")}` }], isError: true };
						}
						return { content: [{ type: "text" as const, text: JSON.stringify(tmpl, null, 2) }] };
					}
					return { content: [{ type: "text" as const, text: JSON.stringify(listShaderTemplates(), null, 2) }] };
				}

				default:
					return { content: [{ type: "text" as const, text: `Unknown action: ${action}` }], isError: true };
			}
		},
	);
}
