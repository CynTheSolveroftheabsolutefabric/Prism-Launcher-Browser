import "./prism.css";
import { css, FC, Stateful } from "dreamland/core";
import { createStore } from "dreamland/util";
import type { MinecraftAuthInfo } from "./dotnet";
import {
	getProfile,
	minecraftAuth,
	refreshToken,
	startDeviceCodeAuth,
	type Token,
} from "./auth";
import { OpfsExplorer } from "./fs";
import {
	INSTANCE_ICONS,
	MC_VERSIONS,
	DEFAULT_FABRIC_LOADER,
	addInstance,
	ensureDefaultInstance,
	getInstance,
	groupsOf,
	instanceStore,
	instanceSubdir,
	loaderLabel,
	newInstance,
	removeInstance,
	selectInstance,
	updateInstance,
	versionId,
	type Instance,
} from "./instances";
import {
	gameChannel,
	openGame,
	type LaunchPayload,
	type LauncherMessage,
} from "./launch";
import { Icon } from "./ui/Button";
import { Dialog } from "./ui/Dialog";
import { TextField } from "./ui/TextField";
import { Switch } from "./ui/Switch";

import iconAdd from "@ktibow/iconset-material-symbols/add";
import iconPlay from "@ktibow/iconset-material-symbols/play-arrow";
import iconSettings from "@ktibow/iconset-material-symbols/settings";
import iconFolder from "@ktibow/iconset-material-symbols/folder";
import iconEdit from "@ktibow/iconset-material-symbols/edit";
import iconDelete from "@ktibow/iconset-material-symbols/delete";
import iconSearch from "@ktibow/iconset-material-symbols/search";
import iconPerson from "@ktibow/iconset-material-symbols/person";

type AuthState =
	| { type: "loading" }
	| { type: "none" }
	| { type: "ms"; name: string; uuid: string; token: string }
	| { type: "offline"; name: string }
	| { type: "authing"; url: string; qr: string }
	| { type: "error"; error: string };

type TabId = "overview" | "mods" | "resourcepacks" | "worlds" | "logs" | "settings";

const authStore: Stateful<{ token: Token | undefined }> = createStore(
	{ token: undefined },
	{ ident: "prism-ikvm-auth-1", autosave: "auto", backing: "localstorage" }
);

const offlineStore: Stateful<{ enabled: boolean; name: string }> = createStore(
	{ enabled: false, name: "Player" },
	{ ident: "prism-ikvm-offline-1", autosave: "auto", backing: "localstorage" }
);

const settingsStore: Stateful<{
	theme: "dark" | "light";
	defaultFullscreen: boolean;
}> = createStore(
	{ theme: "dark", defaultFullscreen: true },
	{ ident: "prism-ikvm-settings-1", autosave: "auto", backing: "localstorage" }
);

const OFFLINE_NAME_RE = /^[A-Za-z0-9_]{3,16}$/;

function formatPlaytime(seconds: number): string {
	if (seconds <= 0) return "Never";
	if (seconds < 60) return `${seconds} s`;
	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) return `${minutes} min`;
	const hours = Math.floor(minutes / 60);
	const rest = minutes % 60;
	return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}

function formatDate(timestamp: number | null): string {
	if (!timestamp) return "Never";
	return new Date(timestamp).toLocaleString(undefined, {
		dateStyle: "medium",
		timeStyle: "short",
	});
}

async function directoryAt(path: string[]): Promise<FileSystemDirectoryHandle | null> {
	let dir = await navigator.storage.getDirectory();
	for (const segment of path) {
		try {
			dir = await dir.getDirectoryHandle(segment);
		} catch {
			return null;
		}
	}
	return dir;
}

async function countEntries(path: string[]): Promise<number> {
	const dir = await directoryAt(path);
	if (!dir) return 0;
	let count = 0;
	for await (const _ of dir as any) count++;
	return count;
}

/* ------------------------------------------------------------------ */
/* Reusable Prism-style pieces                                        */
/* ------------------------------------------------------------------ */

function InstanceIcon(
	this: FC<{ icon: string; size?: "small" | "large"; color?: string }>
) {
	return (
		<div
			class={use(this.size).map((size) => `instance-icon ${size || "small"}`)}
			style={use(this.color).map((color) => `--icon-color:${color || "#4f9cf9"}`)}
		>
			{use(this.icon)}
		</div>
	);
}
InstanceIcon.style = css`
	:scope {
		display: grid;
		place-items: center;
		background: color-mix(in srgb, var(--icon-color) 28%, var(--surface3));
		border: 1px solid color-mix(in srgb, var(--icon-color) 55%, transparent);
		color: #fff;
		flex-shrink: 0;
		user-select: none;
	}
	:scope.small {
		width: 2.35rem;
		height: 2.35rem;
		border-radius: 0.65rem;
		font-size: 1.25rem;
	}
	:scope.large {
		width: 4.5rem;
		height: 4.5rem;
		border-radius: 1rem;
		font-size: 2.4rem;
	}
`;

function Stat(this: FC<{ label: string; value: string }>) {
	return (
		<div class="stat-card">
			<div class="stat-label">{use(this.label)}</div>
			<div class="stat-value">{use(this.value)}</div>
		</div>
	);
}
Stat.style = css`
	:scope {
		background: var(--surface2);
		border: 1px solid var(--border);
		border-radius: 0.75rem;
		padding: 0.9rem 1rem;
		min-width: 0;
	}
	.stat-label {
		font-size: 0.72rem;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--text-dim);
		margin-bottom: 0.35rem;
	}
	.stat-value {
		font-size: 0.98rem;
		font-weight: 600;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
`;

/* ------------------------------------------------------------------ */
/* New / edit instance dialogs                                        */
/* ------------------------------------------------------------------ */

function NewInstanceDialog(
	this: FC<
		{ open: boolean; oncreate: (instance: Instance) => void },
		{
			name: string;
			version: string;
			loader: "fabric" | "vanilla";
			loaderVersion: string;
			group: string;
			icon: string;
		}
	>
) {
	this.name = "New Instance";
	this.version = MC_VERSIONS[0];
	this.loader = "fabric";
	this.loaderVersion = DEFAULT_FABRIC_LOADER;
	this.group = "Main";
	this.icon = INSTANCE_ICONS[0];

	const reset = () => {
		this.name = "New Instance";
		this.version = MC_VERSIONS[0];
		this.loader = "fabric";
		this.loaderVersion = DEFAULT_FABRIC_LOADER;
		this.group = "Main";
		this.icon = INSTANCE_ICONS[0];
	};
	use(this.open).listen((open) => open && reset());

	const create = () => {
		const instance = newInstance({
			name: this.name.trim() || "New Instance",
			version: this.version.trim() || MC_VERSIONS[0],
			loader: this.loader,
			loaderVersion: this.loaderVersion.trim() || DEFAULT_FABRIC_LOADER,
			group: this.group.trim() || "Main",
			icon: this.icon,
			fullscreen: settingsStore.defaultFullscreen,
		});
		this.oncreate(instance);
		this.open = false;
	};

	return (
		<Dialog name="Add Instance" open={use(this.open)}>
			<div class="form">
				<label class="field">
					<span>Name</span>
					<TextField value={use(this.name)} placeholder="Instance name" />
				</label>
				<label class="field">
					<span>Group</span>
					<TextField value={use(this.group)} placeholder="Main" />
				</label>
				<label class="field">
					<span>Minecraft version</span>
					<select
						class="select"
						value={use(this.version)}
						on:change={(e: Event) =>
							(this.version = (e.target as HTMLSelectElement).value)
						}
					>
						{MC_VERSIONS.map((v) => (
							<option value={v}>{v}</option>
						))}
					</select>
				</label>
				<label class="field">
					<span>Mod loader</span>
					<select
						class="select"
						value={use(this.loader)}
						on:change={(e: Event) => {
							this.loader = (e.target as HTMLSelectElement).value as
								| "fabric"
								| "vanilla";
						}}
					>
						<option value="fabric">Fabric</option>
						<option value="vanilla">Vanilla</option>
					</select>
				</label>
				{use(this.loader).map((loader) =>
					loader === "fabric" ? (
						<label class="field">
							<span>Fabric loader version</span>
							<TextField
								value={use(this.loaderVersion)}
								placeholder={DEFAULT_FABRIC_LOADER}
							/>
						</label>
					) : null
				)}
				<div class="field">
					<span>Icon</span>
					<div class="icon-picker">
						{INSTANCE_ICONS.map((icon) => (
							<button
								type="button"
								class="icon-choice"
								class:selected={use(this.icon).map((selected) => selected === icon)}
								on:click={() => (this.icon = icon)}
							>
								{icon}
							</button>
						))}
					</div>
				</div>
				<div class="form-actions">
					<button class="btn" on:click={() => (this.open = false)}>
						Cancel
					</button>
					<button class="btn primary" on:click={create}>
						Create instance
					</button>
				</div>
			</div>
		</Dialog>
	);
}

function EditInstanceDialog(
	this: FC<
		{
			open: boolean;
			instance: Instance;
			onsave: (patch: Partial<Instance>) => void;
			ondelete: () => void;
		},
		{ name: string; group: string; icon: string; fullscreen: boolean }
	>
) {
	this.name = this.instance.name;
	this.group = this.instance.group;
	this.icon = this.instance.icon;
	this.fullscreen = this.instance.fullscreen;

	use(this.instance).listen((instance) => {
		this.name = instance.name;
		this.group = instance.group;
		this.icon = instance.icon;
		this.fullscreen = instance.fullscreen;
	});

	const save = () => {
		this.onsave({
			name: this.name.trim() || this.instance.name,
			group: this.group.trim() || "Main",
			icon: this.icon,
			fullscreen: this.fullscreen,
		});
		this.open = false;
	};

	return (
		<Dialog name="Edit Instance" open={use(this.open)}>
			<div class="form">
				<label class="field">
					<span>Name</span>
					<TextField value={use(this.name)} />
				</label>
				<label class="field">
					<span>Group</span>
					<TextField value={use(this.group)} />
				</label>
				<div class="field">
					<span>Icon</span>
					<div class="icon-picker">
						{INSTANCE_ICONS.map((icon) => (
							<button
								type="button"
								class="icon-choice"
								class:selected={use(this.icon).map((selected) => selected === icon)}
								on:click={() => (this.icon = icon)}
							>
								{icon}
							</button>
						))}
					</div>
				</div>
				<Switch
					title="Launch in fullscreen"
					on={use(this.fullscreen)}
					disabled={false}
				/>
				<div class="form-actions spread">
					<button class="btn danger" on:click={this.ondelete}>
						<Icon icon={iconDelete} /> Delete instance
					</button>
					<div class="row">
						<button class="btn" on:click={() => (this.open = false)}>
							Cancel
						</button>
						<button class="btn primary" on:click={save}>
							Save changes
						</button>
					</div>
				</div>
			</div>
		</Dialog>
	);
}

/* ------------------------------------------------------------------ */
/* Account dialog                                                     */
/* ------------------------------------------------------------------ */

function AccountDialog(
	this: FC<
		{
			open: boolean;
			auth: AuthState;
			onlogin: () => void;
			onlogout: () => void;
			onoffline: (name: string) => void;
			onopenlink: (url: string) => void;
		},
		{ offlineName: string; offlineError: string }
	>
) {
	this.offlineName = offlineStore.name;
	this.offlineError = "";

	const submitOffline = () => {
		if (!OFFLINE_NAME_RE.test(this.offlineName)) {
			this.offlineError = "Use 3-16 letters, numbers or underscores.";
			return;
		}
		this.offlineError = "";
		this.onoffline(this.offlineName);
	};

	return (
		<Dialog name="Accounts" open={use(this.open)}>
			<div class="account">
				{use(this.auth).map((auth) => {
					if (auth.type === "ms")
						return (
							<div class="account-current">
								<div class="avatar">{auth.name.slice(0, 1).toUpperCase()}</div>
								<div>
									<div class="account-name">{auth.name}</div>
									<div class="muted">Microsoft account</div>
								</div>
								<div class="spacer" />
								<button class="btn" on:click={this.onlogout}>
									Log out
								</button>
							</div>
						);
					if (auth.type === "offline")
						return (
							<div class="account-current">
								<div class="avatar offline">
									{auth.name.slice(0, 1).toUpperCase()}
								</div>
								<div>
									<div class="account-name">{auth.name}</div>
									<div class="muted">Offline account</div>
								</div>
								<div class="spacer" />
								<button class="btn" on:click={this.onlogout}>
									Log out
								</button>
							</div>
						);
					if (auth.type === "authing")
						return (
							<div class="ms-login">
								<p>Open this link to sign in with Microsoft:</p>
								<button
									class="btn primary"
									on:click={() => this.onopenlink(auth.url)}
								>
									Open sign-in page
								</button>
								<img class="qr" src={auth.qr} alt="Microsoft sign-in QR code" />
								<p class="muted">Waiting for you to finish signing in…</p>
							</div>
						);
					if (auth.type === "error")
						return (
							<div class="ms-login">
								<p class="error">{auth.error}</p>
								<button class="btn primary" on:click={this.onlogin}>
									Try again
								</button>
							</div>
						);
					if (auth.type === "loading")
						return <p class="muted">Loading account…</p>;
					return (
						<div class="ms-login">
							<p>
								Sign in with a Microsoft account that owns Minecraft: Java
								Edition, or use an offline username for singleplayer.
							</p>
							<button class="btn primary" on:click={this.onlogin}>
								<Icon icon={iconPerson} /> Sign in with Microsoft
							</button>
						</div>
					);
				})}

				<div class="offline-form">
					<h3>Offline account</h3>
					<p class="muted">
						No sign-in. Works in singleplayer and on servers with
						<code>online-mode=false</code>.
					</p>
					<div class="row">
						<TextField
							value={use(this.offlineName)}
							placeholder="Username"
						/>
						<button class="btn" on:click={submitOffline}>
							Use offline account
						</button>
					</div>
					{use(this.offlineError).map((error) =>
						error ? <p class="error">{error}</p> : null
					)}
				</div>
			</div>
		</Dialog>
	);
}

/* ------------------------------------------------------------------ */
/* Global settings dialog                                             */
/* ------------------------------------------------------------------ */

function SettingsDialog(
	this: FC<{ open: boolean }, { message: string }>
) {
	this.message = "";
	const clearData = async () => {
		if (
			!confirm(
				"Delete all downloaded game files, worlds and instances stored in this browser? This cannot be undone."
			)
		)
			return;
		try {
			const root = await navigator.storage.getDirectory();
			for await (const [name] of root as any) {
				await root.removeEntry(name, { recursive: true });
			}
			this.message = "Browser storage cleared. Reloading…";
			setTimeout(() => location.reload(), 800);
		} catch (error) {
			this.message = `Could not clear storage: ${String(error)}`;
		}
	};

	return (
		<Dialog name="Settings" open={use(this.open)}>
			<div class="form">
				<label class="field">
					<span>Theme</span>
					<select
						class="select"
						value={use(settingsStore.theme)}
						on:change={(e: Event) => {
							settingsStore.theme = (e.target as HTMLSelectElement).value as
								| "dark"
								| "light";
						}}
					>
						<option value="dark">Dark</option>
						<option value="light">Light</option>
					</select>
				</label>
				<Switch
					title="Launch new instances in fullscreen"
					on={use(settingsStore.defaultFullscreen)}
					disabled={false}
				/>
				<div class="field">
					<span>Storage</span>
					<p class="muted">
						Everything (game files, worlds, mods, instances) lives in this
						browser's Origin Private File System. Clearing site data deletes it.
					</p>
					<button class="btn danger" on:click={clearData}>
						Clear browser storage
					</button>
					{use(this.message).map((message) =>
						message ? <p class="muted">{message}</p> : null
					)}
				</div>
				<div class="form-actions">
					<button class="btn primary" on:click={() => (this.open = false)}>
						Done
					</button>
				</div>
			</div>
		</Dialog>
	);
}

/* ------------------------------------------------------------------ */
/* Instance page                                                      */
/* ------------------------------------------------------------------ */

function FolderCard(
	this: FC<
		{
			instance: Instance;
			title: string;
			description: string;
			sub: string;
			onopen: (path: string[]) => void;
		},
		{ count: number | null }
	>
) {
	this.count = null;
	const refresh = async () => {
		this.count = await countEntries([...instanceSubdir(this.instance), this.sub]);
	};
	this.cx.mount = () => {
		use(this.instance).listen(refresh);
		refresh();
	};
	const open = () => this.onopen([...instanceSubdir(this.instance), this.sub]);

	return (
		<div class="folder-card">
			<div class="folder-card-head">
				<Icon icon={iconFolder} />
				<div>
					<div class="folder-title">{use(this.title)}</div>
					<div class="muted">{use(this.description)}</div>
				</div>
			</div>
			<div class="folder-card-foot">
				<span class="muted">
					{use(this.count).map((count) =>
						count === null ? "…" : `${count} item${count === 1 ? "" : "s"}`
					)}
				</span>
				<button class="btn small" on:click={open}>
					Open folder
				</button>
			</div>
		</div>
	);
}

function InstancePage(
	this: FC<
		{
			instance: Instance;
			canLaunch: boolean;
			playing: boolean;
			logs: { log: string; color: string }[];
			onlaunch: () => void;
			onedit: () => void;
			onopenfolder: (path: string[]) => void;
		},
		{ tab: TabId }
	>
) {
	this.tab = "overview";
	use(this.instance).listen(() => (this.tab = "overview"));

	const tabs: { id: TabId; label: string }[] = [
		{ id: "overview", label: "Overview" },
		{ id: "mods", label: "Mods" },
		{ id: "resourcepacks", label: "Resource Packs" },
		{ id: "worlds", label: "Worlds" },
		{ id: "logs", label: "Logs" },
		{ id: "settings", label: "Settings" },
	];

	return (
		<div class="instance-page">
			<div class="instance-hero">
				<InstanceIcon icon={use(this.instance).map((i) => i.icon)} size="large" />
				<div class="instance-hero-text">
					<div class="instance-title-row">
						<h1>{use(this.instance.name)}</h1>
						<span class="badge">{use(this.instance).map((i) => i.version)}</span>
						<span class="badge loader">{use(this.instance).map(loaderLabel)}</span>
					</div>
					<div class="muted">
						{use(this.instance).map(
							(i) =>
								`${i.loader === "fabric" ? "Fabric modded" : "Vanilla"} · last played ${formatDate(i.lastPlayed)}`
						)}
					</div>
				</div>
				<div class="spacer" />
				<button class="btn" on:click={this.onedit}>
					<Icon icon={iconEdit} /> Edit
				</button>
				<button
					class="btn primary launch"
					disabled={use(this.canLaunch, this.playing).map(
						([can, playing]) => !can || playing
					)}
					on:click={this.onlaunch}
				>
					<Icon icon={iconPlay} />
					{use(this.playing).map((playing) =>
						playing ? "Running…" : "Launch"
					)}
				</button>
			</div>

			<div class="tabs">
				{tabs.map((tab) => (
					<button
						class="tab"
						class:active={use(this.tab).map((active) => active === tab.id)}
						on:click={() => (this.tab = tab.id)}
					>
						{tab.label}
					</button>
				))}
			</div>

			<div class="tab-body">
				{use(this.tab).map((tab) => {
					if (tab === "overview")
						return (
							<div class="overview">
								<div class="stat-grid">
									<Stat
										label="Minecraft"
										value={use(this.instance).map((i) => i.version)}
									/>
									<Stat
										label="Loader"
										value={use(this.instance).map(loaderLabel)}
									/>
									<Stat
										label="Playtime"
										value={use(this.instance).map((i) =>
											formatPlaytime(i.playtime)
										)}
									/>
									<Stat
										label="Game directory"
										value={use(this.instance).map((i) => i.gameDir)}
									/>
								</div>
								<div class="section-title">Game files</div>
								<div class="folder-grid">
									<FolderCard
										instance={use(this.instance)}
										title="Mods"
										description="Fabric mods (.jar)"
										sub="mods"
										onopen={this.onopenfolder}
									/>
									<FolderCard
										instance={use(this.instance)}
										title="Resource packs"
										description="Textures and sounds"
										sub="resourcepacks"
										onopen={this.onopenfolder}
									/>
									<FolderCard
										instance={use(this.instance)}
										title="Worlds"
										description="Singleplayer saves"
										sub="saves"
										onopen={this.onopenfolder}
									/>
								</div>
								<div class="section-title">Instance folder</div>
								<div class="row">
									<button
										class="btn"
										on:click={() =>
											this.onopenfolder(instanceSubdir(this.instance))
										}
									>
										<Icon icon={iconFolder} /> Open .minecraft
									</button>
									<span class="muted">
										{use(this.instance).map(
											(i) => `Worlds, options and screenshots are kept in ${i.gameDir}.`
										)}
									</span>
								</div>
							</div>
						);
					if (tab === "mods" || tab === "resourcepacks" || tab === "worlds") {
						const sub = tab === "mods" ? "mods" : tab === "worlds" ? "saves" : "resourcepacks";
						const title =
							tab === "mods"
								? "Mods"
								: tab === "worlds"
									? "Worlds"
									: "Resource Packs";
						const description =
							tab === "mods"
								? "Drop Fabric mod jars into this folder. They load the next time the instance launches."
								: tab === "worlds"
									? "Singleplayer worlds are stored here. Download an archive before clearing site data."
									: "Resource packs add textures, models and sounds to the game.";
						return (
							<div class="folder-panel">
								<div class="folder-panel-head">
									<div>
										<h2>{title}</h2>
										<p class="muted">{description}</p>
									</div>
									<button
										class="btn primary"
										on:click={() =>
											this.onopenfolder([...instanceSubdir(this.instance), sub])
										}
									>
										<Icon icon={iconFolder} /> Open folder
									</button>
								</div>
								<FolderCard
									instance={use(this.instance)}
									title={title}
									description={description}
									sub={sub}
									onopen={this.onopenfolder}
								/>
							</div>
						);
					}
					if (tab === "logs")
						return (
							<div class="logs-panel">
								<div class="logs-head">
									<h2>Logs</h2>
									<span class="muted">
										{use(this.logs).map((logs) =>
											logs.length === 0
												? "Launch the instance to see its log."
												: `${logs.length} lines from the last launch`
										)}
									</span>
								</div>
								<div class="log-list">
									{use(this.logs).map((logs) =>
										logs.length === 0 ? (
											<p class="muted empty-log">
												No launch output yet. Press Launch to start this
												instance in a new tab.
											</p>
										) : (
											logs.map((entry) => (
												<div class="log-line" style={`color:${entry.color}`}>
													{entry.log}
												</div>
											))
										)
									)}
								</div>
							</div>
						);
					return (
						<div class="settings-panel">
							<h2>Instance settings</h2>
							<Switch
								title="Launch in fullscreen"
								on={use(this.instance).map((i) => i.fullscreen)}
								disabled={false}
								on:change={() => {
									const current = getInstance(this.instance.id);
									if (current)
										updateInstance(current.id, {
											fullscreen: !current.fullscreen,
										});
								}}
							/>
							<div class="info-row">
								<span>Version id</span>
								<code>{use(this.instance).map(versionId)}</code>
							</div>
							<div class="info-row">
								<span>Game directory</span>
								<code>{use(this.instance).map((i) => i.gameDir)}</code>
							</div>
							<div class="info-row">
								<span>Created</span>
								<span>{use(this.instance).map((i) => formatDate(i.created))}</span>
							</div>
							<button class="btn" on:click={this.onedit}>
								<Icon icon={iconEdit} /> Rename, change icon or delete
							</button>
						</div>
					);
				})}
			</div>
		</div>
	);
}

/* ------------------------------------------------------------------ */
/* Root app                                                           */
/* ------------------------------------------------------------------ */

function App(
	this: FC<
		{},
		{
			auth: AuthState;
			search: string;
			newOpen: boolean;
			editOpen: boolean;
			accountOpen: boolean;
			settingsOpen: boolean;
			explorerOpen: boolean;
			explorerStart: string[];
			toast: string;
			toastError: boolean;
			launchStatus: string;
			playing: string | null;
			logs: { log: string; color: string }[];
			launchStartedAt: number | null;
			launchingInstanceId: string | null;
		}
	>
) {
	this.auth = { type: "loading" } as AuthState;
	this.search = "";
	this.newOpen = false;
	this.editOpen = false;
	this.accountOpen = false;
	this.settingsOpen = false;
	this.explorerOpen = false;
	this.explorerStart = [];
	this.toast = "";
	this.toastError = false;
	this.playing = null;
	this.logs = [];
	this.launchStartedAt = null;
	this.launchingInstanceId = null;

	let toastTimer: ReturnType<typeof setTimeout> | undefined;
	const showToast = (message: string, error = false) => {
		this.toast = message;
		this.toastError = error;
		clearTimeout(toastTimer);
		toastTimer = setTimeout(() => (this.toast = ""), 3600);
	};

	const populateMicrosoft = async (token: Token) => {
		try {
			const mcToken = await minecraftAuth(token.access);
			const profile = await getProfile(mcToken);
			offlineStore.enabled = false;
			this.auth = {
				type: "ms",
				name: profile.name,
				uuid: profile.id,
				token: mcToken,
			};
		} catch (error) {
			this.auth = { type: "error", error: String(error) };
		}
	};

	this.cx.mount = async () => {
		ensureDefaultInstance();

		const channel = gameChannel();
		channel?.addEventListener("message", (event: MessageEvent<LauncherMessage>) => {
			const message = event.data;
			if (message.type === "log") {
				this.logs = [...this.logs.slice(-1999), { log: message.log, color: message.color }];
			} else if (message.type === "state") {
				this.launchStatus = message.detail
					? `${message.state}: ${message.detail}`
					: message.state;
			} else if (message.type === "playing") {
				this.playing = this.launchingInstanceId;
				this.launchStatus = "Running";
				this.launchStartedAt = Date.now();
			} else if (message.type === "exit") {
				const id = this.launchingInstanceId;
				this.playing = null;
				this.launchingInstanceId = null;
				if (id && this.launchStartedAt) {
					const seconds = Math.max(
						0,
						Math.round((Date.now() - this.launchStartedAt) / 1000)
					);
					const instance = getInstance(id);
					if (instance)
						updateInstance(id, {
							playtime: instance.playtime + seconds,
							lastPlayed: Date.now(),
						});
				}
				this.launchStartedAt = null;
				this.launchStatus = "";
				showToast(message.code === 0 ? "Minecraft closed." : "Minecraft stopped with an error.", message.code !== 0);
			}
		});
		addEventListener("beforeunload", () => channel?.close());


		if (offlineStore.enabled) {
			this.auth = { type: "offline", name: offlineStore.name };
		} else {
			let token = authStore.token;
			if (!token) this.auth = { type: "none" };
			else {
				if (token.expires < Date.now()) {
					try {
						token = await refreshToken(token.refresh);
						authStore.token = token;
					} catch (error) {
						this.auth = { type: "error", error: String(error) };
					}
				}
				if (this.auth.type === "loading" && token)
					await populateMicrosoft(token);
			}
		}

		applyTheme();
		use(settingsStore.theme).listen(applyTheme);

	};

	const applyTheme = () => {
		document.documentElement.dataset.theme = settingsStore.theme;
	};

	const login = async () => {
		this.auth = { type: "loading" } as AuthState;
		try {
			const flow = await startDeviceCodeAuth();
			this.auth = { type: "authing", url: flow.link_url, qr: flow.qr_svg_uri };
			const token = await flow.token;
			authStore.token = token;
			offlineStore.enabled = false;
			await populateMicrosoft(token);
		} catch (error) {
			this.auth = { type: "error", error: String(error) };
		}
	};

	const logout = () => {
		authStore.token = undefined;
		offlineStore.enabled = false;
		this.auth = { type: "none" };
	};

	const useOffline = (name: string) => {
		offlineStore.enabled = true;
		offlineStore.name = name;
		authStore.token = undefined;
		this.auth = { type: "offline", name };
		this.accountOpen = false;
		showToast(`Playing offline as ${name}.`);
	};

	const authInfo = (): MinecraftAuthInfo | null => {
		if (this.auth.type === "ms")
			return {
				playerName: this.auth.name,
				uuid: this.auth.uuid,
				accessToken: this.auth.token,
				userType: "msa",
			};
		if (this.auth.type === "offline")
			return {
				playerName: this.auth.name,
				uuid: "",
				accessToken: "0",
				userType: "legacy",
			};
		return null;
	};

	const canLaunch = use(this.auth).map((auth) => auth.type === "ms" || auth.type === "offline");
	const accountLabel = use(this.auth).map((auth) => {
		if (auth.type === "ms") return auth.name;
		if (auth.type === "offline") return `${auth.name} (offline)`;
		if (auth.type === "authing") return "Signing in…";
		if (auth.type === "loading") return "Loading…";
		return "Add account";
	});

	const launch = () => {
		if (this.playing || this.launchingInstanceId) {
			showToast("A game is already running in another tab.", true);
			return;
		}
		const instance = getInstance(instanceStore.selected);
		if (!instance) return;
		const auth = authInfo();
		if (!auth) {
			this.accountOpen = true;
			showToast("Sign in or pick an offline account first.", true);
			return;
		}
		const payload: LaunchPayload = {
			instanceId: instance.id,
			name: instance.name,
			version: instance.version,
			loader: instance.loader,
			loaderVersion: instance.loaderVersion,
			gameDir: instance.gameDir,
			fullscreen: instance.fullscreen,
			auth,
		};
		this.logs = [];
		updateInstance(instance.id, { lastPlayed: Date.now() });
		this.playing = instance.id;
		this.launchingInstanceId = instance.id;
		this.launchStartedAt = Date.now();
		const gameWindow = openGame(payload);
		if (!gameWindow) {
			this.playing = null;
			this.launchingInstanceId = null;
			this.launchStartedAt = null;
			showToast("The game tab was blocked. Allow pop-ups for this site.", true);
			return;
		}
		showToast(`Launching ${instance.name}…`);
	};

	const selected = use(instanceStore.list, instanceStore.selected).map(
		([list, selectedId]) => list.find((i) => i.id === selectedId) ?? null
	);

	const groups = use(instanceStore.list, this.search).map(([list, search]) => {
		const query = search.trim().toLowerCase();
		const filtered = list.filter(
			(instance) =>
				!query ||
				instance.name.toLowerCase().includes(query) ||
				instance.version.toLowerCase().includes(query) ||
				instance.group.toLowerCase().includes(query)
		);
		return groupsOf(filtered).map((group) => ({
			group,
			instances: filtered.filter((i) => (i.group || "Main") === group),
		}));
	});

	const openFolder = (path: string[]) => {
		this.explorerStart = path;
		this.explorerOpen = true;
	};

	return (
		<div class="app">
			<header class="topbar">
				<div class="brand">
					<span class="brand-mark">◆</span>
					<span class="brand-name">Prism <b>Ikvm</b></span>
				</div>
				<div class="spacer" />
				<button class="account-button" on:click={() => (this.accountOpen = true)}>
					<Icon icon={iconPerson} />
					<span>{accountLabel}</span>
				</button>
				<button
					class="icon-button"
					title="Settings"
					on:click={() => (this.settingsOpen = true)}
				>
					<Icon icon={iconSettings} />
				</button>
			</header>

			<div class="body">
				<aside class="sidebar">
					<div class="sidebar-search">
						<Icon icon={iconSearch} />
						<TextField value={use(this.search)} placeholder="Search instances…" />
						<button
							class="icon-button add"
							title="Add instance"
							on:click={() => (this.newOpen = true)}
						>
							<Icon icon={iconAdd} />
						</button>
					</div>
					<div class="instance-list">
						{groups.map((groups) =>
							groups.length === 0 ? (
								<p class="muted empty-list">No instances match your search.</p>
							) : (
								groups.map((group) => (
									<div class="group">
										<div class="group-title">
											{group.group}
											<span>{group.instances.length}</span>
										</div>
										{group.instances.map((instance) => (
											<button
												class="instance-row"
												class:active={use(instanceStore.selected).map(
													(id) => id === instance.id
												)}
												on:click={() => selectInstance(instance.id)}
												on:dblclick={launch}
											>
												<InstanceIcon icon={instance.icon} />
												<span class="instance-row-text">
													<span class="instance-row-name">{instance.name}</span>
													<span class="instance-row-meta">
														{instance.version} · {loaderLabel(instance)}
													</span>
												</span>
												{use(this.playing).map((playing) =>
													playing === instance.id ? (
														<span class="running-dot" title="Running" />
													) : null
												)}
											</button>
										))}
									</div>
								))
							)
						)}
					</div>
					<div class="sidebar-footer">
						<button class="btn wide" on:click={() => (this.newOpen = true)}>
							<Icon icon={iconAdd} /> New instance
						</button>
					</div>
				</aside>

				<main class="content">
					{selected.map((instance) =>
						instance ? (
							<InstancePage
								instance={instance}
								canLaunch={canLaunch}
								playing={use(this.playing).map((id) => id === instance.id)}
								logs={use(this.logs)}
								onlaunch={launch}
								onedit={() => (this.editOpen = true)}
								onopenfolder={openFolder}
							/>
						) : (
							<div class="welcome">
								<div class="welcome-mark">◆</div>
								<h1>Welcome to Prism Ikvm</h1>
								<p>
									Prism-style instance management on top of the ikvmcraft
									runtime. Create an instance, add Fabric mods, and launch
									Minecraft in a browser tab.
								</p>
								<div class="row">
									<button
										class="btn primary"
										on:click={() => (this.newOpen = true)}
									>
										<Icon icon={iconAdd} /> Add instance
									</button>
									<button
										class="btn"
										on:click={() => (this.accountOpen = true)}
									>
										<Icon icon={iconPerson} /> Add account
									</button>
								</div>
							</div>
						)
					)}
				</main>
			</div>

			<footer class="statusbar">
				<span>
					{use(instanceStore.list).map((list) => `${list.length} instance${list.length === 1 ? "" : "s"}`)}
				</span>
				<span class="muted">{use(this.launchStatus)}</span>
				<span class="spacer" />
				<span class="muted">
					Not an official Minecraft product. Not affiliated with Mojang or
					Microsoft.
				</span>
			</footer>

			<NewInstanceDialog
				open={use(this.newOpen)}
				oncreate={(instance) => {
					addInstance(instance);
					showToast(`Created ${instance.name}.`);
				}}
			/>
			{selected.map((instance) =>
				instance ? (
					<EditInstanceDialog
						open={use(this.editOpen)}
						instance={instance}
						onsave={(patch) => {
							updateInstance(instance.id, patch);
							showToast("Instance updated.");
						}}
						ondelete={() => {
							if (!confirm(`Delete instance "${instance.name}"? Files stay in browser storage.`))
								return;
							removeInstance(instance.id);
							this.editOpen = false;
							showToast("Instance deleted.");
						}}
					/>
				) : null
			)}
			<AccountDialog
				open={use(this.accountOpen)}
				auth={use(this.auth)}
				onlogin={login}
				onlogout={logout}
				onoffline={useOffline}
				onopenlink={(url) => window.open(url, "_blank", "noopener")}
			/>
			<SettingsDialog open={use(this.settingsOpen)} />
			<OpfsExplorer open={use(this.explorerOpen)} start={use(this.explorerStart)} />

			{use(this.toast).map((toast) =>
				toast ? (
					<div class="toast" class:error={use(this.toastError)}>
						{toast}
					</div>
				) : null
			)}
		</div>
	);
}

App.style = css`
	:scope {
		position: fixed;
		inset: 0;
		display: flex;
		flex-direction: column;
		background: var(--bg);
		color: var(--text);
	}

	.topbar {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		height: 3.35rem;
		padding: 0 0.9rem;
		background: var(--surface1);
		border-bottom: 1px solid var(--border);
		flex-shrink: 0;
	}
	.brand {
		display: flex;
		align-items: center;
		gap: 0.55rem;
		font-size: 1.05rem;
		font-weight: 500;
		letter-spacing: 0.01em;
	}
	.brand-mark {
		display: grid;
		place-items: center;
		width: 1.9rem;
		height: 1.9rem;
		border-radius: 0.55rem;
		background: linear-gradient(135deg, var(--accent), var(--accent-2));
		color: #fff;
		font-size: 0.9rem;
	}
	.brand-name b {
		color: var(--accent);
		font-weight: 700;
	}
	.spacer {
		flex: 1;
	}
	.account-button {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		background: var(--surface3);
		border: 1px solid var(--border);
		color: var(--text);
		border-radius: 0.6rem;
		padding: 0.45rem 0.75rem;
		cursor: pointer;
		font: inherit;
		font-size: 0.88rem;
		max-width: 18rem;
	}
	.account-button span {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.account-button:hover,
	.icon-button:hover {
		background: var(--surface4);
	}
	.icon-button {
		display: grid;
		place-items: center;
		width: 2.3rem;
		height: 2.3rem;
		border-radius: 0.6rem;
		border: 1px solid var(--border);
		background: var(--surface3);
		color: var(--text);
		cursor: pointer;
		font-size: 1.15rem;
	}
	.icon-button.add {
		width: 2.1rem;
		height: 2.1rem;
	}

	.body {
		display: flex;
		min-height: 0;
		flex: 1;
	}
	.sidebar {
		width: 19rem;
		flex-shrink: 0;
		display: flex;
		flex-direction: column;
		background: var(--surface1);
		border-right: 1px solid var(--border);
		min-height: 0;
	}
	.sidebar-search {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		padding: 0.7rem;
		border-bottom: 1px solid var(--border);
	}
	.sidebar-search > :global(svg) {
		color: var(--text-dim);
	}
	.sidebar-search :global(.component-textfield) {
		flex: 1;
		min-width: 0;
	}
	.instance-list {
		flex: 1;
		overflow-y: auto;
		padding: 0.5rem;
	}
	.group {
		margin-bottom: 0.75rem;
	}
	.group-title {
		display: flex;
		justify-content: space-between;
		font-size: 0.7rem;
		text-transform: uppercase;
		letter-spacing: 0.09em;
		color: var(--text-dim);
		padding: 0.35rem 0.5rem;
	}
	.group-title span {
		opacity: 0.7;
	}
	.instance-row {
		display: flex;
		align-items: center;
		gap: 0.65rem;
		width: 100%;
		padding: 0.45rem 0.5rem;
		border: 1px solid transparent;
		border-radius: 0.65rem;
		background: transparent;
		color: var(--text);
		cursor: pointer;
		font: inherit;
		text-align: left;
	}
	.instance-row:hover {
		background: var(--surface3);
	}
	.instance-row.active {
		background: color-mix(in srgb, var(--accent) 18%, var(--surface3));
		border-color: color-mix(in srgb, var(--accent) 55%, transparent);
	}
	.instance-row-text {
		display: flex;
		flex-direction: column;
		min-width: 0;
		flex: 1;
	}
	.instance-row-name {
		font-size: 0.9rem;
		font-weight: 600;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.instance-row-meta {
		font-size: 0.72rem;
		color: var(--text-dim);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.running-dot {
		width: 0.55rem;
		height: 0.55rem;
		border-radius: 999px;
		background: var(--success);
		box-shadow: 0 0 0 0.2rem color-mix(in srgb, var(--success) 25%, transparent);
	}
	.sidebar-footer {
		padding: 0.7rem;
		border-top: 1px solid var(--border);
	}
	.content {
		flex: 1;
		min-width: 0;
		overflow-y: auto;
	}
	.statusbar {
		display: flex;
		align-items: center;
		gap: 1rem;
		height: 1.9rem;
		padding: 0 0.9rem;
		font-size: 0.75rem;
		color: var(--text-dim);
		background: var(--surface1);
		border-top: 1px solid var(--border);
		flex-shrink: 0;
	}

	.welcome {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 1rem;
		text-align: center;
		height: 100%;
		padding: 2rem;
	}
	.welcome-mark {
		font-size: 4rem;
		line-height: 1;
		background: linear-gradient(135deg, var(--accent), var(--accent-2));
		-webkit-background-clip: text;
		background-clip: text;
		color: transparent;
	}
	.welcome h1 {
		margin: 0;
		font-size: 1.8rem;
	}
	.welcome p {
		margin: 0;
		max-width: 34rem;
		color: var(--text-dim);
		line-height: 1.55;
	}

	.instance-page {
		padding: 1.4rem 1.6rem 2rem;
		max-width: 78rem;
		margin: 0 auto;
	}
	.instance-hero {
		display: flex;
		align-items: center;
		gap: 1rem;
		padding-bottom: 1.1rem;
	}
	.instance-hero-text {
		min-width: 0;
	}
	.instance-title-row {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		flex-wrap: wrap;
	}
	.instance-title-row h1 {
		margin: 0;
		font-size: 1.5rem;
	}
	.badge {
		font-size: 0.72rem;
		padding: 0.15rem 0.5rem;
		border-radius: 999px;
		background: var(--surface3);
		border: 1px solid var(--border);
		color: var(--text-dim);
	}
	.badge.loader {
		color: var(--accent);
		border-color: color-mix(in srgb, var(--accent) 45%, transparent);
	}
	.btn.launch {
		font-size: 0.98rem;
		padding: 0.6rem 1.3rem;
	}

	.tabs {
		display: flex;
		gap: 0.25rem;
		border-bottom: 1px solid var(--border);
		margin-bottom: 1.1rem;
		overflow-x: auto;
	}
	.tab {
		background: transparent;
		border: none;
		border-bottom: 2px solid transparent;
		color: var(--text-dim);
		font: inherit;
		font-size: 0.88rem;
		padding: 0.55rem 0.85rem;
		cursor: pointer;
		white-space: nowrap;
	}
	.tab:hover {
		color: var(--text);
	}
	.tab.active {
		color: var(--text);
		border-bottom-color: var(--accent);
	}

	.stat-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(11rem, 1fr));
		gap: 0.7rem;
		margin-bottom: 1.2rem;
	}
	.section-title {
		font-size: 0.78rem;
		text-transform: uppercase;
		letter-spacing: 0.09em;
		color: var(--text-dim);
		margin: 1.1rem 0 0.6rem;
	}
	.folder-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(15rem, 1fr));
		gap: 0.7rem;
	}
	.folder-card {
		display: flex;
		flex-direction: column;
		gap: 0.8rem;
		background: var(--surface2);
		border: 1px solid var(--border);
		border-radius: 0.75rem;
		padding: 0.9rem 1rem;
	}
	.folder-card-head {
		display: flex;
		gap: 0.65rem;
		align-items: flex-start;
	}
	.folder-card-head > :global(svg) {
		font-size: 1.4rem;
		color: var(--accent);
		margin-top: 0.1rem;
	}
	.folder-title {
		font-weight: 600;
	}
	.folder-card-foot {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		margin-top: auto;
	}
	.folder-panel-head,
	.logs-head {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 1rem;
		margin-bottom: 1rem;
	}
	.folder-panel h2,
	.logs-panel h2,
	.settings-panel h2 {
		margin: 0 0 0.3rem;
		font-size: 1.1rem;
	}
	.logs-panel {
		display: flex;
		flex-direction: column;
		min-height: 20rem;
	}
	.log-list {
		flex: 1;
		max-height: 34rem;
		overflow: auto;
		background: var(--surface0);
		border: 1px solid var(--border);
		border-radius: 0.65rem;
		padding: 0.75rem;
		font-family: var(--font-mono);
		font-size: 0.76rem;
		line-height: 1.5;
	}
	.log-line {
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}
	.empty-log {
		padding: 1rem;
	}
	.settings-panel {
		display: flex;
		flex-direction: column;
		gap: 0.9rem;
		max-width: 42rem;
	}
	.info-row {
		display: flex;
		justify-content: space-between;
		gap: 1rem;
		padding: 0.55rem 0.75rem;
		background: var(--surface2);
		border: 1px solid var(--border);
		border-radius: 0.55rem;
		font-size: 0.85rem;
	}
	.info-row code {
		font-family: var(--font-mono);
		font-size: 0.78rem;
		color: var(--accent);
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.muted {
		color: var(--text-dim);
		font-size: 0.82rem;
	}
	.row {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		flex-wrap: wrap;
	}
	.btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 0.4rem;
		background: var(--surface3);
		border: 1px solid var(--border);
		color: var(--text);
		border-radius: 0.55rem;
		padding: 0.5rem 0.85rem;
		font: inherit;
		font-size: 0.85rem;
		cursor: pointer;
		white-space: nowrap;
	}
	.btn:hover:not(:disabled) {
		background: var(--surface4);
	}
	.btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
	.btn.primary {
		background: var(--accent);
		border-color: var(--accent);
		color: #fff;
		font-weight: 600;
	}
	.btn.primary:hover:not(:disabled) {
		background: var(--accent-strong);
	}
	.btn.danger {
		color: var(--error);
		border-color: color-mix(in srgb, var(--error) 40%, transparent);
		background: transparent;
	}
	.btn.small {
		padding: 0.3rem 0.6rem;
		font-size: 0.78rem;
	}
	.btn.wide {
		width: 100%;
	}
	.form {
		display: flex;
		flex-direction: column;
		gap: 0.9rem;
		padding: 0.25rem 0.1rem;
	}
	.field {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
		font-size: 0.82rem;
		color: var(--text-dim);
	}
	.field :global(.component-textfield) {
		width: 100%;
	}
	.select {
		background: var(--surface2);
		border: 1px solid var(--border);
		color: var(--text);
		border-radius: 0.5rem;
		padding: 0.55rem 0.7rem;
		font: inherit;
		font-size: 0.88rem;
	}
	.form-actions {
		display: flex;
		justify-content: flex-end;
		gap: 0.5rem;
		margin-top: 0.4rem;
	}
	.form-actions.spread {
		justify-content: space-between;
		align-items: center;
	}
	.icon-picker {
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem;
	}
	.icon-choice {
		width: 2.4rem;
		height: 2.4rem;
		display: grid;
		place-items: center;
		font-size: 1.25rem;
		background: var(--surface2);
		border: 1px solid var(--border);
		border-radius: 0.5rem;
		cursor: pointer;
	}
	.icon-choice.selected {
		border-color: var(--accent);
		background: color-mix(in srgb, var(--accent) 22%, var(--surface2));
	}
	.account {
		display: flex;
		flex-direction: column;
		gap: 1.1rem;
	}
	.account-current {
		display: flex;
		align-items: center;
		gap: 0.8rem;
		padding: 0.85rem;
		background: var(--surface2);
		border: 1px solid var(--border);
		border-radius: 0.75rem;
	}
	.avatar {
		width: 2.7rem;
		height: 2.7rem;
		border-radius: 0.7rem;
		display: grid;
		place-items: center;
		font-weight: 700;
		background: linear-gradient(135deg, var(--accent), var(--accent-2));
		color: #fff;
	}
	.avatar.offline {
		background: linear-gradient(135deg, #6b7280, #9ca3af);
	}
	.account-name {
		font-weight: 600;
	}
	.ms-login {
		display: flex;
		flex-direction: column;
		gap: 0.8rem;
		align-items: flex-start;
	}
	.ms-login .qr {
		width: 13rem;
		height: 13rem;
		background: #fff;
		padding: 0.75rem;
		border-radius: 0.5rem;
	}
	.offline-form {
		border-top: 1px solid var(--border);
		padding-top: 1rem;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	.offline-form h3 {
		margin: 0;
		font-size: 0.95rem;
	}
	.offline-form .row :global(.component-textfield) {
		flex: 1;
	}
	.error {
		color: var(--error);
	}
	.toast {
		position: fixed;
		right: 1rem;
		bottom: 2.6rem;
		max-width: min(30rem, calc(100vw - 2rem));
		background: var(--surface4);
		border: 1px solid var(--border);
		border-left: 3px solid var(--accent);
		color: var(--text);
		padding: 0.7rem 0.95rem;
		border-radius: 0.55rem;
		box-shadow: 0 10px 30px #0006;
		font-size: 0.85rem;
		z-index: 100;
	}
	.toast.error {
		border-left-color: var(--error);
	}
`;

ensureDefaultInstance();
document.querySelector("#app")!.replaceWith(<App />);
