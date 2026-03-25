/**
 * UID file parser and manager for Godot 4.4+
 *
 * Godot 4.4 introduces .uid files alongside scripts and shaders.
 * Each .uid file contains a single line: uid://&lt;base62-id&gt;
 * UIDs are also embedded in .tscn/.tres headers.
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, dirname, basename, extname, relative, sep } from "node:path";
import { generateUid, isValidUid } from "../../utils/uid.js";

export interface UidEntry {
	/** The UID value (e.g., "uid://abc123def456g") */
	uid: string;
	/** The source file this UID belongs to */
	sourceFile: string;
	/** The .uid file path (if it exists) */
	uidFile: string | null;
	/** Whether the .uid file exists on disk */
	hasUidFile: boolean;
}

export interface UidIntegrityReport {
	/** Total scripts/shaders found */
	totalFiles: number;
	/** Files with valid .uid files */
	withUid: number;
	/** Files missing .uid files */
	missingUid: string[];
	/** Duplicate UIDs found */
	duplicates: Array<{ uid: string; files: string[] }>;
	/** Invalid .uid files (malformed content) */
	invalid: Array<{ file: string; reason: string }>;
	/** Orphaned .uid files (no matching source file) */
	orphaned: string[];
}

const UID_EXTENSIONS = new Set([".gd", ".cs", ".gdshader", ".gdshaderinc"]);
const IGNORE_DIRS = new Set([".godot", ".git", ".import", "node_modules", "__pycache__"]);

/**
 * Parse a .uid file and return its UID value.
 */
export function parseUidFile(content: string): string | null {
	const trimmed = content.trim();
	if (isValidUid(trimmed)) {
		return trimmed;
	}
	return null;
}

/**
 * Generate a .uid file content.
 */
export function writeUidFile(uid?: string): string {
	return (uid ?? generateUid()) + "\n";
}

/**
 * Get the expected .uid file path for a given source file.
 */
export function getUidFilePath(sourceFile: string): string {
	return sourceFile + ".uid";
}

/**
 * Scan a project and build a complete UID inventory.
 */
export function scanProjectUids(projectRoot: string): UidEntry[] {
	const entries: UidEntry[] = [];
	walkForUids(projectRoot, projectRoot, entries);
	return entries;
}

/**
 * Check UID integrity across a project.
 */
export function checkUidIntegrity(projectRoot: string): UidIntegrityReport {
	const entries = scanProjectUids(projectRoot);
	const uidMap = new Map<string, string[]>();

	const report: UidIntegrityReport = {
		totalFiles: 0,
		withUid: 0,
		missingUid: [],
		duplicates: [],
		invalid: [],
		orphaned: [],
	};

	// Check source files
	for (const entry of entries) {
		report.totalFiles++;

		if (entry.hasUidFile && entry.uid) {
			report.withUid++;

			// Track for duplicate detection
			if (!uidMap.has(entry.uid)) {
				uidMap.set(entry.uid, []);
			}
			uidMap.get(entry.uid)!.push(entry.sourceFile);
		} else if (!entry.hasUidFile) {
			report.missingUid.push(entry.sourceFile);
		}
	}

	// Find duplicates
	for (const [uid, files] of uidMap) {
		if (files.length > 1) {
			report.duplicates.push({ uid, files });
		}
	}

	// Find orphaned .uid files
	findOrphanedUidFiles(projectRoot, projectRoot, entries, report);

	return report;
}

/**
 * Generate missing .uid files for all scripts/shaders in a project.
 */
export function generateMissingUids(projectRoot: string): Array<{ file: string; uid: string }> {
	const report = checkUidIntegrity(projectRoot);
	const generated: Array<{ file: string; uid: string }> = [];

	for (const file of report.missingUid) {
		const uid = generateUid();
		const uidPath = getUidFilePath(join(projectRoot, file));
		writeFileSync(uidPath, writeUidFile(uid), "utf-8");
		generated.push({ file, uid });
	}

	return generated;
}

/**
 * Read the UID for a source file, generating one if missing.
 */
export function ensureUid(sourceFilePath: string): string {
	const uidPath = getUidFilePath(sourceFilePath);

	if (existsSync(uidPath)) {
		const content = readFileSync(uidPath, "utf-8");
		const uid = parseUidFile(content);
		if (uid) return uid;
	}

	// Generate new UID
	const uid = generateUid();
	writeFileSync(uidPath, writeUidFile(uid), "utf-8");
	return uid;
}

/**
 * Move a source file and its .uid file together.
 */
export function safeFileMove(
	oldPath: string,
	newPath: string,
): { movedSource: boolean; movedUid: boolean } {
	const result = { movedSource: false, movedUid: false };

	if (existsSync(oldPath)) {
		const content = readFileSync(oldPath, "utf-8");
		const dir = dirname(newPath);
		const { mkdirSync } = require("node:fs");
		mkdirSync(dir, { recursive: true });
		writeFileSync(newPath, content, "utf-8");
		const { unlinkSync } = require("node:fs");
		unlinkSync(oldPath);
		result.movedSource = true;
	}

	const oldUidPath = getUidFilePath(oldPath);
	const newUidPath = getUidFilePath(newPath);
	if (existsSync(oldUidPath)) {
		const uidContent = readFileSync(oldUidPath, "utf-8");
		writeFileSync(newUidPath, uidContent, "utf-8");
		const { unlinkSync } = require("node:fs");
		unlinkSync(oldUidPath);
		result.movedUid = true;
	}

	return result;
}

// ── Private helpers ─────────────────────────────────────────

function walkForUids(dir: string, projectRoot: string, entries: UidEntry[]): void {
	let dirEntries: string[];
	try {
		dirEntries = readdirSync(dir);
	} catch {
		return;
	}

	for (const entry of dirEntries) {
		if (IGNORE_DIRS.has(entry)) continue;

		const fullPath = join(dir, entry);
		let fileStat;
		try {
			fileStat = statSync(fullPath);
		} catch {
			continue;
		}

		if (fileStat.isDirectory()) {
			walkForUids(fullPath, projectRoot, entries);
		} else if (fileStat.isFile()) {
			const ext = extname(entry).toLowerCase();
			if (!UID_EXTENSIONS.has(ext)) continue;
			if (entry.endsWith(".uid")) continue;

			const relPath = relative(projectRoot, fullPath).split(sep).join("/");
			const uidPath = getUidFilePath(fullPath);
			let uid = "";
			let hasUidFile = false;

			if (existsSync(uidPath)) {
				hasUidFile = true;
				try {
					const content = readFileSync(uidPath, "utf-8");
					uid = parseUidFile(content) ?? "";
				} catch {
					// invalid uid file
				}
			}

			entries.push({
				uid,
				sourceFile: relPath,
				uidFile: hasUidFile ? relPath + ".uid" : null,
				hasUidFile,
			});
		}
	}
}

function findOrphanedUidFiles(
	dir: string,
	projectRoot: string,
	entries: UidEntry[],
	report: UidIntegrityReport,
): void {
	let dirEntries: string[];
	try {
		dirEntries = readdirSync(dir);
	} catch {
		return;
	}

	const sourceFiles = new Set(entries.map((e) => e.sourceFile));

	for (const entry of dirEntries) {
		if (IGNORE_DIRS.has(entry)) continue;

		const fullPath = join(dir, entry);
		let fileStat;
		try {
			fileStat = statSync(fullPath);
		} catch {
			continue;
		}

		if (fileStat.isDirectory()) {
			findOrphanedUidFiles(fullPath, projectRoot, entries, report);
		} else if (entry.endsWith(".uid")) {
			// Check if the source file exists
			const sourceFileName = entry.slice(0, -4); // remove .uid
			const sourcePath = join(dir, sourceFileName);
			if (!existsSync(sourcePath)) {
				const relPath = relative(projectRoot, fullPath).split(sep).join("/");
				report.orphaned.push(relPath);
			}
		}
	}
}
