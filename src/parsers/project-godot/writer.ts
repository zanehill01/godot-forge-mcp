/**
 * Writer for Godot's project.godot ConfigFile format.
 */

import { writeVariant } from "../../utils/variant.js";
import type { GodotVariant } from "../tscn/types.js";
import type { ProjectConfig } from "./parser.js";

/**
 * Write a ProjectConfig back to project.godot format.
 */
export function writeProjectGodot(config: ProjectConfig): string {
	const lines: string[] = [];

	// Godot has a specific section order preference
	const sectionOrder = [
		"",
		"application",
		"display",
		"input",
		"autoload",
		"rendering",
		"physics",
		"audio",
		"editor_plugins",
	];

	const writtenSections = new Set<string>();

	// Write sections in preferred order first
	for (const section of sectionOrder) {
		if (config.sections[section]) {
			writeSection(lines, section, config.sections[section]);
			writtenSections.add(section);
		}
	}

	// Write remaining sections
	for (const [section, values] of Object.entries(config.sections)) {
		if (!writtenSections.has(section)) {
			writeSection(lines, section, values);
		}
	}

	return `${lines.join("\n")}\n`;
}

function writeSection(
	lines: string[],
	section: string,
	values: Record<string, GodotVariant>,
): void {
	if (lines.length > 0) lines.push("");
	lines.push(`[${section}]`);
	lines.push("");

	for (const [key, value] of Object.entries(values)) {
		lines.push(`${key}=${writeVariant(value)}`);
	}
}
