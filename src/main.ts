/* src/main.ts
 * Plugin entry point for the background picker.
 * Why: connects Obsidian lifecycle, settings, and UI actions.
 * Related: src/settings.ts, src/ui/background-picker-overlay.ts, src/utils/image-utils.ts */
import {normalizePath, Plugin, TFile} from "obsidian";
import {
	buildLocalVaultServerBaseUrl,
	findLocalVaultServerEntry,
	getLocalVaultServerApi,
	LocalVaultServerApi,
} from "./integrations/local-vault-server";
import {DEFAULT_SETTINGS, MyPluginSettings, MyPluginSettingTab} from "./settings";
import {BackgroundPickerOverlay} from "./ui/background-picker-overlay";
import {buildUrlFromRelative, resolveVaultFolderPath} from "./utils/image-utils";

export default class DivergencesPlusPlugin extends Plugin {
	settings: MyPluginSettings;
	private backgroundPicker: BackgroundPickerOverlay | null = null;
	private cacheWarmupHandle: number | null = null;
	private cacheWarmupIsIdle = false;
	private localServerUnsubscribe: (() => void) | null = null;

	async onload(): Promise<void> {
		await this.loadSettings();
		await this.syncFromLinkedServer();
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
		this.localServerUnsubscribe?.();
		this.localServerUnsubscribe = null;
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
		if (!relativePath) {
			return "";
		}
		// When linked or protected, prefer the server URL to avoid showing local-only files.
		const preferRemote =
			Boolean(baseUrl) &&
			(this.settings.useRemoteIndex ||
				this.settings.authToken.trim().length > 0 ||
				this.settings.linkedServerEntryId.trim().length > 0);
		if (preferRemote && baseUrl) {
			return buildUrlFromRelative(baseUrl, relativePath);
		}
		const localUrl = this.getLocalImageUrl(relativePath);
		if (localUrl) {
			return localUrl;
		}
		return baseUrl ? buildUrlFromRelative(baseUrl, relativePath) : "";
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
		const resolvedFolder = resolveVaultFolderPath(this.app, folderPath);
		if (resolvedFolder.errorMessage) {
			return "";
		}
		const normalizedFolder = normalizePath(resolvedFolder.folderPath);
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

	getLocalVaultServerApi(): LocalVaultServerApi | null {
		return getLocalVaultServerApi(this.app);
	}

	isLinkedToLocalServer(): boolean {
		return Boolean(this.settings.linkedServerEntryId && this.getLocalVaultServerApi());
	}

	getLinkedWhitelistInfo(): {enabled: boolean; files: string[]} {
		const api = this.getLocalVaultServerApi();
		if (!api || !this.settings.linkedServerEntryId) {
			const fallbackEntry = api ? this.findMatchingServerEntry(api) : null;
			if (!fallbackEntry) {
				return {enabled: false, files: []};
			}
			return {
				enabled: Boolean(fallbackEntry.enableWhitelist),
				files: [...fallbackEntry.whitelistFiles],
			};
		}
		const entry = findLocalVaultServerEntry(
			api.getServerEntries(),
			this.settings.linkedServerEntryId
		);
		if (!entry) {
			const fallbackEntry = this.findMatchingServerEntry(api);
			if (!fallbackEntry) {
				return {enabled: false, files: []};
			}
			return {
				enabled: Boolean(fallbackEntry.enableWhitelist),
				files: [...fallbackEntry.whitelistFiles],
			};
		}
		return {
			enabled: Boolean(entry.enableWhitelist),
			files: [...entry.whitelistFiles],
		};
	}

	getLinkedServerInfo(): {
		baseUrl: string;
		authToken: string;
		whitelistEnabled: boolean;
		whitelistFiles: string[];
	} | null {
		const api = this.getLocalVaultServerApi();
		if (!api) {
			return null;
		}
		const entry =
			findLocalVaultServerEntry(api.getServerEntries(), this.settings.linkedServerEntryId) ??
			this.findMatchingServerEntry(api);
		if (!entry) {
			return null;
		}
		return {
			baseUrl: buildLocalVaultServerBaseUrl(entry),
			authToken: entry.authToken ?? "",
			whitelistEnabled: Boolean(entry.enableWhitelist),
			whitelistFiles: [...entry.whitelistFiles],
		};
	}

	private findMatchingServerEntry(api: LocalVaultServerApi): ReturnType<
		typeof findLocalVaultServerEntry
	> {
		const entries = api.getServerEntries();
		if (entries.length === 1) {
			return entries[0] ?? null;
		}

		const baseUrl = this.settings.serverBaseUrl.trim();
		if (baseUrl) {
			const matches = entries.filter(
				(entry) => buildLocalVaultServerBaseUrl(entry) === baseUrl
			);
			if (matches.length === 1) {
				return matches[0] ?? null;
			}
		}

		const folderPath = this.normalizeForCompare(this.settings.imageFolderPath);
		if (folderPath) {
			const matches = entries.filter((entry) => {
				const entryPath = this.normalizeForCompare(entry.serveDir);
				return entryPath === folderPath;
			});
			if (matches.length === 1) {
				return matches[0] ?? null;
			}
		}

		return null;
	}

	private normalizeForCompare(value: string): string {
		return value.trim().replace(/\\/g, "/").replace(/\/+$/, "");
	}

	async syncFromLinkedServer(): Promise<void> {
		const api = this.getLocalVaultServerApi();
		if (!api) {
			return;
		}
		if (!this.localServerUnsubscribe) {
			this.localServerUnsubscribe = api.onSettingsChanged(() => {
				void this.syncFromLinkedServer();
			});
		}

		const entries = api.getServerEntries();
		const entry = findLocalVaultServerEntry(entries, this.settings.linkedServerEntryId);
		if (!entry) {
			return;
		}

		const nextBaseUrl = buildLocalVaultServerBaseUrl(entry);
		const resolvedFolder = resolveVaultFolderPath(this.app, entry.serveDir);
		const nextFolder =
			resolvedFolder.errorMessage.length > 0 ? entry.serveDir : resolvedFolder.folderPath;
		const nextAuthToken = entry.authToken ?? "";

		let changed = false;
		// Only persist when values truly change to avoid extra writes.
		if (this.settings.serverBaseUrl !== nextBaseUrl) {
			this.settings.serverBaseUrl = nextBaseUrl;
			changed = true;
		}
		if (this.settings.imageFolderPath !== nextFolder) {
			this.settings.imageFolderPath = nextFolder;
			changed = true;
		}
		if (this.settings.authToken !== nextAuthToken) {
			this.settings.authToken = nextAuthToken;
			changed = true;
		}

		if (changed) {
			await this.saveSettings();
			this.applySelectedBackground();
		}
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
