/**
 * Configuration for the Godot Forge MCP server.
 */

import { findProjectRoot } from "./utils/path.js";

export interface ForgeConfig {
	/** Absolute path to the Godot project root (directory containing project.godot) */
	projectPath: string;
	/** Path to the Godot binary (auto-detected or explicit) */
	godotBinary: string | null;
	/** WebSocket port for editor plugin communication */
	pluginPort: number;
	/** Whether to attempt editor plugin connection on startup */
	autoConnect: boolean;
}

/**
 * Resolve configuration from environment and arguments.
 */
export function resolveConfig(args: string[]): ForgeConfig {
	// Project path: --project flag > GODOT_PROJECT env > auto-detect from cwd
	let projectPath = getArgValue(args, "--project") ?? process.env.GODOT_PROJECT ?? null;

	if (!projectPath) {
		projectPath = findProjectRoot(process.cwd());
	}

	if (!projectPath) {
		throw new Error(
			"Could not find Godot project. Provide --project <path>, set GODOT_PROJECT env var, " +
				"or run from within a Godot project directory.",
		);
	}

	// Godot binary: --godot flag > GODOT_BINARY env > search PATH
	const godotBinary =
		getArgValue(args, "--godot") ?? process.env.GODOT_BINARY ?? findGodotBinary();

	// Plugin port: --port flag > GODOT_FORGE_PORT env > default 6100
	const rawPort = getArgValue(args, "--port") ?? process.env.GODOT_FORGE_PORT ?? "6100";
	const pluginPort = Number(rawPort);
	if (Number.isNaN(pluginPort) || pluginPort < 1 || pluginPort > 65535) {
		throw new Error(`Invalid port number: ${rawPort}. Must be between 1 and 65535.`);
	}

	const autoConnect = !args.includes("--no-connect");

	return {
		projectPath,
		godotBinary,
		pluginPort,
		autoConnect,
	};
}

function getArgValue(args: string[], flag: string): string | null {
	const idx = args.indexOf(flag);
	if (idx !== -1 && idx + 1 < args.length) {
		return args[idx + 1];
	}
	return null;
}

function findGodotBinary(): string | null {
	// Common Godot binary names across platforms
	const names = ["godot", "godot4", "Godot_v4"];

	// On Windows, also check common install locations
	if (process.platform === "win32") {
		const commonPaths = [
			"C:/Program Files/Godot/Godot.exe",
			"C:/Program Files (x86)/Godot/Godot.exe",
			`${process.env.LOCALAPPDATA}/Godot/Godot.exe`,
			`${process.env.SCOOP}/apps/godot/current/Godot.exe`,
		];
		for (const p of commonPaths) {
			try {
				const { existsSync } = require("node:fs");
				if (existsSync(p)) return p;
			} catch {
				// skip
			}
		}
	}

	// Try to find in PATH via `which` or `where` — use spawnSync to prevent command injection
	try {
		const { spawnSync } = require("node:child_process");
		const cmd = process.platform === "win32" ? "where" : "which";
		for (const name of names) {
			try {
				const result = spawnSync(cmd, [name], { encoding: "utf8", stdio: "pipe" });
				if (result.status === 0 && result.stdout) {
					const firstLine = result.stdout.trim().split("\n")[0];
					if (firstLine) return firstLine;
				}
			} catch {
				// not found, try next
			}
		}
	} catch {
		// skip
	}

	return null;
}
