import { css, FC } from "dreamland/core";
import { Button, Icon } from "./ui/Button";
import { Dialog } from "./ui/Dialog";
import iconFolder from "@ktibow/iconset-material-symbols/folder";
import iconDraft from "@ktibow/iconset-material-symbols/draft";
import iconDownload from "@ktibow/iconset-material-symbols/download";
import iconDelete from "@ktibow/iconset-material-symbols/delete";
import iconClose from "@ktibow/iconset-material-symbols/close";
import iconSave from "@ktibow/iconset-material-symbols/save";
import iconUploadFile from "@ktibow/iconset-material-symbols/upload-file";
import iconUploadFolder from "@ktibow/iconset-material-symbols/drive-folder-upload";
import iconArchive from "@ktibow/iconset-material-symbols/archive";
import iconUnarchive from "@ktibow/iconset-material-symbols/unarchive";
import iconArrowBack from "@ktibow/iconset-material-symbols/arrow-back";

import tar, { Headers as TarHeaders, Pack } from "tar-stream";
import { opfsInvalidate } from "./opfs";
import {
	fromWeb as streamFromWeb,
	toWeb as streamToWeb,
	/* @ts-expect-error streamx-webstream ships no type declarations */
} from "streamx-webstream";

// The File System Access API pickers are non-standard and missing from lib.dom.
declare global {
	function showOpenFilePicker(options?: { multiple?: boolean }): Promise<FileSystemFileHandle[]>;
	function showDirectoryPicker(): Promise<FileSystemDirectoryHandle>;
	function showSaveFilePicker(options?: {
		excludeAcceptAllOption?: boolean;
		suggestedName?: string;
		types?: FilePickerAcceptType[];
	}): Promise<FileSystemFileHandle>;
	type FilePickerAcceptType = {
		description?: string;
		accept: Record<string, string | string[]>;
	};
	interface Window {
		showOpenFilePicker?: unknown;
		showDirectoryPicker?: unknown;
		showSaveFilePicker?: unknown;
	}
}

export const PICKERS_UNAVAILABLE =
	!window.showDirectoryPicker || !window.showOpenFilePicker;

export const TAR_TYPES: FilePickerAcceptType[] = [
	{
		description: "TAR archive (.tar)",
		accept: { "application/x-tar": ".tar" },
	},
	{
		description: "GZip compressed TAR archive (.tar.gz)",
		accept: { "application/x-gzip": ".tar.gz", "application/gzip": ".tar.gz" },
	},
];

const rootFolder = await navigator.storage.getDirectory();

async function recursiveGetDirectory(
	dir: FileSystemDirectoryHandle,
	path: string[]
): Promise<FileSystemDirectoryHandle> {
	if (path.length === 0) return dir;
	return recursiveGetDirectory(await dir.getDirectoryHandle(path[0]), path.slice(1));
}

async function copyFile(file: FileSystemFileHandle, to: FileSystemDirectoryHandle) {
	const data = await file.getFile().then((r) => r.stream());
	const handle = await to.getFileHandle(file.name, { create: true });
	opfsInvalidate();
	const writable = await handle.createWritable();
	await data.pipeTo(writable);
}

async function copyFolder(folder: FileSystemDirectoryHandle, to: FileSystemDirectoryHandle) {
	async function upload(from: FileSystemDirectoryHandle, into: FileSystemDirectoryHandle) {
		// FileSystemDirectoryHandle async iteration lives in lib.dom.asynciterable, not enabled here.
		for await (const [name, entry] of from as any) {
			if (entry.kind === "file") {
				await copyFile(entry as FileSystemFileHandle, into);
			} else {
				const newTo = await into.getDirectoryHandle(name, { create: true });
				opfsInvalidate();
				await upload(entry as FileSystemDirectoryHandle, newTo);
			}
		}
	}
	const newFolder = await to.getDirectoryHandle(folder.name, { create: true });
	opfsInvalidate();
	await upload(folder, newFolder);
}

async function createEntry(
	pack: Pack,
	header: TarHeaders,
	file?: ReadableStream<Uint8Array>
) {
	let resolve: () => void = null!;
	let reject: (err: any) => void = null!;
	const promise = new Promise<void>((res, rej) => {
		resolve = res;
		reject = rej;
	});

	const entry = pack.entry(header, (err) => {
		if (err) reject(err);
		else resolve();
	});

	if (file) {
		const reader = file.getReader();
		while (true) {
			const { value, done } = await reader.read();
			if (done || !value) break;

			entry.write(value);
		}

		entry.end();
	} else {
		entry.end();
	}

	await promise;
}

export function createTar(
	folder: FileSystemDirectoryHandle,
	callback?: (type: "directory" | "file", name: string) => void
): ReadableStream {
	const archive = tar.pack();

	async function pack(pathPrefix: string, folder: FileSystemDirectoryHandle) {
		// FileSystemDirectoryHandle async iteration lives in lib.dom.asynciterable, not enabled here.
		for await (const [name, entry] of folder as any) {
			if (callback) callback(entry.kind, name);

			if (entry.kind == "file") {
				const file = await (entry as FileSystemFileHandle).getFile();
				const stream = file.stream();

				await createEntry(
					archive,
					{
						name: pathPrefix + name,
						type: entry.kind,
						size: file.size,
					},
					stream
				);
			} else {
				await createEntry(archive, {
					name: pathPrefix + name,
					type: entry.kind,
				});

				await pack(pathPrefix + name + "/", entry as FileSystemDirectoryHandle);
			}
		}
	}
	pack("", folder).then(() => archive.finalize());

	return streamToWeb(archive);
}

export async function extractTar(
	stream: ReadableStream<Uint8Array>,
	folder: FileSystemDirectoryHandle,
	callback?: (type: "directory" | "file", name: string) => void
) {
	const tarInput = streamFromWeb(stream);
	const archive = tar.extract();

	archive.on("entry", async (header, stream, next) => {
		const body: ReadableStream<Uint8Array> = streamToWeb(stream);

		async function consume() {
			const reader = body.getReader();

			while (true) {
				const { done, value } = await reader.read();
				if (done || !value) break;
			}
		}

		const path = header.name.split("/");
		if (path[path.length - 1] === "") path.pop();
		if (path[0] === folder.name) path.shift();
		if (path.length === 0) {
			await consume();
			next();
			return;
		}

		let handle = folder;
		for (const name of path.splice(0, path.length - 1)) {
			handle = await handle.getDirectoryHandle(name, { create: true });
		}
		opfsInvalidate();

		if (header.type === "directory") {
			await handle.getDirectoryHandle(path[0], { create: true });
			opfsInvalidate();
			await consume();

			if (callback) callback("directory", path[0]);
		} else if (header.type === "file") {
			const file = await handle.getFileHandle(path[0], { create: true });
			opfsInvalidate();
			const writable = await file.createWritable();
			await body.pipeTo(writable);

			if (callback) callback("file", path[0]);
		} else {
			await consume();
		}

		next();
	});

	const promise = new Promise<void>((res, rej) => {
		archive.on("finish", () => res());
		archive.on("error", (err) => rej(err));
	});

	tarInput.pipe(archive);
	await promise;
}

type Entry = { name: string; entry: FileSystemHandle };

export function OpfsExplorer(
	this: FC<
		{ open: boolean; start?: string[] },
		{
			path: FileSystemDirectoryHandle;
			components: string[];
			entries: Entry[];
			editing: FileSystemFileHandle | null;
			uploading: boolean;
			downloading: boolean;
		}
	>
) {
	this.path = rootFolder;
	this.components = [];
	this.entries = [];
	this.editing = null as FileSystemFileHandle | null;
	this.uploading = false;
	this.downloading = false;

	const refresh = async () => {
		this.components = (await rootFolder.resolve(this.path)) || [];

		const entries: Entry[] = [];
		for await (const [name, entry] of this.path as any) {
			entries.push({ name, entry: entry as FileSystemHandle });
		}
		entries.sort((a, b) => {
			const kind = a.entry.kind.localeCompare(b.entry.kind);
			return kind === 0 ? a.name.localeCompare(b.name) : kind;
		});
		this.entries = entries;
	};

	const openAt = async (segments: string[]) => {
		let dir = rootFolder;
		for (const segment of segments) {
			dir = await dir.getDirectoryHandle(segment, { create: true });
			opfsInvalidate();
		}
		this.editing = null;
		this.path = dir;
	};

	this.cx.mount = () => {
		// reassigning this.path re-runs refresh, so navigation/upload just set this.path = this.path
		use(this.path).listen(refresh);
		use(this.open).listen((open) => {
			if (!open) return;
			if (this.start && this.start.length > 0) void openAt(this.start);
			else refresh();
		});
		if (this.open && this.start && this.start.length > 0) void openAt(this.start);
		else refresh();
	};

	const goUp = async () => {
		this.editing = null;
		this.path = await recursiveGetDirectory(rootFolder, this.components.slice(0, -1));
	};

	const uploadFile = async () => {
		const files = await showOpenFilePicker({ multiple: true });
		this.uploading = true;
		for (const file of files) await copyFile(file, this.path);
		this.path = this.path;
		this.uploading = false;
	};

	const uploadFolder = async () => {
		const folder = await showDirectoryPicker();
		this.uploading = true;
		await copyFolder(folder, this.path);
		this.path = this.path;
		this.uploading = false;
	};

	const downloadArchive = async () => {
		const dirName = this.components.at(-1) || "ikvmcraft";
		const file = await showSaveFilePicker({
			excludeAcceptAllOption: true,
			suggestedName: dirName + ".tar",
			types: TAR_TYPES,
		});

		this.downloading = true;

		let stream = createTar(this.path, (type, name) => console.log(`tarring ${type} ${name}`));
		if (file.name.endsWith(".gz")) stream = stream.pipeThrough(new CompressionStream("gzip"));

		const fileStream = await file.createWritable();
		await stream.pipeTo(fileStream);

		this.downloading = false;
	};

	const uploadArchiveFiles = async (files: File[]) => {
		if (files.length === 0) return;
		this.uploading = true;
		try {
			for (const file of files) {
				let stream = file.stream();
				if (file.name.endsWith(".gz")) stream = stream.pipeThrough(new DecompressionStream("gzip"));
				await extractTar(stream, this.path, (type, name) => console.log(`untarring ${type} ${name}`));
			}
		} finally {
			this.path = this.path;
			this.uploading = false;
		}
	};

	const archiveInput: HTMLInputElement = (
		<input
			type="file"
			accept=".tar,.tar.gz"
			multiple
			hidden
			on:change={() => {
				const files = Array.from(archiveInput.files || []);
				archiveInput.value = "";
				return uploadArchiveFiles(files);
			}}
		/>
	) as HTMLInputElement;

	const uploadArchive = async () => {
		if (!window.showOpenFilePicker) {
			archiveInput.click();
			return;
		}
		let handles: FileSystemFileHandle[];
		try {
			handles = await showOpenFilePicker({ multiple: true });
		} catch (error) {
			if (error instanceof DOMException && error.name === "AbortError") return;
			throw error;
		}
		await uploadArchiveFiles(await Promise.all(handles.map((file) => file.getFile())));
	};

	const uploadDisabled = use(this.uploading).map(
		(x) => x || PICKERS_UNAVAILABLE,
	);
	const downloadDisabled = use(this.downloading).map(
		(x) => x || !window.showSaveFilePicker,
	);

	return (
		<div class="fs-explorer">
			<Dialog name="Files" open={use(this.open)}>
				<div class="content">
					<div class="bar">
						{use(this.components).map((c) =>
							c.length > 0 ? (
								<Button on:click={goUp} icon="full" title="Up a level">
									<Icon icon={iconArrowBack} />
								</Button>
							) : null,
						)}
						<span class="cwd">
							{use(this.components).map((c) =>
								c.length === 0 ? "Root Directory" : "/" + c.join("/"),
							)}
						</span>
						<span class="spacer" />
						<Button
							disabled={uploadDisabled}
							on:click={uploadFile}
							icon="full"
							title="Upload File"
						>
							<Icon icon={iconUploadFile} />
						</Button>
						<Button
							disabled={uploadDisabled}
							on:click={uploadFolder}
							icon="full"
							title="Upload Folder"
						>
							<Icon icon={iconUploadFolder} />
						</Button>
					</div>

					{use(this.uploading).map((u) =>
						u ? <div class="status">Uploading files...</div> : null,
					)}
					{use(this.downloading).map((d) =>
						d ? <div class="status">Downloading archive...</div> : null,
					)}

					<div class="entries">
						{use(this.entries).map((entries) =>
							entries.map((x) => {
								const isDir = x.entry.kind === "directory";

								const open = () => {
									if (isDir) {
										this.editing = null;
										this.path = x.entry as FileSystemDirectoryHandle;
									} else {
										this.editing = x.entry as FileSystemFileHandle;
									}
								};
								const download = async () => {
									const blob = await (
										x.entry as FileSystemFileHandle
									).getFile();
									const url = URL.createObjectURL(blob);
									const a = document.createElement("a");
									a.href = url;
									a.download = x.name;
									a.click();
									await new Promise((r) => setTimeout(r, 100));
									URL.revokeObjectURL(url);
								};
								const remove = async () => {
									if (this.editing?.name === x.name) this.editing = null;
									await this.path.removeEntry(x.name, { recursive: true });
									this.path = this.path;
								};

								return (
									<div class="entry">
										<Button
											class="open"
											type="listitem"
											on:click={open}
											title={x.name}
										>
											<Icon icon={isDir ? iconFolder : iconDraft} />
											<span class="entry-name">{x.name}</span>
										</Button>
										{!isDir ? (
											<Button
												on:click={download}
												icon="full"
												type="listaction"
												title="Download file"
											>
												<Icon icon={iconDownload} />
											</Button>
										) : null}
										<Button
											on:click={remove}
											icon="full"
											type="listaction"
											title="Delete"
										>
											<Icon icon={iconDelete} />
										</Button>
									</div>
								);
							}),
						)}
					</div>

					{use(this.editing).map((file) => {
						if (!file) return null;

						const area = (
							<textarea aria-label={`Edit ${file.name}`} />
						) as HTMLTextAreaElement;
						area.value = "Loading file...";
						file
							.getFile()
							.then((r) => r.text())
							.then((r) => (area.value = r));

						const save = async () => {
							const writable = await file.createWritable();
							await writable.write(area.value);
							await writable.close();
							this.editing = null;
						};

						return (
							<div class="editor">
								<div class="controls">
									<span class="name">{file.name}</span>
									<span class="spacer" />
									<Button on:click={save} type="primary" icon="left">
										<Icon icon={iconSave} /> Save
									</Button>
									<Button
										on:click={() => (this.editing = null)}
										icon="full"
										title="Close editor"
									>
										<Icon icon={iconClose} />
									</Button>
								</div>
								{area}
							</div>
						);
					})}
					<div class="spacer" />
					<div class="archive">
						{archiveInput}
						<Button
							disabled={use(this.uploading)}
							on:click={uploadArchive}
							icon="left"
							title="Extract a .tar/.tar.gz here"
						>
							<Icon icon={iconUnarchive} /> Upload Folder Archive
						</Button>
						<Button
							disabled={downloadDisabled}
							on:click={downloadArchive}
							icon="left"
							title="Download this folder as a .tar/.tar.gz"
						>
							<Icon icon={iconArchive} /> Download Folder Archive
						</Button>
					</div>
				</div>
			</Dialog>
		</div>
	);
}
OpfsExplorer.style = css`
	:scope {
		display: contents;
	}
	.content {
		display: flex;
		flex-direction: column;
		gap: 1rem;
		min-height: min(44rem, 90vh);
	}

	.bar {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		flex-wrap: wrap;
	}
	.bar .cwd {
		min-width: 0;
		font-weight: bold;
		font-family: var(--font-mono);
		word-break: break-all;
	}
	.spacer {
		flex: 1;
	}

	.status {
		font-style: italic;
	}

	.entries {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		min-height: 0;
	}
	.entry {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}
	.entries .entry :global(.open) {
		flex: 1;
		min-width: 0;
		gap: 0.5rem;
		justify-content: flex-start;
		text-align: left;
		font-family: var(--font-mono);
	}
	.entry :global(svg) {
		width: 1.5rem;
		height: 1.5rem;
	}
	.entry-name {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.editor {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	.editor .controls {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}
	.editor .name {
		font-weight: bold;
		font-family: var(--font-mono);
		word-break: break-all;
	}
	.editor textarea {
		min-height: 16rem;
		font-family: var(--font-mono);
		background: var(--bg-sub);
		color: var(--fg);
		border: 2px solid var(--surface4);
		border-radius: 0.5rem;
		padding: 0.5rem;
		resize: vertical;
	}
	.archive {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}
	.archive > :global(button) {
		flex: 1;
	}
`;
