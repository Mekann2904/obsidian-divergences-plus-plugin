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

	async onload(): Promise<void> {
		await this.loadSettings();
		this.applySelectedBackground();

		this.addCommand({
			id: "open-background-picker",
			name: "Open background picker",
			callback: () => this.openBackgroundPicker(),
		});

		this.addSettingTab(new MyPluginSettingTab(this.app, this));
	}

	openBackgroundPicker(): void {
		if (!this.backgroundPicker) {
			this.backgroundPicker = new BackgroundPickerOverlay(this.app, this);
		}
		this.backgroundPicker.open();
	}

	onunload(): void {
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
}
