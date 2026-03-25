/**
 * Path utilities for Godot project resolution.
 *
 * Handles res:// path conversion and project root detection.
 */

import { existsSync } from "node:fs";
import { dirname, join, resolve, relative, sep } from "node:path";

const PROJECT_FILE = "project.godot";

/**
 * Find the Godot project root by walking up from a starting directory,
 * looking for project.godot.
 */
export function findProjectRoot(startDir: string): string | null {
	let current = resolve(startDir);

	while (true) {
		if (existsSync(join(current, PROJECT_FILE))) {
			return current;
		}
		const parent = dirname(current);
		if (parent === current) break; // reached filesystem root
		current = parent;
	}

	return null;
}

/**
 * Convert a res:// path to an absolute filesystem path.
 */
export function resToAbsolute(resPath: string, projectRoot: string): string {
	if (!resPath.startsWith("res://")) {
		throw new Error(`Not a res:// path: ${resPath}`);
	}
	const relativePart = resPath.slice("res://".length);
	return join(projectRoot, ...relativePart.split("/"));
}

/**
 * Convert an absolute filesystem path to a res:// path.
 */
export function absoluteToRes(absPath: string, projectRoot: string): string {
	const rel = relative(projectRoot, absPath);
	// Normalize to forward slashes
	const normalized = rel.split(sep).join("/");
	return `res://${normalized}`;
}

/**
 * Check if a path is within a Godot project.
 */
export function isInProject(absPath: string, projectRoot: string): boolean {
	const resolved = resolve(absPath);
	const root = resolve(projectRoot);
	return resolved.startsWith(root);
}

/**
 * Generate a unique resource ID in Godot's format.
 * Format: alphanumeric string, typically 5 chars with a number prefix.
 */
export function generateResourceId(prefix?: string): string {
	const chars = "abcdefghijklmnopqrstuvwxyz";
	const numPart = Math.floor(Math.random() * 10);
	let strPart = "";
	for (let i = 0; i < 5; i++) {
		strPart += chars[Math.floor(Math.random() * chars.length)];
	}
	return prefix ? `${prefix}_${numPart}${strPart}` : `${numPart}_${strPart}`;
}
