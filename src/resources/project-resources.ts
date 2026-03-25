/**
 * MCP Resources — Project-level resources.
 *
 * godot://project/info, godot://project/settings, godot://project/structure
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "../tools/registry.js";

export function registerProjectResources(server: McpServer, ctx: ToolContext): void {
	server.resource(
		"project-info",
		"godot://project/info",
		{ description: "Godot project metadata: name, version, renderer, autoloads, input actions" },
		async () => {
			const info = ctx.getProject().getInfo();
			return {
				contents: [
					{
						uri: "godot://project/info",
						mimeType: "application/json",
						text: JSON.stringify(info, null, 2),
					},
				],
			};
		},
	);

	server.resource(
		"project-structure",
		"godot://project/structure",
		{ description: "Project file tree organized by category" },
		async () => {
			const assets = ctx.getAssetManager().getAssets();
			const structure: Record<string, string[]> = {};

			for (const asset of assets) {
				if (!structure[asset.category]) {
					structure[asset.category] = [];
				}
				structure[asset.category].push(asset.resPath);
			}

			return {
				contents: [
					{
						uri: "godot://project/structure",
						mimeType: "application/json",
						text: JSON.stringify(structure, null, 2),
					},
				],
			};
		},
	);

	server.resource(
		"input-map",
		"godot://input_map",
		{ description: "All configured input actions and their bindings" },
		async () => {
			const config = ctx.getProject().getConfig();
			const inputSection = config.sections.input ?? {};

			return {
				contents: [
					{
						uri: "godot://input_map",
						mimeType: "application/json",
						text: JSON.stringify(inputSection, null, 2),
					},
				],
			};
		},
	);

	server.resource(
		"autoloads",
		"godot://autoloads",
		{ description: "Autoload singletons configured in the project" },
		async () => {
			const info = ctx.getProject().getInfo();

			return {
				contents: [
					{
						uri: "godot://autoloads",
						mimeType: "application/json",
						text: JSON.stringify(info.autoloads, null, 2),
					},
				],
			};
		},
	);
}
