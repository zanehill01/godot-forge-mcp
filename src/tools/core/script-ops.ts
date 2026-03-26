/**
 * Core Script Tool — Single tool with action-based routing.
 *
 * Actions: read, write, analyze
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ScriptManager } from "../../engine/script-manager.js";
import type { ToolContext } from "../registry.js";

export function registerScriptOpsTools(server: McpServer, ctx: ToolContext): void {
	const scriptMgr = new ScriptManager(ctx.projectRoot);

	server.tool(
		"godot_script",
		`GDScript operations. Actions:
- read: Read a GDScript file. Params: path
- write: Write/create a GDScript file. Params: path, content
- analyze: Deep analysis — extracts class_name, extends, signals, exports, methods, enums, constants, inner classes, annotations, static vars, RPC methods. Params: path`,
		{
			action: z.enum(["read", "write", "analyze"]),
			path: z.string().describe("Script path (res://)"),
			content: z.string().optional().describe("Script content (for write)"),
		},
		async ({ action, path, content }) => {
			try {
				switch (action) {
					case "read": {
						const source = scriptMgr.read(path);
						return { content: [{ type: "text", text: source }] };
					}
					case "write": {
						if (!content) return { content: [{ type: "text", text: "content required for write" }], isError: true };
						scriptMgr.write(path, content);
						ctx.getAssetManager().invalidate();
						return { content: [{ type: "text", text: `Wrote script to ${path}` }] };
					}
					case "analyze": {
						const analysis = scriptMgr.analyze(path);
						return { content: [{ type: "text", text: JSON.stringify(analysis, null, 2) }] };
					}
				}
			} catch (e) {
				return { content: [{ type: "text", text: `Error: ${e instanceof Error ? e.message : String(e)}` }], isError: true };
			}
		},
	);
}
