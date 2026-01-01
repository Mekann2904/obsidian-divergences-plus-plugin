/* src/settings.ts
 * Settings model and settings tab for the background picker.
 * Why: keeps user configuration in one place with simple UI controls.
 * Related: src/main.ts, src/ui/background-picker-overlay.ts, src/utils/image-utils.ts */
import {App, PluginSettingTab, Setting} from "obsidian";
import type DivergencesPlusPlugin from "./main";

export interface MyPluginSettings {
	serverBaseUrl: string;
	imageFolderPath: string;
	useRemoteIndex: boolean;
	cssVariableName: string;
	selectedImagePath: string;
}

export const DEFAULT_SETTINGS: MyPluginSettings = {
	serverBaseUrl: "http://127.0.0.1:3000",
	imageFolderPath: "",
	useRemoteIndex: false,
	cssVariableName: "--anp-background-image-dark",
	selectedImagePath: "",
};

export class MyPluginSettingTab extends PluginSettingTab {
	plugin: DivergencesPlusPlugin;

	constructor(app: App, plugin: DivergencesPlusPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const {containerEl} = this;

		containerEl.empty();
		containerEl.createEl("h2", {text: "Background picker"});

		new Setting(containerEl)
			.setName("Base URL")
			.setDesc(
				"HTTP directory index URL (required for HTTP mode; optional for vault mode)."
			)
			.addText((text) =>
				text
					.setPlaceholder("http://127.0.0.1:3000")
					.setValue(this.plugin.settings.serverBaseUrl)
					.onChange(async (value) => {
						this.plugin.settings.serverBaseUrl = value.trim();
						await this.plugin.saveSettings();
						this.plugin.applySelectedBackground();
					})
			);

		new Setting(containerEl)
			.setName("Image folder path")
			.setDesc("Vault path or absolute path (desktop). Use the same folder as the HTTP server.")
			.addText((text) =>
				text
					.setPlaceholder("wallpapers")
					.setValue(this.plugin.settings.imageFolderPath)
					.onChange(async (value) => {
						this.plugin.settings.imageFolderPath = value.trim();
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Use HTTP directory listing")
			.setDesc("When enabled, the picker reads images from the Base URL.")
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.useRemoteIndex).onChange(async (value) => {
					this.plugin.settings.useRemoteIndex = value;
					await this.plugin.saveSettings();
				})
			);

		new Setting(containerEl)
			.setName("CSS variable")
			.setDesc("CSS variable to update with the selected image URL.")
			.addText((text) =>
				text
					.setPlaceholder("--anp-background-image-dark")
					.setValue(this.plugin.settings.cssVariableName)
					.onChange(async (value) => {
						this.plugin.settings.cssVariableName = value.trim();
						await this.plugin.saveSettings();
						this.plugin.applySelectedBackground();
					})
			);

		new Setting(containerEl)
			.setName("Open picker")
			.setDesc("Open the tile view and choose a background image.")
			.addButton((button) =>
				button.setButtonText("Open").onClick(() => {
					this.plugin.openBackgroundPicker();
				})
			);

		new Setting(containerEl)
			.setName("Clear selection")
			.setDesc("Remove the selected background image.")
			.addButton((button) =>
				button.setButtonText("Clear").onClick(async () => {
					await this.plugin.clearBackgroundSelection();
				})
			);
	}
}
