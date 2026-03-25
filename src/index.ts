/**
 * Godot Forge MCP — Entry Point
 *
 * Intelligent MCP server for Godot 4.3+ game development.
 * Provides 97 tools across 11 groups with progressive discovery.
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { resolveConfig } from "./config.js";
import { createServer } from "./server.js";

async function main(): Promise<void> {
	const args = process.argv.slice(2);

	// Help
	if (args.includes("--help") || args.includes("-h")) {
		printHelp();
		process.exit(0);
	}

	// Version
	if (args.includes("--version") || args.includes("-v")) {
		console.error("godot-forge-mcp v0.1.0");
		process.exit(0);
	}

	try {
		const config = resolveConfig(args);
		console.error(`[godot-forge] Project: ${config.projectPath}`);
		console.error(`[godot-forge] Godot binary: ${config.godotBinary ?? "not found"}`);

		const server = createServer(config);

		const transport = new StdioServerTransport();
		await server.connect(transport);

		console.error("[godot-forge] Server running on stdio");
	} catch (e) {
		console.error(`[godot-forge] Fatal: ${e}`);
		process.exit(1);
	}
}

function printHelp(): void {
	console.error(`
godot-forge-mcp — Intelligent MCP server for Godot 4.3+ game development

USAGE:
  npx godot-forge-mcp [options]

OPTIONS:
  --project <path>   Path to Godot project root (auto-detects from cwd)
  --godot <path>     Path to Godot binary (searches PATH by default)
  --port <number>    WebSocket port for editor plugin (default: 6100)
  --no-connect       Skip editor plugin auto-connection
  --help, -h         Show this help
  --version, -v      Show version

ENVIRONMENT:
  GODOT_PROJECT      Godot project root path
  GODOT_BINARY       Godot binary path
  GODOT_FORGE_PORT   Editor plugin WebSocket port

CLAUDE CODE SETUP:
  claude mcp add godot-forge -- npx godot-forge-mcp --project /path/to/project
`);
}

main().catch((e) => {
	console.error(`[godot-forge] Unhandled: ${e}`);
	process.exit(1);
});
