import { initDotnet, play, dotnetState } from "./dotnet";
import { loglisteners } from "./dotnet/log";
import {
	downloadFabricMinecraftVersionToOpfs,
	downloadMinecraftVersionToOpfs,
	isMinecraftVersionDownloaded,
	type MinecraftDownloadProgress,
} from "./minecraft";
import { gameChannel, readLaunch, type LauncherMessage } from "./launch";

const payload = readLaunch();
const channel = gameChannel();
const post = (message: LauncherMessage) => channel?.postMessage(message);
let exitPosted = false;
const postExit = (code: number) => {
	if (exitPosted) return;
	exitPosted = true;
	post({ type: "exit", code });
};

const root = document.querySelector("#app")!;
root.textContent = "";

const style = document.createElement("style");
style.textContent = `
	html, body { margin: 0; width: 100%; height: 100%; overflow: hidden; background: #101014; color: #f2f2f5;
		font-family: "Inter", system-ui, sans-serif; }
	#app { position: fixed; inset: 0; display: flex; flex-direction: column; }
	#game-canvas { width: 100%; height: 100%; display: block; background: #000; }
	.bar { position: absolute; inset: 0 0 auto 0; display: flex; align-items: center; gap: 1rem;
		padding: .6rem 1rem; background: linear-gradient(#000c, #0000); z-index: 5; pointer-events: none; }
	.bar > * { pointer-events: auto; }
	.bar h1 { font-size: 1rem; font-weight: 600; margin: 0; }
	.badge { font-size: .75rem; padding: .2rem .55rem; border-radius: 999px; background: #ffffff1a; }
	.spacer { flex: 1; }
	button { font: inherit; color: inherit; background: #ffffff14; border: 1px solid #ffffff24;
		border-radius: 999px; padding: .4rem .9rem; cursor: pointer; }
	button:hover { background: #ffffff24; }
	.overlay { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center;
		justify-content: center; gap: 1rem; background: #101014f2; z-index: 10; text-align: center; padding: 2rem; }
	.overlay.hidden { display: none; }
	.overlay h2 { margin: 0; font-size: 1.6rem; }
	.overlay p { margin: 0; color: #b9b9c6; max-width: 46rem; }
	progress { width: min(28rem, 80vw); height: .9rem; }
	.log { position: absolute; inset: auto 0 0 0; max-height: 38vh; overflow: auto; background: #050508e8;
		font: .78rem/1.5 ui-monospace, monospace; padding: .75rem 1rem; z-index: 8; display: none; }
	.log.open { display: block; }
	.log div { white-space: pre-wrap; overflow-wrap: anywhere; }
	.error { color: #ff8f8f; }
	.fatal { position: fixed; inset: 0; display: grid; place-items: center; padding: 2rem; z-index: 20;
		background: #101014; text-align: center; }
`;
document.head.append(style);

const canvas = document.createElement("canvas");
canvas.id = "game-canvas";

const bar = document.createElement("div");
bar.className = "bar";
const title = document.createElement("h1");
title.textContent = payload?.name ?? "Minecraft";
const badge = document.createElement("span");
badge.className = "badge";
badge.textContent = payload ? `${payload.version} · ${payload.loader}` : "no launch data";
const spacer = document.createElement("div");
spacer.className = "spacer";
const logButton = document.createElement("button");
logButton.textContent = "Logs";
const stopButton = document.createElement("button");
stopButton.textContent = "Force close";
bar.append(title, badge, spacer, logButton, stopButton);

const overlay = document.createElement("div");
overlay.className = "overlay";
const heading = document.createElement("h2");
heading.textContent = "Starting Minecraft";
const detail = document.createElement("p");
detail.textContent = "Preparing the IKVM runtime…";
const progress = document.createElement("progress");
progress.max = 1;
progress.style.display = "none";
const retry = document.createElement("button");
retry.textContent = "Retry";
retry.style.display = "none";
overlay.append(heading, detail, progress, retry);

const log = document.createElement("div");
log.className = "log";
logButton.addEventListener("click", () => log.classList.toggle("open"));
stopButton.addEventListener("click", () => {
	if (confirm("Force close Minecraft? Unsaved progress will be lost.")) window.close();
});

root.append(canvas, bar, overlay, log);

if (!payload) {
	heading.textContent = "No launch information";
	detail.textContent =
		"This tab was opened without a launch payload. Start the game from the launcher.";
	progress.style.display = "none";
} else {
	void start();
}

function appendLog(line: string, color: string) {
	const el = document.createElement("div");
	el.textContent = line;
	el.style.color = color;
	log.append(el);
	while (log.childElementCount > 2000) log.firstElementChild?.remove();
	log.scrollTop = log.scrollHeight;
	post({ type: "log", log: line, color });
}

loglisteners.push((entry) => appendLog(entry.log, entry.color));

addEventListener("beforeunload", () => postExit(0));

const phaseLabels: Record<MinecraftDownloadProgress["phase"], string> = {
	metadata: "Fetching metadata",
	libraries: "Downloading libraries",
	client: "Downloading client",
	mappings: "Downloading mappings",
	assets: "Downloading assets",
	fabric: "Downloading Fabric",
	complete: "Preparing game",
};

function setState(state: string, message: string) {
	heading.textContent = state;
	detail.textContent = message;
	post({ type: "state", state, detail: message });
}

function progressFraction(p: MinecraftDownloadProgress | null): number | undefined {
	if (!p || p.totalFiles === 0) return undefined;
	if (p.completedFiles === p.totalFiles) return 1;
	return p.totalBytes !== null && p.totalBytes > 0
		? Math.min(0.99, p.downloadedBytes / p.totalBytes)
		: p.completedFiles / p.totalFiles;
}

async function ensureGameDir(path: string) {
	const segments = path.split("/").filter(Boolean);
	let dir = await navigator.storage.getDirectory();
	for (const segment of segments) {
		dir = await dir.getDirectoryHandle(segment, { create: true });
	}
}

let started = false;

async function start() {
	if (!payload || started) return;
	started = true;
	retry.style.display = "none";
	progress.style.display = "none";
	overlay.classList.remove("hidden");

	const versionId =
		payload.loader === "fabric"
			? `${payload.version}-fabric-${payload.loaderVersion}`
			: payload.version;

	try {
		await ensureGameDir(payload.gameDir);
		const runtimeGameDir = `/libsdl/${payload.gameDir}`;

		setState("Initializing runtime", "Loading the .NET/IKVM WebAssembly runtime…");
		await initDotnet(canvas);

		setState("Verifying assets", "Checking the downloaded Minecraft files…");
		const downloaded = await isMinecraftVersionDownloaded(versionId, {
			verification: "size",
		});

		if (!downloaded) {
			progress.style.display = "block";
			const onProgress = (p: MinecraftDownloadProgress) => {
				const fraction = progressFraction(p);
				progress.value = fraction ?? 0;
				setState(
					phaseLabels[p.phase],
					`${p.completedFiles.toLocaleString()} / ${p.totalFiles.toLocaleString()} files`
				);
			};
			if (payload.loader === "fabric") {
				await downloadFabricMinecraftVersionToOpfs(payload.version, {
					loaderVersion: payload.loaderVersion,
					onProgress,
				});
			} else {
				await downloadMinecraftVersionToOpfs(payload.version, { onProgress });
			}
		}

		progress.style.display = "none";
		overlay.classList.add("hidden");
		setState("Running", "Minecraft is starting.");
		post({ type: "playing" });

		if (payload.fullscreen) {
			const goFullscreen = () => {
				document.documentElement.requestFullscreen?.().catch(() => {});
				removeEventListener("click", goFullscreen);
				removeEventListener("keydown", goFullscreen);
			};
			addEventListener("click", goFullscreen);
			addEventListener("keydown", goFullscreen);
		}

		await play(versionId, payload.auth, runtimeGameDir);

		setState("Game closed", "Minecraft exited. This tab will close.");
		postExit(0);
		setTimeout(() => window.close(), 1200);
	} catch (error) {
		console.error("Minecraft launch failed", error);
		const message = error instanceof Error ? error.message : String(error);
		setState("Launch failed", message);
		overlay.classList.remove("hidden");
		heading.classList.add("error");
		progress.style.display = "none";
		retry.style.display = "inline-block";
		postExit(1);
	} finally {
		started = false;
	}
}

retry.addEventListener("click", () => {
	heading.classList.remove("error");
	void start();
});

setInterval(() => {
	if (!document.querySelector(".bar")) return;
	badge.textContent = `${payload?.version ?? ""} · ${Math.round(dotnetState.fps)} fps`;
}, 1000);
