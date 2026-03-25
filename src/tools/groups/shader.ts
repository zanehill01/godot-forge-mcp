/**
 * Shader Tool Group — 8 tools for .gdshader authoring.
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
		"godot_create_shader",
		"Generate a .gdshader file from a description or template. Shader types: spatial, canvas_item, particles, sky, fog.",
		{
			path: z.string().describe('Output path (res:// format, e.g., "res://shaders/water.gdshader")'),
			shaderType: z.enum(["spatial", "canvas_item", "particles", "sky", "fog"]).describe("Shader type"),
			template: z.string().optional().describe("Template name (water, dissolve, outline, toon, hologram, pixelation, wind, glow)"),
			code: z.string().optional().describe("Full shader code (if not using template)"),
			renderModes: z.array(z.string()).optional().describe("Render modes (e.g., blend_mix, cull_back)"),
			uniforms: z.array(z.object({
				name: z.string(),
				type: z.string().describe("GLSL type (float, vec2, vec3, vec4, sampler2D, etc.)"),
				hint: z.string().optional().describe("Hint (source_color, hint_range, etc.)"),
				defaultValue: z.string().optional(),
			})).optional().describe("Uniform declarations"),
		},
		async ({ path, shaderType, template, code, renderModes, uniforms }) => {
			try {
				let shaderCode: string;

				if (template) {
					const tmpl = SHADER_TEMPLATES[template.toLowerCase()];
					if (!tmpl) {
						return { content: [{ type: "text", text: `Unknown template: ${template}. Available: ${Object.keys(SHADER_TEMPLATES).join(", ")}` }], isError: true };
					}
					shaderCode = tmpl.code;
				} else if (code) {
					shaderCode = code;
				} else {
					// Generate from parts
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

				return { content: [{ type: "text", text: `Created shader at ${path}` }] };
			} catch (e) {
				return { content: [{ type: "text", text: `Error: ${e}` }], isError: true };
			}
		},
	);

	server.tool(
		"godot_read_shader",
		"Parse a .gdshader file — extract shader_type, render_modes, uniforms, varyings, functions.",
		{
			path: z.string().describe("Shader path (res:// format)"),
		},
		async ({ path }) => {
			try {
				const absPath = resToAbsolute(path, ctx.projectRoot);
				const content = readFileSync(absPath, "utf-8");
				const analysis = analyzeShader(content);
				return { content: [{ type: "text", text: JSON.stringify({ path, ...analysis, source: content }, null, 2) }] };
			} catch (e) {
				return { content: [{ type: "text", text: `Error: ${e}` }], isError: true };
			}
		},
	);

	server.tool(
		"godot_edit_shader",
		"Modify a .gdshader — add/modify a uniform, or replace a function body.",
		{
			path: z.string().describe("Shader path (res:// format)"),
			operation: z.enum(["add_uniform", "modify_uniform", "replace_function", "set_render_mode"]),
			name: z.string().optional().describe("Uniform or function name"),
			code: z.string().optional().describe("New code for the uniform declaration or function body"),
		},
		async ({ path, operation, name, code }) => {
			try {
				const absPath = resToAbsolute(path, ctx.projectRoot);
				let content = readFileSync(absPath, "utf-8");

				switch (operation) {
					case "add_uniform": {
						if (!code) return { content: [{ type: "text", text: "code is required" }], isError: true };
						// Insert after last uniform or after shader_type/render_mode
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
						if (!name || !code) return { content: [{ type: "text", text: "name and code required" }], isError: true };
						const regex = new RegExp(`^uniform\\s+\\w+\\s+${name}\\b[^;]*;`, "m");
						content = content.replace(regex, code);
						break;
					}
					case "replace_function": {
						if (!name || !code) return { content: [{ type: "text", text: "name and code required" }], isError: true };
						const funcRegex = new RegExp(`(\\w+\\s+${name}\\s*\\([^)]*\\)\\s*\\{)[^}]*(\\})`, "s");
						content = content.replace(funcRegex, `$1\n${code}\n$2`);
						break;
					}
					case "set_render_mode": {
						if (!code) return { content: [{ type: "text", text: "code required (comma-separated modes)" }], isError: true };
						if (content.includes("render_mode")) {
							content = content.replace(/render_mode[^;]*;/, `render_mode ${code};`);
						} else {
							content = content.replace(/(shader_type\s+\w+;)/, `$1\nrender_mode ${code};`);
						}
						break;
					}
				}

				writeFileSync(absPath, content, "utf-8");
				return { content: [{ type: "text", text: `Applied ${operation}${name ? ` for "${name}"` : ""} in ${path}` }] };
			} catch (e) {
				return { content: [{ type: "text", text: `Error: ${e}` }], isError: true };
			}
		},
	);

	server.tool(
		"godot_create_shader_material",
		"Create a ShaderMaterial .tres resource that references a .gdshader and sets parameter values.",
		{
			path: z.string().describe("Output .tres path (res:// format)"),
			shaderPath: z.string().describe("Path to the .gdshader file (res://)"),
			params: z.record(z.string(), z.string()).optional().describe("Shader parameter values (name → Godot Variant string)"),
		},
		async ({ path, shaderPath, params }) => {
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

				return { content: [{ type: "text", text: `Created ShaderMaterial at ${path} referencing ${shaderPath}` }] };
			} catch (e) {
				return { content: [{ type: "text", text: `Error: ${e}` }], isError: true };
			}
		},
	);

	server.tool(
		"godot_list_shader_params",
		"Extract all uniforms from a .gdshader with their types, hints, and defaults.",
		{ path: z.string().describe("Shader path (res://)") },
		async ({ path }) => {
			try {
				const absPath = resToAbsolute(path, ctx.projectRoot);
				const content = readFileSync(absPath, "utf-8");
				const analysis = analyzeShader(content);
				return { content: [{ type: "text", text: JSON.stringify(analysis.uniforms, null, 2) }] };
			} catch (e) {
				return { content: [{ type: "text", text: `Error: ${e}` }], isError: true };
			}
		},
	);

	server.tool(
		"godot_set_shader_param",
		"Set a shader parameter value on a ShaderMaterial .tres file.",
		{
			materialPath: z.string().describe("ShaderMaterial .tres path (res://)"),
			param: z.string().describe("Parameter name"),
			value: z.string().describe("Value in Godot Variant format"),
		},
		async ({ materialPath, param, value }) => {
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
				return { content: [{ type: "text", text: `Set ${param} = ${value} on ${materialPath}` }] };
			} catch (e) {
				return { content: [{ type: "text", text: `Error: ${e}` }], isError: true };
			}
		},
	);

	server.tool(
		"godot_validate_shader",
		"Validate .gdshader syntax by checking structure. Returns detected issues.",
		{ path: z.string().describe("Shader path (res://)") },
		async ({ path }) => {
			try {
				const absPath = resToAbsolute(path, ctx.projectRoot);
				const content = readFileSync(absPath, "utf-8");
				const issues: string[] = [];

				if (!content.includes("shader_type")) issues.push("Missing shader_type declaration");
				const analysis = analyzeShader(content);
				if (!["spatial", "canvas_item", "particles", "sky", "fog"].includes(analysis.shaderType)) {
					issues.push(`Invalid shader_type: ${analysis.shaderType}`);
				}

				// Check for common issues
				if (analysis.shaderType === "spatial" && !analysis.functions.some((f) => f.name === "fragment" || f.name === "vertex")) {
					issues.push("Warning: spatial shader has no vertex() or fragment() function");
				}

				return {
					content: [{
						type: "text",
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
				return { content: [{ type: "text", text: `Error: ${e}` }], isError: true };
			}
		},
	);

	server.tool(
		"godot_shader_templates",
		"List available shader templates or get a specific template's code.",
		{
			name: z.string().optional().describe("Template name to get full code for"),
		},
		async ({ name }) => {
			if (name) {
				const tmpl = SHADER_TEMPLATES[name.toLowerCase()];
				if (!tmpl) {
					return { content: [{ type: "text", text: `Unknown template. Available: ${Object.keys(SHADER_TEMPLATES).join(", ")}` }], isError: true };
				}
				return { content: [{ type: "text", text: JSON.stringify(tmpl, null, 2) }] };
			}
			return { content: [{ type: "text", text: JSON.stringify(listShaderTemplates(), null, 2) }] };
		},
	);
}
