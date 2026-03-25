/**
 * Project engine — reads and manages Godot project state from disk.
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
	parseProjectGodot,
	extractProjectMetadata,
	type ProjectConfig,
} from "../parsers/project-godot/parser.js";

export interface ProjectInfo {
	name: string;
	path: string;
	godotVersion: string;
	renderer: string;
	mainScene: string;
	viewport: { width: number; height: number };
	autoloads: Record<string, string>;
	inputActions: string[];
	features: string[];
}

export class GodotProject {
	readonly root: string;
	private config: ProjectConfig | null = null;

	constructor(projectRoot: string) {
		this.root = projectRoot;
	}

	/**
	 * Load/reload the project configuration from disk.
	 */
	load(): void {
		const configPath = join(this.root, "project.godot");
		if (!existsSync(configPath)) {
			throw new Error(`project.godot not found at ${configPath}`);
		}
		const content = readFileSync(configPath, "utf-8");
		this.config = parseProjectGodot(content);
	}

	/**
	 * Get the parsed project config, loading if necessary.
	 */
	getConfig(): ProjectConfig {
		if (!this.config) this.load();
		return this.config!;
	}

	/**
	 * Get structured project info.
	 */
	getInfo(): ProjectInfo {
		const config = this.getConfig();
		const meta = extractProjectMetadata(config);

		// Detect Godot version from features
		let godotVersion = "4.x";
		const features = meta.features;
		if (Array.isArray(features)) {
			for (const f of features) {
				if (typeof f === "string" && /^\d+\.\d+/.test(f)) {
					godotVersion = f;
					break;
				}
			}
		}

		return {
			name: meta.name,
			path: this.root,
			godotVersion,
			renderer: meta.renderer,
			mainScene: meta.mainScene,
			viewport: meta.viewport,
			autoloads: meta.autoloads,
			inputActions: meta.inputActions,
			features: Array.isArray(features)
				? features.filter((f): f is string => typeof f === "string")
				: [],
		};
	}

	/**
	 * Get a project setting value by section/key.
	 */
	getSetting(section: string, key: string): unknown {
		const config = this.getConfig();
		return config.sections[section]?.[key];
	}

	/**
	 * Check if the project exists and is valid.
	 */
	isValid(): boolean {
		return existsSync(join(this.root, "project.godot"));
	}
}
