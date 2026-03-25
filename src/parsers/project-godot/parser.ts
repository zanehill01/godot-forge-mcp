/**
 * Parser for Godot's project.godot ConfigFile format.
 *
 * The format is INI-like with typed values:
 * [section]
 * key=value
 *
 * Values use Godot Variant syntax (strings, numbers, booleans, arrays, etc.)
 */

import { parseVariant } from "../../utils/variant.js";
import type { GodotVariant } from "../tscn/types.js";

export interface ProjectConfig {
	sections: Record<string, Record<string, GodotVariant>>;
}

/**
 * Parse a project.godot file into structured sections.
 */
export function parseProjectGodot(content: string): ProjectConfig {
	const config: ProjectConfig = { sections: {} };
	const lines = content.split("\n");
	let currentSection = "";

	for (const rawLine of lines) {
		const line = rawLine.trimEnd();

		// Skip empty lines and comments
		if (line === "" || line.startsWith(";") || line.startsWith("#")) {
			continue;
		}

		// Section header
		if (line.startsWith("[") && line.endsWith("]")) {
			currentSection = line.slice(1, -1);
			if (!config.sections[currentSection]) {
				config.sections[currentSection] = {};
			}
			continue;
		}

		// Key=value pair
		const eqIdx = line.indexOf("=");
		if (eqIdx !== -1) {
			const key = line.slice(0, eqIdx).trim();
			const rawValue = line.slice(eqIdx + 1).trim();
			if (!config.sections[currentSection]) {
				config.sections[currentSection] = {};
			}
			config.sections[currentSection][key] = parseVariant(rawValue);
		}
	}

	return config;
}

/**
 * Get a value from a project config using section/key path.
 */
export function getConfigValue(
	config: ProjectConfig,
	section: string,
	key: string,
): GodotVariant | undefined {
	return config.sections[section]?.[key];
}

/**
 * Extract common project metadata from a parsed project.godot.
 */
export function extractProjectMetadata(config: ProjectConfig) {
	const app = config.sections.application ?? {};
	const display = config.sections.display ?? {};
	const rendering = config.sections.rendering ?? {};

	return {
		name: (app["config/name"] as string) ?? "Unknown",
		mainScene: (app["run/main_scene"] as string) ?? "",
		features: app["config/features"] ?? [],
		viewport: {
			width: (display["window/size/viewport_width"] as number) ?? 1152,
			height: (display["window/size/viewport_height"] as number) ?? 648,
		},
		renderer: (rendering["renderer/rendering_method"] as string) ?? "forward_plus",
		autoloads: extractAutoloads(config),
		inputActions: extractInputActions(config),
	};
}

function extractAutoloads(config: ProjectConfig): Record<string, string> {
	const autoloads: Record<string, string> = {};
	const section = config.sections.autoload ?? {};
	for (const [key, value] of Object.entries(section)) {
		if (typeof value === "string") {
			// Autoloads are like: MyGlobal="*res://scripts/my_global.gd"
			autoloads[key] = value.startsWith("*") ? value.slice(1) : value;
		}
	}
	return autoloads;
}

function extractInputActions(config: ProjectConfig): string[] {
	const section = config.sections.input ?? {};
	return Object.keys(section);
}
