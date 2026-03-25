/**
 * Core Execution Tools — Always exposed.
 *
 * run_project, stop_project, run_script
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { spawn, type ChildProcess } from "node:child_process";
import { writeFileSync, unlinkSync, existsSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import type { ToolContext } from "../registry.js";

let runningProcess: ChildProcess | null = null;

export function registerExecutionTools(server: McpServer, ctx: ToolContext): void {
	// ── godot_run_project ──────────────────────────────────────
	server.tool(
		"godot_run_project",
		"Launch the Godot project. Optionally specify a scene to run. Returns the process output.",
		{
			scene: z
				.string()
				.optional()
				.describe('Scene to run (res:// path). If omitted, runs the main scene.'),
			timeout: z
				.number()
				.optional()
				.default(30000)
				.describe("Max runtime in milliseconds before auto-kill (default 30s)"),
		},
		async ({ scene, timeout }) => {
			if (!ctx.godotBinary) {
				return {
					content: [
						{
							type: "text",
							text: "Godot binary not found. Set --godot flag, GODOT_BINARY env var, or ensure 'godot' is in PATH.",
						},
					],
					isError: true,
				};
			}

			// Kill existing if running
			if (runningProcess) {
				runningProcess.kill();
				runningProcess = null;
			}

			const args = ["--path", ctx.projectRoot];
			if (scene) args.push(scene);

			return new Promise((resolve) => {
				let stdout = "";
				let stderr = "";

				const proc = spawn(ctx.godotBinary!, args, {
					cwd: ctx.projectRoot,
					stdio: "pipe",
				});

				runningProcess = proc;

				proc.stdout?.on("data", (data: Buffer) => {
					stdout += data.toString();
				});

				proc.stderr?.on("data", (data: Buffer) => {
					stderr += data.toString();
				});

				const timer = setTimeout(() => {
					proc.kill();
				}, timeout);

				proc.on("close", (code) => {
					clearTimeout(timer);
					runningProcess = null;
					resolve({
						content: [
							{
								type: "text",
								text: JSON.stringify(
									{
										exitCode: code,
										stdout: stdout.slice(0, 5000),
										stderr: stderr.slice(0, 2000),
									},
									null,
									2,
								),
							},
						],
					});
				});

				proc.on("error", (err) => {
					clearTimeout(timer);
					runningProcess = null;
					resolve({
						content: [{ type: "text", text: `Failed to start Godot: ${err.message}` }],
						isError: true,
					});
				});
			});
		},
	);

	// ── godot_stop_project ─────────────────────────────────────
	server.tool(
		"godot_stop_project",
		"Stop a running Godot game instance.",
		{},
		async () => {
			if (runningProcess) {
				runningProcess.kill();
				runningProcess = null;
				return { content: [{ type: "text", text: "Stopped running Godot process." }] };
			}
			return { content: [{ type: "text", text: "No Godot process is currently running." }] };
		},
	);

	// ── godot_run_script ───────────────────────────────────────
	server.tool(
		"godot_run_script",
		"Execute a GDScript headlessly. The script must extend SceneTree. Captures stdout output. Useful for project automation and validation.",
		{
			code: z
				.string()
				.describe(
					'GDScript code to execute. Must extend SceneTree and call quit(). Example:\nextends SceneTree\nfunc _init():\n\tprint("Hello")\n\tquit()',
				),
			timeout: z
				.number()
				.optional()
				.default(15000)
				.describe("Max runtime in ms (default 15s)"),
		},
		async ({ code, timeout }) => {
			if (!ctx.godotBinary) {
				return {
					content: [{ type: "text", text: "Godot binary not found." }],
					isError: true,
				};
			}

			// Write temp script with unique name to prevent race conditions
			const uniqueId = randomBytes(8).toString("hex");
			const tmpPath = join(ctx.projectRoot, `.godot_forge_tmp_${uniqueId}.gd`);
			try {
				writeFileSync(tmpPath, code, "utf-8");

				return await new Promise((resolve) => {
					let stdout = "";
					let stderr = "";

					const proc = spawn(
						ctx.godotBinary!,
						["--headless", "--path", ctx.projectRoot, "-s", tmpPath],
						{
							cwd: ctx.projectRoot,
							stdio: "pipe",
						},
					);

					proc.stdout?.on("data", (data: Buffer) => {
						stdout += data.toString();
					});

					proc.stderr?.on("data", (data: Buffer) => {
						stderr += data.toString();
					});

					const timer = setTimeout(() => {
						proc.kill();
					}, timeout);

					proc.on("close", (code) => {
						clearTimeout(timer);
						try {
							unlinkSync(tmpPath);
						} catch {
							// ignore cleanup errors
						}
						resolve({
							content: [
								{
									type: "text",
									text: JSON.stringify(
										{
											exitCode: code,
											stdout: stdout.slice(0, 5000),
											stderr: stderr.slice(0, 2000),
										},
										null,
										2,
									),
								},
							],
						});
					});

					proc.on("error", (err) => {
						clearTimeout(timer);
						try {
							unlinkSync(tmpPath);
						} catch {
							// ignore
						}
						resolve({
							content: [{ type: "text", text: `Failed to run script: ${err.message}` }],
							isError: true,
						});
					});
				});
			} catch (e) {
				try {
					unlinkSync(tmpPath);
				} catch {
					// ignore
				}
				return {
					content: [{ type: "text", text: `Error: ${e}` }],
					isError: true,
				};
			}
		},
	);
}
