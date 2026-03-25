/**
 * GDExtension file parser (.gdextension).
 *
 * Parses the INI-like format with 4 sections:
 * - [configuration]: entry_symbol, compatibility_minimum/maximum, reloadable
 * - [libraries]: platform.build.arch = "path"
 * - [icons]: ClassName = "icon_path"
 * - [dependencies]: platform.build = { "lib": "target" }
 */

export interface GDExtensionFile {
	configuration: {
		entrySymbol: string;
		compatibilityMinimum: string;
		compatibilityMaximum: string | null;
		reloadable: boolean;
		androidAarPlugin: boolean;
	};
	libraries: LibraryEntry[];
	icons: Array<{ className: string; iconPath: string }>;
	dependencies: DependencyEntry[];
}

export interface LibraryEntry {
	platform: string;
	buildType: string;
	architecture: string | null;
	path: string;
	/** Raw key for roundtrip */
	rawKey: string;
}

export interface DependencyEntry {
	platform: string;
	buildType: string;
	dependencies: Record<string, string>;
	rawKey: string;
}

const VALID_PLATFORMS = new Set([
	"windows", "macos", "linux", "bsd", "linuxbsd",
	"android", "ios", "web",
]);

const VALID_BUILD_TYPES = new Set(["debug", "release", "editor"]);

const VALID_ARCHITECTURES = new Set([
	"x86_32", "x86_64", "arm32", "arm64",
	"rv64", "riscv", "wasm32",
	"single", "double", // precision
	"universal",
]);

/**
 * Parse a .gdextension file.
 */
export function parseGDExtension(content: string): GDExtensionFile {
	const result: GDExtensionFile = {
		configuration: {
			entrySymbol: "",
			compatibilityMinimum: "",
			compatibilityMaximum: null,
			reloadable: false,
			androidAarPlugin: false,
		},
		libraries: [],
		icons: [],
		dependencies: [],
	};

	const lines = content.split("\n");
	let currentSection = "";

	for (const rawLine of lines) {
		const line = rawLine.trim();
		if (!line || line.startsWith(";") || line.startsWith("#")) continue;

		// Section header
		if (line.startsWith("[") && line.endsWith("]")) {
			currentSection = line.slice(1, -1).trim();
			continue;
		}

		const eqIdx = line.indexOf("=");
		if (eqIdx === -1) continue;

		const key = line.slice(0, eqIdx).trim();
		const rawValue = line.slice(eqIdx + 1).trim();

		switch (currentSection) {
			case "configuration":
				parseConfigEntry(key, rawValue, result.configuration);
				break;
			case "libraries":
				result.libraries.push(parseLibraryEntry(key, rawValue));
				break;
			case "icons":
				result.icons.push({ className: key, iconPath: unquote(rawValue) });
				break;
			case "dependencies":
				result.dependencies.push(parseDependencyEntry(key, rawValue));
				break;
		}
	}

	return result;
}

/**
 * Write a .gdextension file.
 */
export function writeGDExtension(ext: GDExtensionFile): string {
	const lines: string[] = [];

	// Configuration
	lines.push("[configuration]");
	lines.push("");
	lines.push(`entry_symbol = "${ext.configuration.entrySymbol}"`);
	lines.push(`compatibility_minimum = "${ext.configuration.compatibilityMinimum}"`);
	if (ext.configuration.compatibilityMaximum) {
		lines.push(`compatibility_maximum = "${ext.configuration.compatibilityMaximum}"`);
	}
	if (ext.configuration.reloadable) {
		lines.push("reloadable = true");
	}
	if (ext.configuration.androidAarPlugin) {
		lines.push("android_aar_plugin = true");
	}
	lines.push("");

	// Libraries
	if (ext.libraries.length > 0) {
		lines.push("[libraries]");
		lines.push("");
		for (const lib of ext.libraries) {
			lines.push(`${lib.rawKey} = "${lib.path}"`);
		}
		lines.push("");
	}

	// Icons
	if (ext.icons.length > 0) {
		lines.push("[icons]");
		lines.push("");
		for (const icon of ext.icons) {
			lines.push(`${icon.className} = "${icon.iconPath}"`);
		}
		lines.push("");
	}

	// Dependencies
	if (ext.dependencies.length > 0) {
		lines.push("[dependencies]");
		lines.push("");
		for (const dep of ext.dependencies) {
			const entries = Object.entries(dep.dependencies)
				.map(([k, v]) => `"${k}": "${v}"`)
				.join(", ");
			lines.push(`${dep.rawKey} = { ${entries} }`);
		}
		lines.push("");
	}

	return lines.join("\n");
}

/**
 * Get platform coverage matrix for a GDExtension.
 */
export function getPlatformMatrix(ext: GDExtensionFile): Record<string, string[]> {
	const matrix: Record<string, string[]> = {};
	for (const lib of ext.libraries) {
		if (!matrix[lib.platform]) matrix[lib.platform] = [];
		const entry = lib.architecture ? `${lib.buildType}.${lib.architecture}` : lib.buildType;
		matrix[lib.platform].push(entry);
	}
	return matrix;
}

/**
 * Validate a GDExtension file and return issues.
 */
export function validateGDExtension(ext: GDExtensionFile): string[] {
	const issues: string[] = [];

	if (!ext.configuration.entrySymbol) {
		issues.push("Missing entry_symbol in [configuration]");
	}
	if (!ext.configuration.compatibilityMinimum) {
		issues.push("Missing compatibility_minimum in [configuration]");
	}

	for (const lib of ext.libraries) {
		if (!VALID_PLATFORMS.has(lib.platform)) {
			issues.push(`Unknown platform "${lib.platform}" in library: ${lib.rawKey}`);
		}
		if (!VALID_BUILD_TYPES.has(lib.buildType)) {
			issues.push(`Unknown build type "${lib.buildType}" in library: ${lib.rawKey}`);
		}
		if (lib.architecture && !VALID_ARCHITECTURES.has(lib.architecture)) {
			issues.push(`Unknown architecture "${lib.architecture}" in library: ${lib.rawKey}`);
		}
	}

	// Check for missing platform coverage
	const platforms = new Set(ext.libraries.map((l) => l.platform));
	const essentialPlatforms = ["windows", "linux", "macos"];
	for (const p of essentialPlatforms) {
		if (!platforms.has(p)) {
			issues.push(`No library configured for platform: ${p}`);
		}
	}

	return issues;
}

// ── Helpers ─────────────────────────────────────────────────

function unquote(s: string): string {
	if (s.startsWith('"') && s.endsWith('"')) return s.slice(1, -1);
	return s;
}

function parseConfigEntry(
	key: string,
	value: string,
	config: GDExtensionFile["configuration"],
): void {
	const v = unquote(value);
	switch (key) {
		case "entry_symbol":
			config.entrySymbol = v;
			break;
		case "compatibility_minimum":
			config.compatibilityMinimum = v;
			break;
		case "compatibility_maximum":
			config.compatibilityMaximum = v;
			break;
		case "reloadable":
			config.reloadable = v === "true";
			break;
		case "android_aar_plugin":
			config.androidAarPlugin = v === "true";
			break;
	}
}

function parseLibraryEntry(key: string, value: string): LibraryEntry {
	const parts = key.split(".");
	return {
		platform: parts[0] ?? "",
		buildType: parts[1] ?? "",
		architecture: parts[2] ?? null,
		path: unquote(value),
		rawKey: key,
	};
}

function parseDependencyEntry(key: string, value: string): DependencyEntry {
	const parts = key.split(".");
	const dependencies: Record<string, string> = {};

	// Parse { "lib.so": "", "lib2.so": "target" }
	// Use a proper parser that respects quotes to avoid splitting "res://path" on ":"
	const match = value.match(/\{([^}]*)\}/);
	if (match) {
		const inner = match[1].trim();
		// Extract all "key": "value" pairs using regex
		const pairRegex = /"([^"]*?)"\s*:\s*"([^"]*?)"/g;
		let pairMatch: RegExpExecArray | null;
		while ((pairMatch = pairRegex.exec(inner)) !== null) {
			dependencies[pairMatch[1]] = pairMatch[2];
		}
	}

	return {
		platform: parts[0] ?? "",
		buildType: parts[1] ?? "",
		dependencies,
		rawKey: key,
	};
}
