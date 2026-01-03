/* src/settings.ts
 * Settings model and settings tab for the background picker.
 * Why: keeps user configuration in one place with simple UI controls.
 * Related: src/main.ts, src/ui/background-picker-overlay.ts, src/utils/image-utils.ts */
import {App, PluginSettingTab, Setting} from "obsidian";
import type DivergencesPlusPlugin from "./main";
import {
	formatHexColor,
	formatRgbaColor,
	hsvToRgb,
	parseRgbaColor,
	RgbaColor,
	rgbToHsv,
} from "./utils/color-utils";

export interface MyPluginSettings {
	serverBaseUrl: string;
	imageFolderPath: string;
	useRemoteIndex: boolean;
	authToken: string;
	cssVariableName: string;
	selectedImagePath: string;
	linkedServerEntryId: string;
	themeDarkBase00: string;
	themeDarkBase10: string;
}

export const DEFAULT_SETTINGS: MyPluginSettings = {
	serverBaseUrl: "http://127.0.0.1:3000",
	imageFolderPath: "",
	useRemoteIndex: false,
	authToken: "",
	cssVariableName: "--anp-background-image-dark",
	selectedImagePath: "",
	linkedServerEntryId: "",
	themeDarkBase00: "rgba(17, 15, 32, 0.79)",
	themeDarkBase10: "rgba(17, 15, 32, 0.79)",
};

interface RgbaSettingOptions {
	name: string;
	description: string;
	value: string;
	fallback: string;
	onChange: (value: string) => Promise<void>;
}

// Reusable RGBA picker for the settings UI.
function addRgbaSetting(containerEl: HTMLElement, options: RgbaSettingOptions): void {
	const setting = new Setting(containerEl)
		.setName(options.name)
		.setDesc(options.description);
	setting.settingEl.addClass("anp-color-setting");
	const control = setting.controlEl.createDiv({cls: "anp-color-control"});
	const picker = control.createDiv({cls: "anp-color-picker"});
	const sv = picker.createDiv({cls: "anp-color-sv"});
	const svHandle = sv.createDiv({cls: "anp-color-sv-handle"});
	const sliders = picker.createDiv({cls: "anp-color-sliders"});
	const hueInput = sliders.createEl("input", {
		type: "range",
		cls: "anp-color-slider anp-color-hue",
		attr: {min: "0", max: "360", step: "1"},
	});
	const alphaInput = sliders.createEl("input", {
		type: "range",
		cls: "anp-color-slider anp-color-alpha",
		attr: {min: "0", max: "100", step: "1"},
	});

	const fields = control.createDiv({cls: "anp-color-fields"});
	const rField = createChannelField(fields, "R", 0, 255, 1);
	const gField = createChannelField(fields, "G", 0, 255, 1);
	const bField = createChannelField(fields, "B", 0, 255, 1);
	const aField = createChannelField(fields, "A", 0, 1, 0.01);

	const actions = control.createDiv({cls: "anp-color-actions"});
	const preview = actions.createDiv({cls: "anp-color-preview"});
	const resetButton = actions.createEl("button", {cls: "anp-color-reset", text: "Reset"});
	resetButton.type = "button";

	let current = resolveRgbaValue(options.value, options.fallback);
	let hsv = rgbToHsv(current);
	let svDragging = false;

	const syncUi = (): void => {
		// Keep every control in sync so typing and dragging feel consistent.
		const formatted = formatRgbaColor(current);
		const previewHex = formatHexColor(current);
		const hueValue = Math.round(hsv.h);
		const alphaPercent = Math.round(current.a * 100);

		sv.style.setProperty("--anp-color-hue", `${hueValue}`);
		svHandle.style.left = `${hsv.s * 100}%`;
		svHandle.style.top = `${(1 - hsv.v) * 100}%`;

		hueInput.value = String(hueValue);
		alphaInput.value = String(alphaPercent);
		alphaInput.style.background = `linear-gradient(to right, rgba(${current.r}, ${current.g}, ${current.b}, 0), rgba(${current.r}, ${current.g}, ${current.b}, 1))`;

		rField.input.value = String(current.r);
		gField.input.value = String(current.g);
		bField.input.value = String(current.b);
		aField.input.value = formatAlphaInput(current.a);

		preview.style.background = formatted;
		preview.dataset.color = previewHex;
	};

	const persist = (): void => {
		void options.onChange(formatRgbaColor(current));
	};

	const updateFromRgba = (next: RgbaColor, shouldPersist: boolean): void => {
		// RGB edits need HSV recalculation to keep the square aligned.
		current = next;
		hsv = rgbToHsv(current);
		syncUi();
		if (shouldPersist) {
			persist();
		}
	};

	const updateFromHsv = (
		next: {h: number; s: number; v: number; a?: number},
		shouldPersist: boolean
	): void => {
		// HSV edits are the most common (dragging the square + sliders).
		const nextHsv = {
			h: next.h,
			s: next.s,
			v: next.v,
			a: next.a ?? current.a,
		};
		hsv = nextHsv;
		current = hsvToRgb({...nextHsv, a: nextHsv.a});
		syncUi();
		if (shouldPersist) {
			persist();
		}
	};

	const updateFromChannels = (shouldPersist: boolean): void => {
		// Numeric channels allow precise RGBA entry.
		const r = readNumber(rField.input.value, current.r);
		const g = readNumber(gField.input.value, current.g);
		const b = readNumber(bField.input.value, current.b);
		const a = readNumber(aField.input.value, current.a);
		updateFromRgba(
			{
				r: clampChannel(r, 0, 255),
				g: clampChannel(g, 0, 255),
				b: clampChannel(b, 0, 255),
				a: clampChannel(a, 0, 1),
			},
			shouldPersist
		);
	};

	const handleSvPointer = (event: PointerEvent, shouldPersist: boolean): void => {
		// Convert pointer position to saturation/value in the square.
		const rect = sv.getBoundingClientRect();
		if (rect.width <= 0 || rect.height <= 0) {
			return;
		}
		const x = clampChannel((event.clientX - rect.left) / rect.width, 0, 1);
		const y = clampChannel((event.clientY - rect.top) / rect.height, 0, 1);
		updateFromHsv({h: hsv.h, s: x, v: 1 - y}, shouldPersist);
	};

	syncUi();

	sv.addEventListener("pointerdown", (event) => {
		event.preventDefault();
		svDragging = true;
		sv.setPointerCapture(event.pointerId);
		handleSvPointer(event, false);
	});
	sv.addEventListener("pointermove", (event) => {
		if (!svDragging) {
			return;
		}
		handleSvPointer(event, false);
	});
	sv.addEventListener("pointerup", (event) => {
		if (!svDragging) {
			return;
		}
		svDragging = false;
		sv.releasePointerCapture(event.pointerId);
		handleSvPointer(event, true);
	});
	sv.addEventListener("pointercancel", (event) => {
		if (!svDragging) {
			return;
		}
		svDragging = false;
		sv.releasePointerCapture(event.pointerId);
		handleSvPointer(event, true);
	});

	hueInput.addEventListener("input", () => {
		const hue = readNumber(hueInput.value, hsv.h);
		updateFromHsv({h: hue, s: hsv.s, v: hsv.v}, false);
	});
	hueInput.addEventListener("change", () => {
		const hue = readNumber(hueInput.value, hsv.h);
		updateFromHsv({h: hue, s: hsv.s, v: hsv.v}, true);
	});

	alphaInput.addEventListener("input", () => {
		const alpha = readNumber(alphaInput.value, current.a * 100) / 100;
		updateFromHsv({h: hsv.h, s: hsv.s, v: hsv.v, a: alpha}, false);
	});
	alphaInput.addEventListener("change", () => {
		const alpha = readNumber(alphaInput.value, current.a * 100) / 100;
		updateFromHsv({h: hsv.h, s: hsv.s, v: hsv.v, a: alpha}, true);
	});

	rField.input.addEventListener("input", () => updateFromChannels(false));
	gField.input.addEventListener("input", () => updateFromChannels(false));
	bField.input.addEventListener("input", () => updateFromChannels(false));
	aField.input.addEventListener("input", () => updateFromChannels(false));

	rField.input.addEventListener("change", () => updateFromChannels(true));
	gField.input.addEventListener("change", () => updateFromChannels(true));
	bField.input.addEventListener("change", () => updateFromChannels(true));
	aField.input.addEventListener("change", () => updateFromChannels(true));

	resetButton.addEventListener("click", () => {
		// Always allow returning to the default color.
		const fallback = resolveRgbaValue(options.fallback, options.fallback);
		updateFromRgba(fallback, true);
	});
}

function resolveRgbaValue(value: string, fallback: string): RgbaColor {
	return (
		parseRgbaColor(value) ??
		parseRgbaColor(fallback) ?? {r: 0, g: 0, b: 0, a: 1}
	);
}

function createChannelField(
	parent: HTMLElement,
	label: string,
	min: number,
	max: number,
	step: number
): {input: HTMLInputElement; label: HTMLSpanElement} {
	const field = parent.createDiv({cls: "anp-color-field"});
	const input = field.createEl("input", {
		type: "number",
		cls: "anp-color-number",
		attr: {min: String(min), max: String(max), step: String(step)},
	});
	const fieldLabel = field.createEl("span", {cls: "anp-color-label", text: label});
	return {input, label: fieldLabel};
}

function readNumber(value: string, fallback: number): number {
	const parsed = Number.parseFloat(value);
	return Number.isFinite(parsed) ? parsed : fallback;
}

function clampChannel(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}

function formatAlphaInput(value: number): string {
	return String(Math.round(clampChannel(value, 0, 1) * 100) / 100);
}

export class MyPluginSettingTab extends PluginSettingTab {
	plugin: DivergencesPlusPlugin;

	constructor(app: App, plugin: DivergencesPlusPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const {containerEl} = this;
		const localServerApi = this.plugin.getLocalVaultServerApi();
		const localServerEntries = localServerApi?.getServerEntries() ?? [];
		const isLinked = this.plugin.isLinkedToLocalServer();

		containerEl.empty();
		containerEl.createEl("h2", {text: "Background picker"});

		containerEl.createEl("h3", {text: "Local Vault Server link"});

		if (!localServerApi) {
			containerEl.createEl("p", {
				text: "Local Vault Server plugin is not available. Install and enable it to sync settings.",
				cls: "setting-item-description",
			});
		} else if (localServerEntries.length === 0) {
			containerEl.createEl("p", {
				text: "No server entries found. Add one in Local Vault Server settings.",
				cls: "setting-item-description",
			});
		}

		new Setting(containerEl)
			.setName("Linked server entry")
			.setDesc("Sync Base URL, folder path, and auth token from Local Vault Server.")
			.addDropdown((dropdown) => {
				dropdown.addOption("", "Not linked");
				for (const entry of localServerEntries) {
					dropdown.addOption(entry.id, entry.name || entry.id);
				}
				dropdown.setValue(this.plugin.settings.linkedServerEntryId);
				dropdown.onChange(async (value) => {
					this.plugin.settings.linkedServerEntryId = value;
					await this.plugin.saveSettings();
					await this.plugin.syncFromLinkedServer();
					this.display();
				});
			});

		containerEl.createEl("h3", {text: "Image source"});

		new Setting(containerEl)
			.setName("Base URL")
			.setDesc(
				"HTTP directory index URL (required for HTTP mode; optional for vault mode)."
			)
			.addText((text) =>
				text
					.setPlaceholder("http://127.0.0.1:3000")
					.setValue(this.plugin.settings.serverBaseUrl)
					.setDisabled(isLinked)
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
					.setDisabled(isLinked)
					.onChange(async (value) => {
						this.plugin.settings.imageFolderPath = value.trim();
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Use HTTP directory listing")
			.setDesc("When enabled, the picker reads images from the Base URL (JSON index if available).")
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.useRemoteIndex).onChange(async (value) => {
					this.plugin.settings.useRemoteIndex = value;
					await this.plugin.saveSettings();
				})
			);

		new Setting(containerEl)
			.setName("Auth token")
			.setDesc("Bearer token for the Local Vault Server (optional).")
			.addText((text) => {
				text
					.setPlaceholder("Optional token")
					.setValue(this.plugin.settings.authToken)
					.setDisabled(isLinked)
					.onChange(async (value) => {
						this.plugin.settings.authToken = value.trim();
						await this.plugin.saveSettings();
					});
				text.inputEl.type = "password";
			});

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

		containerEl.createEl("h3", {text: "Theme colors (dark)"});

		addRgbaSetting(containerEl, {
			name: "Base 00",
			description: "Controls --my-color-base-00. Enter RGBA or hex with alpha.",
			value: this.plugin.settings.themeDarkBase00,
			fallback: DEFAULT_SETTINGS.themeDarkBase00,
			onChange: async (value) => {
				this.plugin.settings.themeDarkBase00 = value;
				await this.plugin.saveSettings();
				this.plugin.applyThemeColors();
			},
		});

		addRgbaSetting(containerEl, {
			name: "Base 10",
			description: "Controls --my-color-base-10. Enter RGBA or hex with alpha.",
			value: this.plugin.settings.themeDarkBase10,
			fallback: DEFAULT_SETTINGS.themeDarkBase10,
			onChange: async (value) => {
				this.plugin.settings.themeDarkBase10 = value;
				await this.plugin.saveSettings();
				this.plugin.applyThemeColors();
			},
		});

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
