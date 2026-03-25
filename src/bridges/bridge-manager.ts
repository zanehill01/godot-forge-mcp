/**
 * Bridge Manager — Routes commands to the appropriate bridge based on availability.
 *
 * Priority: Socket Bridge (editor plugin) > CLI Bridge > File Engine
 */

import { CliBridge } from "./cli-bridge.js";

export interface BridgeStatus {
	fileEngine: boolean;
	cliBridge: boolean;
	socketBridge: boolean;
	godotVersion: string | null;
}

export class BridgeManager {
	private cliBridge: CliBridge | null = null;
	private pluginConnected = false;

	constructor(
		readonly projectRoot: string,
		godotBinary: string | null,
	) {
		if (godotBinary) {
			this.cliBridge = new CliBridge(godotBinary, projectRoot);
		}
	}

	/**
	 * Get the CLI bridge (if Godot binary is available).
	 */
	getCli(): CliBridge | null {
		return this.cliBridge;
	}

	/**
	 * Check if the editor plugin is connected.
	 */
	isPluginConnected(): boolean {
		return this.pluginConnected;
	}

	/**
	 * Set plugin connection state.
	 */
	setPluginConnected(connected: boolean): void {
		this.pluginConnected = connected;
	}

	/**
	 * Get the status of all bridges.
	 */
	async getStatus(): Promise<BridgeStatus> {
		let godotVersion: string | null = null;
		const cliAvailable = !!this.cliBridge;

		if (this.cliBridge) {
			try {
				godotVersion = await this.cliBridge.getVersion();
			} catch {
				// ignore
			}
		}

		return {
			fileEngine: true, // always available
			cliBridge: cliAvailable,
			socketBridge: this.pluginConnected,
			godotVersion,
		};
	}
}
