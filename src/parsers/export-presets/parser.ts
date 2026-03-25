/**
 * Export presets parser for export_presets.cfg.
 *
 * Reads/writes Godot export preset configurations.
 */

export interface ExportPreset {
	name: string;
	platform: string;
	runnable: boolean;
	exportPath: string;
	dedicatedServer: boolean;
	customFeatures: string;
	exportFilter: string;
	includeFilter: string;
	excludeFilter: string;
	options: Record<string, string | number | boolean>;
}

export interface ExportPresetsFile {
	presets: ExportPreset[];
}

/**
 * Parse an export_presets.cfg file.
 */
export function parseExportPresets(content: string): ExportPresetsFile {
	const result: ExportPresetsFile = { presets: [] };
	const lines = content.split("\n");

	let currentPreset: ExportPreset | null = null;
	let inOptions = false;

	for (const rawLine of lines) {
		const line = rawLine.trim();
		if (!line || line.startsWith(";") || line.startsWith("#")) continue;

		// Section header
		if (line.startsWith("[") && line.endsWith("]")) {
			const section = line.slice(1, -1);

			if (section.match(/^preset\.\d+$/)) {
				if (currentPreset) result.presets.push(currentPreset);
				currentPreset = createEmptyPreset();
				inOptions = false;
			} else if (section.match(/^preset\.\d+\.options$/)) {
				inOptions = true;
			}
			continue;
		}

		if (!currentPreset) continue;

		const eqIdx = line.indexOf("=");
		if (eqIdx === -1) continue;

		const key = line.slice(0, eqIdx).trim();
		const rawValue = line.slice(eqIdx + 1).trim();

		if (inOptions) {
			currentPreset.options[key] = parseValue(rawValue);
		} else {
			switch (key) {
				case "name":
					currentPreset.name = unquote(rawValue);
					break;
				case "platform":
					currentPreset.platform = unquote(rawValue);
					break;
				case "runnable":
					currentPreset.runnable = rawValue === "true";
					break;
				case "export_path":
					currentPreset.exportPath = unquote(rawValue);
					break;
				case "dedicated_server":
					currentPreset.dedicatedServer = rawValue === "true";
					break;
				case "custom_features":
					currentPreset.customFeatures = unquote(rawValue);
					break;
				case "export_filter":
					currentPreset.exportFilter = unquote(rawValue);
					break;
				case "include_filter":
					currentPreset.includeFilter = unquote(rawValue);
					break;
				case "exclude_filter":
					currentPreset.excludeFilter = unquote(rawValue);
					break;
			}
		}
	}

	if (currentPreset) result.presets.push(currentPreset);
	return result;
}

/**
 * Generate a GitHub Actions CI workflow for Godot exports.
 */
export function generateGodotCIWorkflow(presets: ExportPresetsFile): string {
	const platforms = presets.presets.map((p) => p.platform);
	const exportSteps = presets.presets.map((p) => {
		const exportPath = p.exportPath || `builds/${p.name.toLowerCase().replace(/\s+/g, "-")}`;
		return `      - name: Export ${p.name}
        run: godot --headless --export-release "${p.name}" "${exportPath}"`;
	});

	return `name: Godot Export
on:
  push:
    branches: [main]
    tags: ['v*']
  pull_request:
    branches: [main]

env:
  GODOT_VERSION: "4.4"

jobs:
  export:
    runs-on: ubuntu-latest
    container:
      image: barichello/godot-ci:latest

    steps:
      - uses: actions/checkout@v4

      - name: Setup export templates
        run: |
          mkdir -p ~/.local/share/godot/export_templates/\${GODOT_VERSION}.stable
          # Download export templates for your target platforms

      - name: Import project
        run: godot --headless --import

${exportSteps.join("\n\n")}

      - name: Upload artifacts
        uses: actions/upload-artifact@v4
        with:
          name: game-builds
          path: builds/
`;
}

/**
 * Validate export presets and return issues.
 */
export function validateExportPresets(presets: ExportPresetsFile): string[] {
	const issues: string[] = [];

	if (presets.presets.length === 0) {
		issues.push("No export presets configured");
		return issues;
	}

	const runnableCount = presets.presets.filter((p) => p.runnable).length;
	if (runnableCount === 0) {
		issues.push("No preset is marked as runnable");
	}

	for (const p of presets.presets) {
		if (!p.name) issues.push("Preset missing name");
		if (!p.platform) issues.push(`Preset "${p.name}" missing platform`);
		if (!p.exportPath) issues.push(`Preset "${p.name}" missing export_path`);
	}

	return issues;
}

// ── Helpers ─────────────────────────────────────────────────

function createEmptyPreset(): ExportPreset {
	return {
		name: "",
		platform: "",
		runnable: false,
		exportPath: "",
		dedicatedServer: false,
		customFeatures: "",
		exportFilter: "",
		includeFilter: "",
		excludeFilter: "",
		options: {},
	};
}

function unquote(s: string): string {
	if (s.startsWith('"') && s.endsWith('"')) return s.slice(1, -1);
	return s;
}

function parseValue(s: string): string | number | boolean {
	if (s === "true") return true;
	if (s === "false") return false;
	const num = Number(s);
	if (!Number.isNaN(num) && s !== "") return num;
	return unquote(s);
}
