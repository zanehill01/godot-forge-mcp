/**
 * Plugin.cfg parser for Godot editor plugins.
 *
 * Format:
 * [plugin]
 * name="Plugin Name"
 * description="What it does"
 * author="Author"
 * version="1.0.0"
 * script="plugin.gd"
 */

export interface PluginConfig {
	name: string;
	description: string;
	author: string;
	version: string;
	script: string;
}

/**
 * Parse a plugin.cfg file.
 */
export function parsePluginCfg(content: string): PluginConfig {
	const config: PluginConfig = {
		name: "",
		description: "",
		author: "",
		version: "",
		script: "",
	};

	const lines = content.split("\n");
	let inPluginSection = false;

	for (const rawLine of lines) {
		const line = rawLine.trim();
		if (!line || line.startsWith(";") || line.startsWith("#")) continue;

		if (line === "[plugin]") {
			inPluginSection = true;
			continue;
		}
		if (line.startsWith("[")) {
			inPluginSection = false;
			continue;
		}

		if (!inPluginSection) continue;

		const eqIdx = line.indexOf("=");
		if (eqIdx === -1) continue;

		const key = line.slice(0, eqIdx).trim();
		const value = unquote(line.slice(eqIdx + 1).trim());

		switch (key) {
			case "name": config.name = value; break;
			case "description": config.description = value; break;
			case "author": config.author = value; break;
			case "version": config.version = value; break;
			case "script": config.script = value; break;
		}
	}

	return config;
}

/**
 * Write a plugin.cfg file.
 */
export function writePluginCfg(config: PluginConfig): string {
	return `[plugin]

name="${config.name}"
description="${config.description}"
author="${config.author}"
version="${config.version}"
script="${config.script}"
`;
}

/**
 * Validate a plugin configuration.
 */
export function validatePluginCfg(config: PluginConfig): string[] {
	const issues: string[] = [];
	if (!config.name) issues.push("Missing plugin name");
	if (!config.script) issues.push("Missing plugin script path");
	if (!config.version) issues.push("Missing plugin version");
	if (!config.author) issues.push("Missing plugin author");
	return issues;
}

/**
 * Generate a scaffold for a new Godot editor plugin.
 */
export function generatePluginScaffold(config: PluginConfig): Record<string, string> {
	const files: Record<string, string> = {};

	// plugin.cfg
	files["plugin.cfg"] = writePluginCfg(config);

	// plugin.gd
	files[config.script || "plugin.gd"] = `@tool
extends EditorPlugin

func _enter_tree() -> void:
\t# Initialization of the plugin goes here.
\tpass

func _exit_tree() -> void:
\t# Clean-up of the plugin goes here.
\tpass
`;

	return files;
}

function unquote(s: string): string {
	if (s.startsWith('"') && s.endsWith('"')) return s.slice(1, -1);
	return s;
}
