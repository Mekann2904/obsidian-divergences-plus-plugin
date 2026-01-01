/* src/ui/background-picker-overlay.ts
 * Custom overlay that shows background images in a tile grid.
 * Why: provides a picker without relying on Obsidian's Modal.
 * Related: src/main.ts, src/settings.ts, src/utils/image-utils.ts */
import {App, Notice} from "obsidian";
import type {MyPluginSettings} from "../settings";
import {getVaultImageItems, ImageItem} from "../utils/image-utils";

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
	private itemCount = 0;
	private resizeObserver: ResizeObserver | null = null;
	private pendingGridUpdate = false;
	private renderToken = 0;
	private renderQueue: {items: ImageItem[]; index: number; token: number} | null = null;
	private selectedPath = "";
	private selectedTile: HTMLButtonElement | null = null;
	private cachedKey: string | null = null;
	private cachedItems: ImageItem[] = [];
	private cachedError = "";

	private readonly handleOverlayClick = (event: MouseEvent): void => {
		if (event.target === this.overlayEl) {
			this.close();
		}
	};

	private readonly handleResize = (): void => {
		this.updateAspectRatio();
		this.requestGridUpdate();
	};

	private readonly handleKeydown = (event: KeyboardEvent): void => {
		if (event.key === "Escape") {
			event.preventDefault();
			this.close();
		}
	};

	private readonly handleGridClick = (event: MouseEvent): void => {
		const target = event.target as HTMLElement | null;
		const tile = target?.closest<HTMLButtonElement>(".anp-bg-picker-tile");
		if (!tile || !this.gridEl || !this.gridEl.contains(tile)) {
			return;
		}
		const relativePath = tile.dataset.relativePath ?? "";
		if (!relativePath) {
			return;
		}
		void this.handleTileSelection(tile, relativePath);
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
		overlay.className = "anp-bg-picker-overlay is-image-only";
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
		refreshButton.addEventListener("click", () => void this.renderGrid(true));
		controls.appendChild(refreshButton);

		const clearButton = document.createElement("button");
		clearButton.type = "button";
		clearButton.textContent = "Clear";
		clearButton.addEventListener("click", async () => {
			await this.host.clearBackgroundSelection();
			this.setSelection("", null);
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
		window.addEventListener("resize", this.handleResize);
		grid.addEventListener("click", this.handleGridClick);

		this.overlayEl = overlay;
		this.dialogEl = dialog;
		this.gridEl = grid;
		this.statusEl = status;
		this.infoEl = info;

		this.refreshInfo();
		this.updateAspectRatio();
		void this.renderGrid();
		this.focusDialog();
	}

	close(): void {
		if (!this.overlayEl) {
			return;
		}

		this.renderToken += 1;
		this.overlayEl.removeEventListener("click", this.handleOverlayClick);
		document.removeEventListener("keydown", this.handleKeydown);
		window.removeEventListener("resize", this.handleResize);
		this.gridEl?.removeEventListener("click", this.handleGridClick);
		this.resizeObserver?.disconnect();
		this.resizeObserver = null;
		this.overlayEl.remove();

		this.overlayEl = null;
		this.dialogEl = null;
		this.gridEl = null;
		this.statusEl = null;
		this.infoEl = null;
		this.renderQueue = null;
		this.selectedTile = null;
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

	private updateAspectRatio(): void {
		if (!this.dialogEl) {
			return;
		}
		const width = Math.max(window.innerWidth, 1);
		const height = Math.max(window.innerHeight, 1);
		// Match thumbnail aspect ratio to the current window size.
		this.dialogEl.style.setProperty("--anp-bg-picker-aspect", `${width} / ${height}`);
	}

	private async renderGrid(forceRefresh = false): Promise<void> {
		if (!this.gridEl || !this.statusEl) {
			return;
		}

		const token = (this.renderToken += 1);
		this.gridEl.innerHTML = "";
		// Keep selection state so tiles can mark themselves during batch rendering.
		this.selectedPath = this.host.settings.selectedImagePath;
		this.selectedTile = null;
		this.renderQueue = null;
		this.itemCount = 0;
		this.statusEl.textContent = "Loading images...";

		// Cache by settings so reopening the picker avoids a full scan.
		const cacheKey = this.getCacheKey();
		let result;
		if (!forceRefresh && cacheKey === this.cachedKey) {
			result = {items: this.cachedItems, errorMessage: this.cachedError};
		} else {
			// Always use local vault URLs for thumbnails to keep the picker fast.
			result = getVaultImageItems(this.app, "", this.host.settings.imageFolderPath);
		}

		if (token !== this.renderToken || !this.gridEl || !this.statusEl) {
			return;
		}

		if (result.errorMessage) {
			this.statusEl.textContent = result.errorMessage;
			this.cachedKey = cacheKey;
			this.cachedItems = [];
			this.cachedError = result.errorMessage;
			return;
		}

		if (result.items.length === 0) {
			this.statusEl.textContent = "No images found.";
			this.cachedKey = cacheKey;
			this.cachedItems = [];
			this.cachedError = "";
			return;
		}

		this.cachedKey = cacheKey;
		this.cachedItems = result.items;
		this.cachedError = "";
		this.itemCount = result.items.length;

		this.ensureResizeObserver();
		this.requestGridUpdate();
		this.startTileRender(result.items, token);
	}

	private createTile(item: ImageItem, index: number): HTMLElement {
		const tile = document.createElement("button");
		tile.type = "button";
		tile.className = "anp-bg-picker-tile";
		tile.dataset.relativePath = item.relativePath;
		if (item.relativePath === this.selectedPath) {
			tile.classList.add("is-selected");
			this.selectedTile = tile;
		}

		const img = document.createElement("img");
		img.className = "anp-bg-picker-thumb";
		img.decoding = "async";
		img.loading = index < 12 ? "eager" : "lazy";
		if (index < 12) {
			if ("fetchPriority" in img) {
				(img as HTMLImageElement & {fetchPriority?: string}).fetchPriority = "high";
			}
		}
		img.alt = item.displayName;
		img.src = item.url;

		const name = document.createElement("div");
		name.className = "anp-bg-picker-name";
		name.textContent = item.displayName;

		tile.appendChild(img);
		tile.appendChild(name);

		return tile;
	}

	private setSelection(relativePath: string, tile: HTMLButtonElement | null): void {
		if (this.selectedTile) {
			this.selectedTile.classList.remove("is-selected");
		}
		this.selectedTile = tile;
		this.selectedPath = relativePath;
		if (this.selectedTile) {
			this.selectedTile.classList.add("is-selected");
		}
	}

	private async handleTileSelection(
		tile: HTMLButtonElement,
		relativePath: string
	): Promise<void> {
		await this.host.setBackgroundByRelativePath(relativePath);
		this.setSelection(relativePath, tile);
		new Notice("Background updated.");
		this.close();
	}

	private startTileRender(items: ImageItem[], token: number): void {
		if (!this.gridEl || !this.statusEl) {
			return;
		}
		this.renderQueue = {items, index: 0, token};
		this.statusEl.textContent = `Loading 0 / ${items.length}...`;
		this.scheduleTileRender();
	}

	private scheduleTileRender(): void {
		if (!this.renderQueue) {
			return;
		}
		const requestIdle = (
			window as Window & {
				requestIdleCallback?: (callback: () => void, options?: {timeout: number}) => number;
			}
		).requestIdleCallback;
		// Render in idle slices so the UI stays responsive with many tiles.
		if (requestIdle) {
			requestIdle(() => this.renderTileBatch(), {timeout: 120});
			return;
		}
		window.setTimeout(() => this.renderTileBatch(), 16);
	}

	private renderTileBatch(): void {
		if (!this.gridEl || !this.statusEl || !this.renderQueue) {
			return;
		}

		const {items, token} = this.renderQueue;
		if (token !== this.renderToken) {
			return;
		}

		const fragment = document.createDocumentFragment();
		const batchSize = 24;
		let rendered = 0;

		while (rendered < batchSize && this.renderQueue.index < items.length) {
			const item = items[this.renderQueue.index];
			this.renderQueue.index += 1;
			if (!item) {
				continue;
			}
			fragment.appendChild(this.createTile(item, this.renderQueue.index - 1));
			rendered += 1;
		}

		this.gridEl.appendChild(fragment);

		if (this.renderQueue.index < items.length) {
			this.statusEl.textContent = `Loading ${this.renderQueue.index} / ${items.length}...`;
			this.scheduleTileRender();
			return;
		}

		this.statusEl.textContent = "";
		this.renderQueue = null;
	}

	private getCacheKey(): string {
		const mode = this.host.settings.useRemoteIndex ? "remote" : "vault";
		// Base URL only affects remote mode; vault thumbnails ignore it.
		const baseUrl = this.host.settings.useRemoteIndex
			? this.host.settings.serverBaseUrl.trim()
			: "";
		const folder = this.host.settings.imageFolderPath.trim();
		return `${mode}|${baseUrl}|${folder}`;
	}

	private ensureResizeObserver(): void {
		if (this.resizeObserver || !this.gridEl) {
			return;
		}
		this.resizeObserver = new ResizeObserver(() => {
			this.requestGridUpdate();
		});
		this.resizeObserver.observe(this.gridEl);
	}

	private requestGridUpdate(): void {
		if (this.pendingGridUpdate) {
			return;
		}
		this.pendingGridUpdate = true;
		requestAnimationFrame(() => {
			this.pendingGridUpdate = false;
			this.updateGridLayout();
		});
	}

	private updateGridLayout(): void {
		if (!this.gridEl || this.itemCount === 0) {
			return;
		}

		const rect = this.gridEl.getBoundingClientRect();
		if (rect.width <= 0 || rect.height <= 0) {
			return;
		}

		const styles = getComputedStyle(this.gridEl);
		const paddingX =
			(this.parsePixelValue(styles.paddingLeft) ?? 0) +
			(this.parsePixelValue(styles.paddingRight) ?? 0);
		const paddingY =
			(this.parsePixelValue(styles.paddingTop) ?? 0) +
			(this.parsePixelValue(styles.paddingBottom) ?? 0);
		const contentWidth = rect.width - paddingX;
		const contentHeight = rect.height - paddingY;
		if (contentWidth <= 0 || contentHeight <= 0) {
			return;
		}
		const gap = this.parsePixelValue(styles.gap) ?? 12;
		const aspect = Math.max(window.innerWidth / Math.max(window.innerHeight, 1), 0.1);
		const layout = this.findBestGridLayout(
			this.itemCount,
			contentWidth,
			contentHeight,
			aspect,
			gap
		);

		this.gridEl.style.setProperty("--anp-bg-picker-columns", `${layout.columns}`);
		this.gridEl.style.setProperty("--anp-bg-picker-row-height", `${layout.rowHeight}px`);
	}

	private findBestGridLayout(
		count: number,
		width: number,
		height: number,
		aspect: number,
		gap: number
	): {columns: number; rowHeight: number} {
		let bestColumns = 1;
		let bestRowHeight = 0;
		let bestArea = 0;

		for (let columns = 1; columns <= count; columns += 1) {
			const rows = Math.ceil(count / columns);
			const totalGapWidth = gap * Math.max(columns - 1, 0);
			const totalGapHeight = gap * Math.max(rows - 1, 0);
			const availableWidth = width - totalGapWidth;
			const availableHeight = height - totalGapHeight;
			if (availableWidth <= 0 || availableHeight <= 0) {
				continue;
			}

			const maxTileWidth = availableWidth / columns;
			const maxTileHeight = availableHeight / rows;
			const tileHeight = Math.min(maxTileHeight, maxTileWidth / aspect);
			const tileWidth = tileHeight * aspect;
			if (tileHeight <= 0 || tileWidth <= 0) {
				continue;
			}

			const area = tileWidth * tileHeight;
			if (area > bestArea) {
				bestArea = area;
				bestColumns = columns;
				bestRowHeight = tileHeight;
			}
		}

		if (bestRowHeight === 0) {
			bestRowHeight = Math.max((height - gap * (count - 1)) / count, 1);
		}

		return {columns: bestColumns, rowHeight: bestRowHeight};
	}

	private parsePixelValue(value: string): number | null {
		const parsed = Number.parseFloat(value);
		return Number.isFinite(parsed) ? parsed : null;
	}
}
