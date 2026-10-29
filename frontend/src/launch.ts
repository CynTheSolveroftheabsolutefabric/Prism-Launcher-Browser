import type { MinecraftAuthInfo } from "./dotnet";
import type { Loader } from "./instances";

/** Everything the game tab needs. Written to localStorage before the tab opens. */
export interface LaunchPayload {
	instanceId: string;
	name: string;
	version: string;
	loader: Loader;
	loaderVersion: string;
	gameDir: string;
	fullscreen: boolean;
	auth: MinecraftAuthInfo;
}

export type LauncherMessage =
	| { type: "state"; state: string; detail?: string }
	| { type: "log"; log: string; color: string }
	| { type: "playing" }
	| { type: "exit"; code?: number };

export const LAUNCH_KEY = "prism-ikvm-launch";
export const CHANNEL_NAME = "prism-ikvm";

export function writeLaunch(payload: LaunchPayload): void {
	localStorage.setItem(LAUNCH_KEY, JSON.stringify(payload));
}

export function readLaunch(): LaunchPayload | null {
	const raw = localStorage.getItem(LAUNCH_KEY);
	if (!raw) return null;
	try {
		return JSON.parse(raw) as LaunchPayload;
	} catch {
		return null;
	}
}

export function clearLaunch(): void {
	localStorage.removeItem(LAUNCH_KEY);
}

export function openGame(payload: LaunchPayload): Window | null {
	writeLaunch(payload);
	const url = new URL(location.href);
	url.search = "?game=1";
	return window.open(url.toString(), "_blank");
}

export function gameChannel(): BroadcastChannel | null {
	return typeof BroadcastChannel === "function"
		? new BroadcastChannel(CHANNEL_NAME)
		: null;
}

export function isGamePage(): boolean {
	return new URLSearchParams(location.search).has("game");
}
