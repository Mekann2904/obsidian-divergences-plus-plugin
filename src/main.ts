/* src/main.ts
 * Plugin entry point for the background picker.
 * Why: connects Obsidian lifecycle, settings, and UI actions.
 * Related: src/settings.ts, src/ui/background-picker-overlay.ts, src/utils/image-utils.ts */
import {normalizePath, Plugin, TFile} from "obsidian";
import {DEFAULT_SETTINGS, MyPluginSettings, MyPluginSettingTab} from "./settings";
import {BackgroundPickerOverlay} from "./ui/background-picker-overlay";
import {buildUrlFromRelative} from "./utils/image-utils";

export default class DivergencesPlusPlugin extends Plugin {
	settings: MyPluginSettings;
	private backgroundPicker: BackgroundPickerOverlay | null = null;
	private cacheWarmupHandle: number | null = null;
	private cacheWarmupIsIdle = false;

	async onload(): Promise<void> {
		await this.loadSettings();
		this.applySelectedBackground();
		this.ensureBackgroundPicker();
		this.scheduleCacheWarmup();

		this.addCommand({
			id: "open-background-picker",
			name: "Open background picker",
			callback: () => this.openBackgroundPicker(),
		});

		this.addSettingTab(new MyPluginSettingTab(this.app, this));
	}

	openBackgroundPicker(): void {
		const picker = this.ensureBackgroundPicker();
		picker.open();
	}

	onunload(): void {
		this.clearCacheWarmup();
		this.backgroundPicker?.close();
		this.backgroundPicker = null;
	}

	applySelectedBackground(): void {
		const url = this.getSelectedImageUrl();
		if (!url) {
			this.clearCssBackground();
			return;
		}
		this.applyBackgroundUrl(url);
	}

	getSelectedImageUrl(): string {
		const baseUrl = this.settings.serverBaseUrl.trim();
		const relativePath = this.settings.selectedImagePath.trim();
		if (!baseUrl || !relativePath) {
			if (this.settings.useRemoteIndex || !relativePath) {
				return "";
			}
		}
		if (baseUrl) {
			return buildUrlFromRelative(baseUrl, relativePath);
		}
		return this.getLocalImageUrl(relativePath);
	}

	getCssVariableName(): string {
		const name = this.settings.cssVariableName.trim();
		return name.length > 0 ? name : "--anp-background-image-dark";
	}

	applyBackgroundUrl(url: string): void {
		const cssVar = this.getCssVariableName();
		const safeUrl = url.replace(/"/g, "%22");
		document.body.style.setProperty(cssVar, `url("${safeUrl}")`);
	}

	clearCssBackground(): void {
		const cssVar = this.getCssVariableName();
		document.body.style.removeProperty(cssVar);
	}

	private getLocalImageUrl(relativePath: string): string {
		const folderPath = this.settings.imageFolderPath.trim();
		if (!folderPath) {
			return "";
		}
		const normalizedFolder = normalizePath(folderPath);
		const normalizedRelative = relativePath.trim().replace(/^\/+/, "");
		const fullPath = normalizePath(`${normalizedFolder}/${normalizedRelative}`);
		const file = this.app.vault.getAbstractFileByPath(fullPath);
		if (!(file instanceof TFile)) {
			return "";
		}
		return this.app.vault.getResourcePath(file);
	}

	async setBackgroundByRelativePath(relativePath: string): Promise<void> {
		this.settings.selectedImagePath = relativePath;
		await this.saveSettings();
		this.applySelectedBackground();
	}

	async clearBackgroundSelection(): Promise<void> {
		this.settings.selectedImagePath = "";
		await this.saveSettings();
		this.clearCssBackground();
	}

	async loadSettings(): Promise<void> {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			(await this.loadData()) as Partial<MyPluginSettings>
		);
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	private ensureBackgroundPicker(): BackgroundPickerOverlay {
		if (!this.backgroundPicker) {
			this.backgroundPicker = new BackgroundPickerOverlay(this.app, this);
		}
		return this.backgroundPicker;
	}

	private scheduleCacheWarmup(): void {
		if (!this.backgroundPicker || this.cacheWarmupHandle !== null) {
			return;
		}
		const runWarmup = (): void => {
			this.backgroundPicker?.primeCache();
			this.cacheWarmupHandle = null;
			this.cacheWarmupIsIdle = false;
		};
		const requestIdle = (
			window as Window & {
				requestIdleCallback?: (callback: () => void, options?: {timeout: number}) => number;
			}
		).requestIdleCallback;
		// Warm the cache after startup without blocking the first render.
		if (requestIdle) {
			this.cacheWarmupIsIdle = true;
			this.cacheWarmupHandle = requestIdle(runWarmup, {timeout: 1200});
			return;
		}
		this.cacheWarmupHandle = window.setTimeout(runWarmup, 1200);
	}

	private clearCacheWarmup(): void {
		if (this.cacheWarmupHandle === null) {
			return;
		}
		if (this.cacheWarmupIsIdle) {
			const cancelIdle = (window as Window & {cancelIdleCallback?: (id: number) => void})
				.cancelIdleCallback;
			cancelIdle?.(this.cacheWarmupHandle);
		} else {
			window.clearTimeout(this.cacheWarmupHandle);
		}
		this.cacheWarmupHandle = null;
		this.cacheWarmupIsIdle = false;
	}
}
