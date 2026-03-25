/**
 * CLI Bridge — Invoke Godot binary headlessly for validation, export, and script execution.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { writeFileSync, unlinkSync, existsSync } from "node:fs";
import { join } from "node:path";

export interface CliResult {
	exitCode: number | null;
	stdout: string;
	stderr: string;
	timedOut: boolean;
}

export class CliBridge {
	private godotBinary: string;
	private projectRoot: string;
	private runningProcess: ChildProcess | null = null;

	constructor(godotBinary: string, projectRoot: string) {
		this.godotBinary = godotBinary;
		this.projectRoot = projectRoot;
	}

	/**
	 * Check if the Godot binary is available.
	 */
	isAvailable(): boolean {
		return !!this.godotBinary && existsSync(this.godotBinary);
	}

	/**
	 * Run a Godot command with arguments.
	 */
	async run(args: string[], timeout: number = 30000): Promise<CliResult> {
		return new Promise((resolve) => {
			let stdout = "";
			let stderr = "";
			let timedOut = false;

			const proc = spawn(this.godotBinary, ["--path", this.projectRoot, ...args], {
				cwd: this.projectRoot,
				stdio: "pipe",
			});

			proc.stdout?.on("data", (data: Buffer) => {
				stdout += data.toString();
			});

			proc.stderr?.on("data", (data: Buffer) => {
				stderr += data.toString();
			});

			const timer = setTimeout(() => {
				timedOut = true;
				proc.kill("SIGTERM");
			}, timeout);

			proc.on("close", (code) => {
				clearTimeout(timer);
				resolve({ exitCode: code, stdout, stderr, timedOut });
			});

			proc.on("error", (err) => {
				clearTimeout(timer);
				resolve({
					exitCode: -1,
					stdout: "",
					stderr: err.message,
					timedOut: false,
				});
			});
		});
	}

	/**
	 * Run a project (game).
	 */
	async runProject(scene?: string, timeout: number = 30000): Promise<CliResult> {
		// Kill existing if running
		this.stopProject();

		const args: string[] = [];
		if (scene) args.push(scene);

		return new Promise((resolve) => {
			let stdout = "";
			let stderr = "";
			let timedOut = false;

			const proc = spawn(this.godotBinary, ["--path", this.projectRoot, ...args], {
				cwd: this.projectRoot,
				stdio: "pipe",
			});

			this.runningProcess = proc;

			proc.stdout?.on("data", (data: Buffer) => {
				stdout += data.toString();
			});

			proc.stderr?.on("data", (data: Buffer) => {
				stderr += data.toString();
			});

			const timer = setTimeout(() => {
				timedOut = true;
				proc.kill("SIGTERM");
			}, timeout);

			proc.on("close", (code) => {
				clearTimeout(timer);
				this.runningProcess = null;
				resolve({ exitCode: code, stdout, stderr, timedOut });
			});

			proc.on("error", (err) => {
				clearTimeout(timer);
				this.runningProcess = null;
				resolve({
					exitCode: -1,
					stdout: "",
					stderr: err.message,
					timedOut: false,
				});
			});
		});
	}

	/**
	 * Stop a running project.
	 */
	stopProject(): boolean {
		if (this.runningProcess) {
			this.runningProcess.kill("SIGTERM");
			this.runningProcess = null;
			return true;
		}
		return false;
	}

	/**
	 * Check if a project is currently running.
	 */
	isRunning(): boolean {
		return this.runningProcess !== null;
	}

	/**
	 * Execute a headless GDScript. The code must extend SceneTree and call quit().
	 */
	async runScript(code: string, timeout: number = 15000): Promise<CliResult> {
		const tmpPath = join(this.projectRoot, ".godot_forge_tmp.gd");

		// Ensure the script extends SceneTree and quits
		let safeCode = code;
		if (!code.includes("extends SceneTree") && !code.includes("extends MainLoop")) {
			safeCode = `extends SceneTree\n\n${code}`;
		}
		if (!code.includes("quit()")) {
			// Add auto-quit after _init if not present
			safeCode += "\n\nfunc _process(_delta):\n\tquit()\n";
		}

		try {
			writeFileSync(tmpPath, safeCode, "utf-8");
			const result = await this.run(["--headless", "-s", tmpPath], timeout);
			return result;
		} finally {
			try {
				unlinkSync(tmpPath);
			} catch {
				// ignore cleanup errors
			}
		}
	}

	/**
	 * Validate the project by running a headless import.
	 */
	async validateProject(timeout: number = 60000): Promise<CliResult> {
		return this.run(["--headless", "--import"], timeout);
	}

	/**
	 * Get the Godot version.
	 */
	async getVersion(): Promise<string> {
		const result = await this.run(["--version"], 5000);
		return result.stdout.trim();
	}

	/**
	 * Export the project.
	 */
	async exportProject(
		preset: string,
		outputPath: string,
		debug: boolean = false,
		timeout: number = 120000,
	): Promise<CliResult> {
		const flag = debug ? "--export-debug" : "--export-release";
		return this.run(["--headless", flag, preset, outputPath], timeout);
	}
}
