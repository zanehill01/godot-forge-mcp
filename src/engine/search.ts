/**
 * Full-text search across Godot project files.
 */

import { readFileSync } from "node:fs";
import { type AssetManager, type AssetCategory } from "./asset-manager.js";

export interface SearchResult {
	resPath: string;
	absPath: string;
	category: AssetCategory;
	matches: SearchMatch[];
}

export interface SearchMatch {
	line: number;
	column: number;
	text: string;
	context: string;
}

export interface SearchOptions {
	/** Filter by asset category */
	category?: AssetCategory;
	/** Filter by file extension (e.g., ".gd") */
	extension?: string;
	/** Case-insensitive search */
	ignoreCase?: boolean;
	/** Max results to return */
	maxResults?: number;
	/** Use regex pattern */
	regex?: boolean;
}

const SEARCHABLE_EXTENSIONS = new Set([
	".tscn",
	".tres",
	".gd",
	".cs",
	".gdshader",
	".cfg",
	".import",
	".godot",
	".json",
	".txt",
	".md",
	".toml",
	".yaml",
	".yml",
]);

/**
 * Search across all text files in the project.
 */
export function searchProject(
	assetManager: AssetManager,
	query: string,
	options: SearchOptions = {},
): SearchResult[] {
	const results: SearchResult[] = [];
	let totalMatches = 0;
	const maxResults = options.maxResults ?? 100;

	let assets = assetManager.getAssets();

	// Filter by category
	if (options.category) {
		assets = assets.filter((a) => a.category === options.category);
	}

	// Filter by extension
	if (options.extension) {
		const ext = options.extension.startsWith(".") ? options.extension : `.${options.extension}`;
		assets = assets.filter((a) => a.ext === ext);
	}

	// Only search text files
	assets = assets.filter((a) => SEARCHABLE_EXTENSIONS.has(a.ext));

	// Build search pattern
	const flags = options.ignoreCase ? "gi" : "g";
	const pattern = options.regex ? new RegExp(query, flags) : new RegExp(escapeRegex(query), flags);

	for (const asset of assets) {
		if (totalMatches >= maxResults) break;

		let content: string;
		try {
			content = readFileSync(asset.absPath, "utf-8");
		} catch {
			continue;
		}

		const matches: SearchMatch[] = [];
		const lines = content.split("\n");

		for (let i = 0; i < lines.length; i++) {
			if (totalMatches >= maxResults) break;

			const line = lines[i];
			pattern.lastIndex = 0;
			let match = pattern.exec(line);

			while (match !== null) {
				matches.push({
					line: i + 1,
					column: match.index + 1,
					text: match[0],
					context: line.trimEnd(),
				});
				totalMatches++;
				if (totalMatches >= maxResults) break;
				match = pattern.exec(line);
			}
		}

		if (matches.length > 0) {
			results.push({
				resPath: asset.resPath,
				absPath: asset.absPath,
				category: asset.category,
				matches,
			});
		}
	}

	return results;
}

function escapeRegex(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
