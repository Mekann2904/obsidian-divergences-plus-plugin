/* src/ui/background-picker-overlay.ts
 * Custom overlay that shows background images in a tile grid.
 * Why: provides a picker without relying on Obsidian's Modal.
 * Related: src/main.ts, src/settings.ts, src/utils/image-utils.ts */
import {App, Notice} from "obsidian";
import type {MyPluginSettings} from "../settings";
import {getRemoteImageItems, getVaultImageItems, ImageItem} from "../utils/image-utils";

export interface BackgroundPickerHost {
	settings: MyPluginSettings;
	setBackgroundByRelativePath(relativePath: string): Promise<void>;
	clearBackgroundSelection(): Promise<void>;
}

export class BackgroundPickerOverlay {
	private app: App;
	private host: BackgroundPickerHost;
	private overlayEl: HTMLDivElement | null = null;
	private dialogEl: HTMLDivElement | null = null;
	private gridEl: HTMLDivElement | null = null;
	private statusEl: HTMLDivElement | null = null;
	private infoEl: HTMLDivElement | null = null;

	private readonly handleOverlayClick = (event: MouseEvent): void => {
		if (event.target === this.overlayEl) {
			this.close();
		}
	};

	private readonly handleKeydown = (event: KeyboardEvent): void => {
		if (event.key === "Escape") {
			event.preventDefault();
			this.close();
		}
	};

	constructor(app: App, host: BackgroundPickerHost) {
		this.app = app;
		this.host = host;
	}

	open(): void {
		if (this.overlayEl) {
			this.refreshInfo();
			void this.renderGrid();
			this.focusDialog();
			return;
		}

		// Keep the overlay self-contained so it can be torn down safely.
		const overlay = document.createElement("div");
		overlay.className = "anp-bg-picker-overlay";
		overlay.addEventListener("click", this.handleOverlayClick);

		const dialog = document.createElement("div");
		dialog.className = "anp-bg-picker-dialog";
		dialog.tabIndex = -1;
		dialog.setAttribute("role", "dialog");
		dialog.setAttribute("aria-modal", "true");
		overlay.appendChild(dialog);

		const header = document.createElement("div");
		header.className = "anp-bg-picker-header";

		const title = document.createElement("h2");
		title.textContent = "Background picker";
		header.appendChild(title);

		const closeButton = document.createElement("button");
		closeButton.type = "button";
		closeButton.className = "anp-bg-picker-close";
		closeButton.textContent = "Close";
		closeButton.addEventListener("click", () => this.close());
		header.appendChild(closeButton);

		dialog.appendChild(header);

		const info = document.createElement("div");
		info.className = "anp-bg-picker-info";
		dialog.appendChild(info);

		const controls = document.createElement("div");
		controls.className = "anp-bg-picker-controls";

		const refreshButton = document.createElement("button");
		refreshButton.type = "button";
		refreshButton.textContent = "Refresh";
		refreshButton.addEventListener("click", () => void this.renderGrid());
		controls.appendChild(refreshButton);

		const clearButton = document.createElement("button");
		clearButton.type = "button";
		clearButton.textContent = "Clear";
		clearButton.addEventListener("click", async () => {
			await this.host.clearBackgroundSelection();
			this.updateSelection("");
			new Notice("Background cleared.");
		});
		controls.appendChild(clearButton);

		dialog.appendChild(controls);

		const status = document.createElement("div");
		status.className = "anp-bg-picker-status";
		dialog.appendChild(status);

		const grid = document.createElement("div");
		grid.className = "anp-bg-picker-grid";
		dialog.appendChild(grid);

		document.body.appendChild(overlay);
		// Escape closes the picker even if focus is inside the grid.
		document.addEventListener("keydown", this.handleKeydown);

		this.overlayEl = overlay;
		this.dialogEl = dialog;
		this.gridEl = grid;
		this.statusEl = status;
		this.infoEl = info;

		this.refreshInfo();
		void this.renderGrid();
		this.focusDialog();
	}

	close(): void {
		if (!this.overlayEl) {
			return;
		}

		this.overlayEl.removeEventListener("click", this.handleOverlayClick);
		document.removeEventListener("keydown", this.handleKeydown);
		this.overlayEl.remove();

		this.overlayEl = null;
		this.dialogEl = null;
		this.gridEl = null;
		this.statusEl = null;
		this.infoEl = null;
	}

	private focusDialog(): void {
		if (!this.dialogEl) {
			return;
		}
		this.dialogEl.focus();
	}

	private refreshInfo(): void {
		if (!this.infoEl) {
			return;
		}
		const folderPath = this.host.settings.imageFolderPath || "(not set)";
		const baseUrl = this.host.settings.serverBaseUrl || "(not set)";
		const mode = this.host.settings.useRemoteIndex ? "HTTP index" : "Vault";
		this.infoEl.textContent = `Mode: ${mode} | Folder: ${folderPath} | Base URL: ${baseUrl}`;
	}

	private async renderGrid(): Promise<void> {
		if (!this.gridEl || !this.statusEl) {
			return;
		}

		this.gridEl.innerHTML = "";
		this.statusEl.textContent = "Loading images...";

		let result;
		if (this.host.settings.useRemoteIndex) {
			result = await getRemoteImageItems(this.host.settings.serverBaseUrl);
		} else {
			// Resolve vault images and map them to server URLs.
			result = getVaultImageItems(
				this.app,
				this.host.settings.serverBaseUrl,
				this.host.settings.imageFolderPath
			);
		}

		if (result.errorMessage) {
			this.statusEl.textContent = result.errorMessage;
			return;
		}

		if (result.items.length === 0) {
			this.statusEl.textContent = "No images found.";
			return;
		}

		this.statusEl.textContent = "";
		for (const item of result.items) {
			this.gridEl.appendChild(this.createTile(item));
		}

		this.updateSelection(this.host.settings.selectedImagePath);
	}

	private createTile(item: ImageItem): HTMLElement {
		const tile = document.createElement("button");
		tile.type = "button";
		tile.className = "anp-bg-picker-tile";
		tile.dataset.relativePath = item.relativePath;

		const img = document.createElement("img");
		img.className = "anp-bg-picker-thumb";
		img.loading = "lazy";
		img.alt = item.displayName;
		img.src = item.url;

		const name = document.createElement("div");
		name.className = "anp-bg-picker-name";
		name.textContent = item.displayName;

		tile.appendChild(img);
		tile.appendChild(name);

		tile.addEventListener("click", async () => {
			await this.host.setBackgroundByRelativePath(item.relativePath);
			this.updateSelection(item.relativePath);
			new Notice("Background updated.");
		});

		return tile;
	}

	private updateSelection(relativePath: string): void {
		if (!this.gridEl) {
			return;
		}

		const tiles = this.gridEl.querySelectorAll<HTMLButtonElement>(
			".anp-bg-picker-tile"
		);
		for (let index = 0; index < tiles.length; index += 1) {
			const tile = tiles.item(index);
			if (!tile) {
				continue;
			}
			const isSelected = tile.dataset.relativePath === relativePath;
			tile.classList.toggle("is-selected", isSelected);
		}
	}
}
