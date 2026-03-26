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
 * Validates the resolved path stays within the project root to prevent path traversal.
 */
export function resToAbsolute(resPath: string, projectRoot: string): string {
	if (!resPath.startsWith("res://")) {
		throw new Error(`Not a res:// path: ${resPath}`);
	}
	const relativePart = resPath.slice("res://".length);
	const resolved = resolve(join(projectRoot, ...relativePart.split("/")));
	const root = resolve(projectRoot);

	if (!resolved.startsWith(root + sep) && resolved !== root) {
		throw new Error(`Path traversal detected: ${resPath} resolves outside project root`);
	}

	return resolved;
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
 * Uses sep-aware comparison to avoid false positives (e.g., /project-v2 matching /project).
 */
export function isInProject(absPath: string, projectRoot: string): boolean {
	const resolved = resolve(absPath);
	const root = resolve(projectRoot);
	return resolved === root || resolved.startsWith(root + sep);
}

/**
 * Validate and resolve a res:// path, throwing on traversal attempts.
 * Use this as the single entry point for all user-provided res:// paths.
 */
export function safeResolvePath(resPath: string, projectRoot: string): string {
	const abs = resToAbsolute(resPath, projectRoot);
	if (!isInProject(abs, projectRoot)) {
		throw new Error(`Path traversal detected: ${resPath} resolves outside project root`);
	}
	return abs;
}

/**
 * Escape a string for safe use in RegExp constructors.
 * Prevents ReDoS attacks from user-supplied strings.
 */
export function escapeRegex(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
