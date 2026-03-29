/**
 * Configuration for the Godot Forge MCP server.
 *
 * Includes platform-aware auto-detection of the Godot binary
 * across standard install locations, Steam, Scoop, Homebrew, Flatpak, and Snap.
 */

import { existsSync } from "node:fs";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
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

	// Godot binary: --godot flag > GODOT_BINARY env > auto-detect
	const godotBinary =
		getArgValue(args, "--godot") ?? process.env.GODOT_BINARY ?? findGodotBinary();

	if (godotBinary) {
		console.error(`[godot-forge] Godot binary: ${godotBinary}`);
	} else {
		console.error("[godot-forge] Godot binary not found — CLI bridge disabled. Set --godot or install Godot to PATH.");
	}

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

/**
 * Auto-detect the Godot binary across platforms.
 *
 * Search order:
 * 1. Platform-specific common install locations
 * 2. PATH lookup via `which`/`where`
 * 3. Steam install directories
 */
function findGodotBinary(): string | null {
	// Platform-specific install directories
	const candidates: string[] = [];

	if (process.platform === "win32") {
		const home = process.env.USERPROFILE ?? "C:/Users/Default";
		const localAppData = process.env.LOCALAPPDATA ?? join(home, "AppData/Local");
		const programFiles = process.env.ProgramFiles ?? "C:/Program Files";
		const programFilesX86 = process.env["ProgramFiles(x86)"] ?? "C:/Program Files (x86)";
		const scoop = process.env.SCOOP ?? join(home, "scoop");

		candidates.push(
			// Standard install locations
			join(programFiles, "Godot/Godot.exe"),
			join(programFilesX86, "Godot/Godot.exe"),
			join(localAppData, "Godot/Godot.exe"),
			// Scoop package manager
			join(scoop, "apps/godot/current/Godot.exe"),
			join(scoop, "apps/godot-mono/current/Godot.exe"),
			// Steam (Windows)
			join(programFilesX86, "Steam/steamapps/common/Godot Engine/Godot_v4.exe"),
			join(programFiles, "Steam/steamapps/common/Godot Engine/Godot_v4.exe"),
			// Winget / Microsoft Store
			join(localAppData, "Programs/Godot/Godot.exe"),
		);

		// Scan common user directories for Godot executables (e.g., downloaded to Desktop)
		for (const dir of [join(home, "Desktop"), join(home, "Downloads"), localAppData]) {
			try {
				if (existsSync(dir)) {
					for (const f of readdirSync(dir)) {
						if (/^Godot_v4[^/]*\.exe$/i.test(f) && !f.includes("console")) {
							candidates.push(join(dir, f));
						}
					}
				}
			} catch { /* skip unreadable dirs */ }
		}
	} else if (process.platform === "darwin") {
		candidates.push(
			// Homebrew
			"/opt/homebrew/bin/godot",
			"/usr/local/bin/godot",
			// Application bundle
			"/Applications/Godot.app/Contents/MacOS/Godot",
			"/Applications/Godot_mono.app/Contents/MacOS/Godot",
			// Steam (macOS)
			join(process.env.HOME ?? "~", "Library/Application Support/Steam/steamapps/common/Godot Engine/Godot.app/Contents/MacOS/Godot"),
		);
	} else {
		// Linux
		const home = process.env.HOME ?? "~";
		candidates.push(
			"/usr/bin/godot",
			"/usr/bin/godot4",
			"/usr/local/bin/godot",
			"/usr/local/bin/godot4",
			// Flatpak
			"/var/lib/flatpak/exports/bin/org.godotengine.Godot",
			join(home, ".local/share/flatpak/exports/bin/org.godotengine.Godot"),
			// Snap
			"/snap/bin/godot-engine",
			"/snap/bin/godot",
			// Steam (Linux)
			join(home, ".steam/steam/steamapps/common/Godot Engine/godot.x86_64"),
			join(home, ".local/share/Steam/steamapps/common/Godot Engine/godot.x86_64"),
			// AppImage in common locations
			join(home, "Applications/Godot.AppImage"),
		);

		// Scan ~/Downloads and ~/Desktop for Godot AppImages / binaries
		for (const dir of [join(home, "Downloads"), join(home, "Desktop")]) {
			try {
				if (existsSync(dir)) {
					for (const f of readdirSync(dir)) {
						if (/^Godot_v4.*\.(x86_64|AppImage)$/i.test(f)) {
							candidates.push(join(dir, f));
						}
					}
				}
			} catch { /* skip */ }
		}
	}

	// Check each candidate
	for (const p of candidates) {
		try {
			if (existsSync(p)) return p;
		} catch { /* skip */ }
	}

	// Fall back to PATH lookup
	const names = ["godot", "godot4", "Godot_v4"];
	const cmd = process.platform === "win32" ? "where" : "which";
	for (const name of names) {
		try {
			const result = spawnSync(cmd, [name], { encoding: "utf8", stdio: "pipe" });
			if (result.status === 0 && result.stdout) {
				const firstLine = result.stdout.trim().split("\n")[0];
				if (firstLine) return firstLine;
			}
		} catch { /* not found */ }
	}

	return null;
}
