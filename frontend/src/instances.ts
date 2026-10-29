import { Stateful } from "dreamland/core";
import { createStore } from "dreamland/util";

export type Loader = "fabric" | "vanilla";

export interface Instance {
	id: string;
	name: string;
	version: string;
	loader: Loader;
	loaderVersion: string;
	group: string;
	icon: string;
	created: number;
	lastPlayed: number | null;
	playtime: number;
	fullscreen: boolean;
	/** OPFS path (relative to the storage root) used as the game directory. */
	gameDir: string;
}

export interface InstanceStore {
	list: Instance[];
	selected: string | null;
}

export const MC_VERSIONS = [
	"26.2", "26.1", "1.21.9", "1.21.8", "1.21.7", "1.21.6", "1.21.5",
	"1.21.4", "1.21.3", "1.21.2", "1.21.1", "1.21", "1.20.6", "1.20.5",
	"1.20.4", "1.20.3", "1.20.2", "1.20.1", "1.20", "1.19.4", "1.19.3",
	"1.19.2", "1.19.1", "1.19", "1.18.2", "1.18.1", "1.18", "1.17.1",
	"1.17", "1.16.5", "1.16.4", "1.16.3", "1.16.2", "1.16.1", "1.16",
	"1.15.2", "1.15.1", "1.15", "1.14.4", "1.14.3", "1.14.2", "1.14.1",
	"1.14", "1.13.2", "1.13.1", "1.13",
];

export const INSTANCE_ICONS = [
	"⛏️", "🌿", "🧱", "🔥", "💎", "🌍", "🐷", "🧪", "🏰", "⚔️", "🌲", "🌙",
];

export const DEFAULT_FABRIC_LOADER = "0.19.5";
export const DEFAULT_GAME_DIR = "minecraft";

export const instanceStore: Stateful<InstanceStore> = createStore(
	{ list: [], selected: null },
	{ ident: "prism-ikvm-instances-1", autosave: "auto", backing: "localstorage" }
);

const randomId = (): string => {
	if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
	const bytes = crypto.getRandomValues(new Uint8Array(16));
	return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
};

export function newInstance(partial: Partial<Instance> = {}): Instance {
	const id = partial.id ?? randomId();
	return {
		id,
		name: partial.name ?? "New Instance",
		version: partial.version ?? MC_VERSIONS[0],
		loader: partial.loader ?? "fabric",
		loaderVersion: partial.loaderVersion ?? DEFAULT_FABRIC_LOADER,
		group: partial.group ?? "Main",
		icon: partial.icon ?? INSTANCE_ICONS[0],
		created: partial.created ?? Date.now(),
		lastPlayed: partial.lastPlayed ?? null,
		playtime: partial.playtime ?? 0,
		fullscreen: partial.fullscreen ?? true,
		// The seeded default instance keeps the historical game directory so
		// existing worlds and mods keep working after this update.
		gameDir:
			partial.gameDir ??
			(id === "default" ? DEFAULT_GAME_DIR : `${DEFAULT_GAME_DIR}/${id}`),
	};
}

export function ensureDefaultInstance(): void {
	if (instanceStore.list.length > 0) {
		if (!instanceStore.list.some((i) => i.id === instanceStore.selected)) {
			instanceStore.selected = instanceStore.list[0].id;
		}
		return;
	}
	const first = newInstance({
		id: "default",
		name: "Minecraft",
		group: "Main",
	});
	instanceStore.list = [first];
	instanceStore.selected = first.id;
}

export function addInstance(instance: Instance): void {
	instanceStore.list = [...instanceStore.list, instance];
	instanceStore.selected = instance.id;
}

export function updateInstance(id: string, patch: Partial<Instance>): void {
	instanceStore.list = instanceStore.list.map((i) =>
		i.id === id ? { ...i, ...patch, id: i.id, gameDir: patch.gameDir ?? i.gameDir } : i
	);
}

export function removeInstance(id: string): void {
	const next = instanceStore.list.filter((i) => i.id !== id);
	instanceStore.list = next;
	if (instanceStore.selected === id) instanceStore.selected = next[0]?.id ?? null;
}

export function selectInstance(id: string | null): void {
	instanceStore.selected = id;
}

export function getInstance(id: string | null): Instance | undefined {
	return instanceStore.list.find((i) => i.id === id);
}

export function groupsOf(instances: Instance[]): string[] {
	return [...new Set(instances.map((i) => i.group || "Main"))].sort((a, b) =>
		a.localeCompare(b)
	);
}

/** The version id the IKVM runtime uses for this instance. */
export function versionId(instance: Instance): string {
	return instance.loader === "fabric"
		? `${instance.version}-fabric-${instance.loaderVersion}`
		: instance.version;
}

export function instanceSubdir(instance: Instance): string[] {
	return instance.gameDir.split("/").filter(Boolean);
}

export function loaderLabel(instance: Instance): string {
	return instance.loader === "fabric"
		? `Fabric ${instance.loaderVersion}`
		: "Vanilla";
}
