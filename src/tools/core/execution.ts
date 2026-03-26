/**
 * Core Execution Tool — Single tool with action-based routing.
 *
 * Actions: run_project, stop_project, run_script
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
	server.tool(
		"godot_execute",
		`Run Godot projects and scripts. Actions:
- run_project: Launch the game. Params: scene (optional res:// path), timeout (ms, default 30000)
- stop_project: Stop a running game instance. No params.
- run_script: Execute GDScript headlessly. Params: code (must extend SceneTree), timeout (ms, default 15000)`,
		{
			action: z.enum(["run_project", "stop_project", "run_script"]),
			scene: z.string().optional().describe("Scene to run (res://)"),
			code: z.string().optional().describe("GDScript code to execute headlessly"),
			timeout: z.number().optional().default(30000),
		},
		async ({ action, scene, code, timeout }) => {
			switch (action) {
				case "run_project": {
					if (!ctx.godotBinary) {
						return { content: [{ type: "text", text: "Godot binary not found. Set --godot flag or GODOT_BINARY env var." }], isError: true };
					}
					if (runningProcess) { runningProcess.kill(); runningProcess = null; }
					const args = ["--path", ctx.projectRoot];
					if (scene) args.push(scene);
					return new Promise((resolve) => {
						let stdout = "", stderr = "";
						const proc = spawn(ctx.godotBinary!, args, { cwd: ctx.projectRoot, stdio: "pipe" });
						runningProcess = proc;
						proc.stdout?.on("data", (d: Buffer) => { stdout += d.toString(); });
						proc.stderr?.on("data", (d: Buffer) => { stderr += d.toString(); });
						const timer = setTimeout(() => { proc.kill(); }, timeout);
						proc.on("close", (exitCode) => {
							clearTimeout(timer); runningProcess = null;
							resolve({ content: [{ type: "text", text: JSON.stringify({ exitCode, stdout: stdout.slice(0, 5000), stderr: stderr.slice(0, 2000) }, null, 2) }] });
						});
						proc.on("error", (err) => {
							clearTimeout(timer); runningProcess = null;
							resolve({ content: [{ type: "text", text: `Failed: ${err.message}` }], isError: true });
						});
					});
				}
				case "stop_project": {
					if (runningProcess) { runningProcess.kill(); runningProcess = null; return { content: [{ type: "text", text: "Stopped." }] }; }
					return { content: [{ type: "text", text: "No process running." }] };
				}
				case "run_script": {
					if (!ctx.godotBinary) return { content: [{ type: "text", text: "Godot binary not found." }], isError: true };
					if (!code) return { content: [{ type: "text", text: "code required for run_script" }], isError: true };
					const uid = randomBytes(8).toString("hex");
					const tmpPath = join(ctx.projectRoot, `.godot_forge_tmp_${uid}.gd`);
					try {
						writeFileSync(tmpPath, code, "utf-8");
						return await new Promise((resolve) => {
							let stdout = "", stderr = "";
							const proc = spawn(ctx.godotBinary!, ["--headless", "--path", ctx.projectRoot, "-s", tmpPath], { cwd: ctx.projectRoot, stdio: "pipe" });
							proc.stdout?.on("data", (d: Buffer) => { stdout += d.toString(); });
							proc.stderr?.on("data", (d: Buffer) => { stderr += d.toString(); });
							const timer = setTimeout(() => { proc.kill(); }, timeout);
							proc.on("close", (exitCode) => {
								clearTimeout(timer);
								try { unlinkSync(tmpPath); } catch { /* ignore */ }
								resolve({ content: [{ type: "text", text: JSON.stringify({ exitCode, stdout: stdout.slice(0, 5000), stderr: stderr.slice(0, 2000) }, null, 2) }] });
							});
							proc.on("error", (err) => {
								clearTimeout(timer);
								try { unlinkSync(tmpPath); } catch { /* ignore */ }
								resolve({ content: [{ type: "text", text: `Failed: ${err.message}` }], isError: true });
							});
						});
					} catch (e) {
						try { if (existsSync(tmpPath)) unlinkSync(tmpPath); } catch { /* ignore */ }
						return { content: [{ type: "text", text: `Error: ${e}` }], isError: true };
					}
				}
			}
		},
	);
}
