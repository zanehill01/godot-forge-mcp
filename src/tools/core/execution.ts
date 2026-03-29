/**
 * Core Execution Tool — Single tool with action-based routing.
 *
 * Actions: run_project, stop_project, run_script, get_output, launch_editor
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { spawn, type ChildProcess } from "node:child_process";
import { writeFileSync, unlinkSync, existsSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { resToAbsolute } from "../../utils/path.js";
import type { ToolContext } from "../registry.js";

let runningProcess: ChildProcess | null = null;
let capturedStdout = "";
let capturedStderr = "";

export function registerExecutionTools(server: McpServer, ctx: ToolContext): void {
	server.tool(
		"godot_execute",
		`Run Godot projects and scripts. Actions:

• run_project — Launch the game. Params: scene (optional res:// path), timeout (ms, default 30000)
• stop_project — Stop a running game instance. No params.
• run_script — Execute GDScript headlessly (must extend SceneTree). Params: code (required), timeout (ms, default 15000)
• get_output — Get accumulated stdout/stderr from the running game. No params.
• launch_editor — Open the Godot editor for this project. No params.
• get_version — Get Godot binary version. No params.`,
		{
			action: z.enum(["run_project", "stop_project", "run_script", "get_output", "launch_editor", "get_version"]),
			scene: z.string().optional().describe("Scene to run (res://)"),
			code: z.string().optional().describe("GDScript code to execute headlessly"),
			timeout: z.number().optional().default(30000),
		},
		async ({ action, scene, code, timeout }) => {
			switch (action) {
				case "run_project": {
					if (!ctx.godotBinary) {
						return { content: [{ type: "text" as const, text: "Godot binary not found. Set --godot flag or GODOT_BINARY env var." }], isError: true };
					}
					if (runningProcess) { runningProcess.kill(); runningProcess = null; }
					capturedStdout = "";
					capturedStderr = "";
					const args = ["-d", "--path", ctx.projectRoot];
					if (scene) {
						resToAbsolute(scene, ctx.projectRoot);
						args.push(scene);
					}
					return new Promise((resolve) => {
						const proc = spawn(ctx.godotBinary!, args, { cwd: ctx.projectRoot, stdio: "pipe" });
						runningProcess = proc;
						proc.stdout?.on("data", (d: Buffer) => { capturedStdout += d.toString(); });
						proc.stderr?.on("data", (d: Buffer) => { capturedStderr += d.toString(); });
						const timer = setTimeout(() => { proc.kill(); }, timeout);
						proc.on("close", (exitCode) => {
							clearTimeout(timer); runningProcess = null;
							resolve({ content: [{ type: "text" as const, text: JSON.stringify({ exitCode, stdout: capturedStdout.slice(0, 5000), stderr: capturedStderr.slice(0, 2000) }, null, 2) }] });
						});
						proc.on("error", (err) => {
							clearTimeout(timer); runningProcess = null;
							resolve({ content: [{ type: "text" as const, text: `Failed: ${err.message}` }], isError: true });
						});
					});
				}

				case "stop_project": {
					if (runningProcess) {
						runningProcess.kill();
						const finalOut = capturedStdout.slice(-3000);
						const finalErr = capturedStderr.slice(-1000);
						runningProcess = null;
						return { content: [{ type: "text" as const, text: JSON.stringify({ stopped: true, stdout: finalOut, stderr: finalErr }, null, 2) }] };
					}
					return { content: [{ type: "text" as const, text: "No process running." }] };
				}

				case "get_output": {
					if (!runningProcess) {
						return { content: [{ type: "text" as const, text: JSON.stringify({ running: false, stdout: capturedStdout.slice(-5000), stderr: capturedStderr.slice(-2000) }, null, 2) }] };
					}
					return { content: [{ type: "text" as const, text: JSON.stringify({ running: true, pid: runningProcess.pid, stdout: capturedStdout.slice(-5000), stderr: capturedStderr.slice(-2000) }, null, 2) }] };
				}

				case "run_script": {
					if (!ctx.godotBinary) return { content: [{ type: "text" as const, text: "Godot binary not found." }], isError: true };
					if (!code) return { content: [{ type: "text" as const, text: "code required for run_script" }], isError: true };
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
								resolve({ content: [{ type: "text" as const, text: JSON.stringify({ exitCode, stdout: stdout.slice(0, 5000), stderr: stderr.slice(0, 2000) }, null, 2) }] });
							});
							proc.on("error", (err) => {
								clearTimeout(timer);
								try { unlinkSync(tmpPath); } catch { /* ignore */ }
								resolve({ content: [{ type: "text" as const, text: `Failed: ${err.message}` }], isError: true });
							});
						});
					} catch (e) {
						try { if (existsSync(tmpPath)) unlinkSync(tmpPath); } catch { /* ignore */ }
						return { content: [{ type: "text" as const, text: `Error: ${e}` }], isError: true };
					}
				}

				case "launch_editor": {
					if (!ctx.godotBinary) return { content: [{ type: "text" as const, text: "Godot binary not found." }], isError: true };
					const proc = spawn(ctx.godotBinary, ["-e", "--path", ctx.projectRoot], {
						cwd: ctx.projectRoot,
						stdio: "ignore",
						detached: true,
					});
					proc.unref();
					return { content: [{ type: "text" as const, text: `Launched Godot editor (PID: ${proc.pid}) for ${ctx.projectRoot}` }] };
				}

				case "get_version": {
					if (!ctx.godotBinary) return { content: [{ type: "text" as const, text: "Godot binary not found." }], isError: true };
					return new Promise((resolve) => {
						let stdout = "";
						const proc = spawn(ctx.godotBinary!, ["--version"], { stdio: "pipe" });
						proc.stdout?.on("data", (d: Buffer) => { stdout += d.toString(); });
						const timer = setTimeout(() => proc.kill(), 5000);
						proc.on("close", () => {
							clearTimeout(timer);
							resolve({ content: [{ type: "text" as const, text: `Godot version: ${stdout.trim()}` }] });
						});
						proc.on("error", (err) => {
							clearTimeout(timer);
							resolve({ content: [{ type: "text" as const, text: `Failed: ${err.message}` }], isError: true });
						});
					});
				}
			}
		},
	);
}
