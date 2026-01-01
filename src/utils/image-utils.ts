/* src/utils/image-utils.ts
 * Helpers for collecting image files and building URLs.
 * Why: isolates vault traversal and URL building from UI code.
 * Related: src/ui/background-picker-overlay.ts, src/main.ts, src/settings.ts */
import {App, normalizePath, requestUrl, TFile, TFolder} from "obsidian";

export interface ImageItem {
	file: TFile | null;
	relativePath: string;
	url: string;
	displayName: string;
}

export interface ImageItemsResult {
	items: ImageItem[];
	errorMessage: string;
}

const IMAGE_EXTENSIONS = new Set([
	"png",
	"jpg",
	"jpeg",
	"webp",
	"gif",
	"bmp",
	"svg",
]);

export function getVaultImageItems(
	app: App,
	baseUrl: string,
	folderPath: string
): ImageItemsResult {
	const trimmedBaseUrl = baseUrl.trim();
	const rawFolderPath = folderPath.trim();

	if (!rawFolderPath) {
		return {items: [], errorMessage: "Image folder path is empty."};
	}

	const trimmedFolderPath = normalizePath(rawFolderPath);

	const folder = app.vault.getAbstractFileByPath(trimmedFolderPath);
	if (!folder || !(folder instanceof TFolder)) {
		return {
			items: [],
			errorMessage: `Folder not found: ${trimmedFolderPath}`,
		};
	}

	const files: TFile[] = [];
	collectImageFiles(folder, files);

	const items = files
		.map((file) => {
			const relativePath = getRelativePath(trimmedFolderPath, file.path);
			const url = trimmedBaseUrl
				? buildUrlFromRelative(trimmedBaseUrl, relativePath)
				: app.vault.getResourcePath(file);
			return {
				file,
				relativePath,
				url,
				displayName: file.basename,
			};
		})
		.filter((item) => item.url.length > 0)
		.sort((a, b) => a.displayName.localeCompare(b.displayName));

	return {items, errorMessage: ""};
}

export async function getRemoteImageItems(baseUrl: string): Promise<ImageItemsResult> {
	const trimmedBaseUrl = baseUrl.trim();
	if (!trimmedBaseUrl) {
		return {items: [], errorMessage: "Base URL is empty."};
	}

	try {
		const response = await requestUrl({url: trimmedBaseUrl, method: "GET"});
		if (response.status < 200 || response.status >= 300) {
			return {
				items: [],
				errorMessage: `HTTP error: ${response.status}`,
			};
		}

		const html = response.text;
		const doc = new DOMParser().parseFromString(html, "text/html");
		const links = Array.from(doc.querySelectorAll<HTMLAnchorElement>("a[href]"));
		const items: ImageItem[] = [];
		const baseUrlNormalized = normalizeUrlForRelative(trimmedBaseUrl);

		for (const link of links) {
			const href = link.getAttribute("href");
			if (!href || href === "../" || href.startsWith("?") || href.startsWith("#")) {
				continue;
			}
			const url = buildAbsoluteUrl(baseUrlNormalized, href);
			if (!url) {
				continue;
			}
			const filename = getFilenameFromUrl(url);
			if (!filename || !isImageExtension(filename)) {
				continue;
			}
			const relativePath = decodePathSegments(
				getRelativePathFromUrl(baseUrlNormalized, url)
			);
			items.push({
				file: null,
				relativePath,
				url,
				displayName: decodeURIComponentSafe(filename),
			});
		}

		items.sort((a, b) => a.displayName.localeCompare(b.displayName));
		return {items, errorMessage: ""};
	} catch {
		return {
			items: [],
			errorMessage: "Failed to fetch the directory listing.",
		};
	}
}

export function buildUrlFromRelative(baseUrl: string, relativePath: string): string {
	const trimmedBaseUrl = baseUrl.trim().replace(/\/+$/, "");
	const trimmedRelativePath = relativePath.trim().replace(/^\/+/, "");
	if (!trimmedBaseUrl || !trimmedRelativePath) {
		return "";
	}
	return `${trimmedBaseUrl}/${encodePath(trimmedRelativePath)}`;
}

function collectImageFiles(folder: TFolder, output: TFile[]): void {
	for (const child of folder.children) {
		if (child instanceof TFolder) {
			collectImageFiles(child, output);
			continue;
		}
		if (child instanceof TFile && isImageFile(child)) {
			output.push(child);
		}
	}
}

function isImageFile(file: TFile): boolean {
	return IMAGE_EXTENSIONS.has(file.extension.toLowerCase());
}

function isImageExtension(filename: string): boolean {
	const ext = filename.split(".").pop();
	if (!ext) {
		return false;
	}
	return IMAGE_EXTENSIONS.has(ext.toLowerCase());
}

function getRelativePath(folderPath: string, filePath: string): string {
	const normalizedFolderPath = normalizePath(folderPath);
	const prefix = normalizedFolderPath.endsWith("/")
		? normalizedFolderPath
		: `${normalizedFolderPath}/`;
	// Keep relative paths so the base URL can be swapped without changing selection.
	if (filePath.startsWith(prefix)) {
		return filePath.slice(prefix.length);
	}
	return filePath;
}

function encodePath(path: string): string {
	return path
		.split("/")
		.map((segment) => encodeURIComponent(decodeURIComponentSafe(segment)))
		.join("/");
}

function normalizeUrlForRelative(url: string): string {
	try {
		const parsed = new URL(url);
		if (!parsed.pathname.endsWith("/")) {
			parsed.pathname = `${parsed.pathname}/`;
		}
		return parsed.toString();
	} catch {
		return url.endsWith("/") ? url : `${url}/`;
	}
}

function buildAbsoluteUrl(baseUrl: string, href: string): string {
	try {
		return new URL(href, baseUrl).toString();
	} catch {
		return "";
	}
}

function getFilenameFromUrl(url: string): string {
	try {
		const parsed = new URL(url);
		const segments = parsed.pathname.split("/").filter(Boolean);
		const last = segments.length > 0 ? segments[segments.length - 1] : undefined;
		return last ?? "";
	} catch {
		return "";
	}
}

function getRelativePathFromUrl(baseUrl: string, url: string): string {
	try {
		const base = new URL(baseUrl);
		const target = new URL(url);
		const basePath = base.pathname.endsWith("/") ? base.pathname : `${base.pathname}/`;
		if (target.pathname.startsWith(basePath)) {
			return target.pathname.slice(basePath.length);
		}
		return target.pathname.replace(/^\//, "");
	} catch {
		return url;
	}
}

function decodeURIComponentSafe(value: string): string {
	try {
		return decodeURIComponent(value);
	} catch {
		return value;
	}
}

function decodePathSegments(path: string): string {
	return path
		.split("/")
		.map((segment) => decodeURIComponentSafe(segment))
		.join("/");
}
