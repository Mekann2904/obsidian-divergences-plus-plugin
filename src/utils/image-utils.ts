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

export interface RemoteIndexItem {
	relativePath: string;
	name: string;
	size: number;
	mtime: number;
}

export interface RemoteIndexResult {
	items: RemoteIndexItem[];
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
	"avif",
	"tif",
	"tiff",
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

	const resolvedFolder = resolveVaultFolderPath(app, rawFolderPath);
	if (resolvedFolder.errorMessage) {
		return {items: [], errorMessage: resolvedFolder.errorMessage};
	}

	const trimmedFolderPath = normalizePath(resolvedFolder.folderPath);

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

export async function getRemoteImageItems(
	baseUrl: string,
	authToken = ""
): Promise<ImageItemsResult> {
	const trimmedBaseUrl = baseUrl.trim();
	if (!trimmedBaseUrl) {
		return {items: [], errorMessage: "Base URL is empty."};
	}

	try {
		const headers = authToken ? {Authorization: `Bearer ${authToken}`} : undefined;
		const response = await requestUrl({url: trimmedBaseUrl, method: "GET", headers});
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

export async function getRemoteIndexItems(
	baseUrl: string,
	options: {authToken?: string; path?: string; recursive?: boolean; extensions?: string[]} = {}
): Promise<RemoteIndexResult> {
	const trimmedBaseUrl = baseUrl.trim();
	if (!trimmedBaseUrl) {
		return {items: [], errorMessage: "Base URL is empty."};
	}

	const query = new URLSearchParams();
	// JSON index is a fast path provided by Local Vault Server.
	const extensions =
		options.extensions && options.extensions.length > 0
			? options.extensions
			: Array.from(IMAGE_EXTENSIONS);
	query.set("ext", extensions.join(","));
	if (options.path) {
		query.set("path", options.path);
	}
	if (options.recursive === false) {
		query.set("recursive", "0");
	}

	const url = `${trimmedBaseUrl.replace(/\/+$/, "")}/__index.json?${query.toString()}`;
	const headers = options.authToken ? {Authorization: `Bearer ${options.authToken}`} : undefined;

	try {
		const response = await requestUrl({url, method: "GET", headers});
		if (response.status < 200 || response.status >= 300) {
			return {
				items: [],
				errorMessage: `HTTP error: ${response.status}`,
			};
		}

		const data = JSON.parse(response.text) as {items?: RemoteIndexItem[]};
		const items = Array.isArray(data?.items) ? data.items : [];
		return {items, errorMessage: ""};
	} catch {
		return {
			items: [],
			errorMessage: "Failed to fetch the JSON index.",
		};
	}
}

export function buildImageItemsFromRelativePaths(
	app: App,
	folderPath: string,
	relativePaths: string[],
	baseUrl = ""
): ImageItemsResult {
	const trimmedBaseUrl = baseUrl.trim();
	const rawFolderPath = folderPath.trim();
	const resolvedFolder = resolveVaultFolderPath(app, rawFolderPath);
	const useVault = !resolvedFolder.errorMessage;

	if (!useVault && !trimmedBaseUrl) {
		return {items: [], errorMessage: resolvedFolder.errorMessage};
	}

	const normalizedFolder = useVault ? normalizePath(resolvedFolder.folderPath) : "";
	const items = relativePaths
		.map((relativePath) => {
			const normalizedRelative = relativePath.trim().replace(/^\/+/, "");
			let file: TFile | null = null;
			let url = "";
			if (useVault && normalizedFolder) {
				const fullPath = normalizePath(`${normalizedFolder}/${normalizedRelative}`);
				const vaultFile = app.vault.getAbstractFileByPath(fullPath);
				if (vaultFile instanceof TFile) {
					file = vaultFile;
					url = app.vault.getResourcePath(vaultFile);
				}
			}
			if (!url && trimmedBaseUrl) {
				url = buildUrlFromRelative(trimmedBaseUrl, normalizedRelative);
			}
			if (!url) {
				return null;
			}
			return {
				file,
				relativePath: normalizedRelative,
				url,
				displayName: file?.basename ?? getFilenameFromPath(normalizedRelative),
			};
		})
		.filter((item): item is ImageItem => Boolean(item))
		.sort((a, b) => a.displayName.localeCompare(b.displayName));

	return {items, errorMessage: ""};
}

export function buildUrlFromRelative(baseUrl: string, relativePath: string): string {
	const trimmedBaseUrl = baseUrl.trim().replace(/\/+$/, "");
	const trimmedRelativePath = relativePath.trim().replace(/^\/+/, "");
	if (!trimmedBaseUrl || !trimmedRelativePath) {
		return "";
	}
	return `${trimmedBaseUrl}/${encodePath(trimmedRelativePath)}`;
}

export function resolveVaultFolderPath(
	app: App,
	folderPath: string
): {folderPath: string; errorMessage: string} {
	const rawInput = folderPath.trim();
	if (!rawInput) {
		return {folderPath: "", errorMessage: "Image folder path is empty."};
	}

	const isAbsolute = isAbsolutePath(rawInput);
	const normalizedInput = isAbsolute
		? normalizeAbsolutePath(rawInput)
		: normalizePath(rawInput);

	if (!isAbsolute) {
		return {folderPath: normalizedInput, errorMessage: ""};
	}

	const basePath = getVaultBasePath(app);
	if (!basePath) {
		return {
			folderPath: "",
			errorMessage: "Absolute paths require a desktop vault.",
		};
	}

	const normalizedBase = normalizeAbsolutePath(basePath);
	const baseWithSlash = normalizedBase.endsWith("/")
		? normalizedBase
		: `${normalizedBase}/`;
	if (normalizedInput !== normalizedBase && !normalizedInput.startsWith(baseWithSlash)) {
		return {
			folderPath: "",
			errorMessage: "Folder must be inside the vault.",
		};
	}

	const relative = normalizedInput.slice(normalizedBase.length).replace(/^\/+/, "");
	if (!relative) {
		return {
			folderPath: "",
			errorMessage: "Image folder path resolves to the vault root.",
		};
	}

	// Convert absolute paths to vault-relative paths for Obsidian APIs.
	return {folderPath: relative, errorMessage: ""};
}

function getVaultBasePath(app: App): string {
	const adapter = app.vault.adapter as unknown as {getBasePath?: () => string};
	if (typeof adapter.getBasePath === "function") {
		return adapter.getBasePath();
	}
	return "";
}

function isAbsolutePath(value: string): boolean {
	return value.startsWith("/") || /^[A-Za-z]:\//.test(value);
}

function normalizeAbsolutePath(value: string): string {
	const normalized = normalizePath(value).replace(/^\/+/, "");
	if (value.startsWith("/")) {
		return `/${normalized}`;
	}
	return normalized;
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

function getFilenameFromPath(pathValue: string): string {
	const segments = pathValue.split("/").filter(Boolean);
	return segments.length > 0 ? segments[segments.length - 1] ?? "" : pathValue;
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
