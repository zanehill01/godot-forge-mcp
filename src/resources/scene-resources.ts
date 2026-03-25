/**
 * MCP Resources — Scene-level resources.
 *
 * godot://scene/{path} — parsed scene data
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { readFileSync } from "node:fs";
import { parseTscn } from "../parsers/tscn/parser.js";
import { resToAbsolute } from "../utils/path.js";
import type { ToolContext } from "../tools/registry.js";

export function registerSceneResources(server: McpServer, ctx: ToolContext): void {
	// Dynamic resource via template
	server.resource(
		"scene",
		"godot://scene/{path}",
		{ description: "Parsed scene data as JSON. Path should be the res:// path without the res:// prefix." },
		async (uri) => {
			// Extract path from URI: godot://scene/scenes/player.tscn
			const uriStr = typeof uri === "string" ? uri : uri.href;
			const match = uriStr.match(/godot:\/\/scene\/(.+)/);
			if (!match) {
				throw new Error(`Invalid scene URI: ${uriStr}`);
			}

			const resPath = `res://${match[1]}`;
			const absPath = resToAbsolute(resPath, ctx.projectRoot);
			const content = readFileSync(absPath, "utf-8");
			const doc = parseTscn(content);

			return {
				contents: [
					{
						uri: uriStr,
						mimeType: "application/json",
						text: JSON.stringify(doc, null, 2),
					},
				],
			};
		},
	);
}
