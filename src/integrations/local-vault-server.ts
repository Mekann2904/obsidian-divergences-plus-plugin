/* src/integrations/local-vault-server.ts
 * Local Vault Server plugin bridge helpers.
 * Why: sync settings safely and read server entries without tight coupling.
 * Related: src/main.ts, src/settings.ts, src/utils/image-utils.ts, ../obsidian-local-vault-server-plugin/main.ts */
import {App} from "obsidian";

export const LOCAL_VAULT_SERVER_PLUGIN_ID = "LocalVaultServer-plugin";
export const LOCAL_VAULT_SERVER_API_VERSION = 1;

export interface LocalVaultServerEntry {
	id: string;
	name: string;
	host: string;
	port: number;
	serveDir: string;
	enableHttps: boolean;
	authToken: string;
	enableWhitelist: boolean;
	whitelistFiles: string[];
}

export interface LocalVaultServerRunningInfo {
	id: string;
	status: "running" | "error" | "stopped";
	baseUrl: string;
	host: string;
	port: number;
	serveDir: string;
	authToken: string;
	enableHttps: boolean;
}

export interface LocalVaultServerApi {
	apiVersion: number;
	getServerEntries: () => LocalVaultServerEntry[];
	getRunningServers: () => LocalVaultServerRunningInfo[];
	onSettingsChanged: (handler: (settings: unknown) => void) => () => void;
}

export function getLocalVaultServerApi(app: App): LocalVaultServerApi | null {
	const plugins = (app as App & {plugins?: {getPlugin: (id: string) => unknown}}).plugins;
	if (!plugins) {
		return null;
	}
	const plugin = plugins.getPlugin(LOCAL_VAULT_SERVER_PLUGIN_ID) as
		| {getApi?: () => LocalVaultServerApi}
		| undefined;
	if (!plugin?.getApi) {
		return null;
	}
	const api = plugin.getApi();
	if (!api || api.apiVersion !== LOCAL_VAULT_SERVER_API_VERSION) {
		return null;
	}
	return api;
}

export function buildLocalVaultServerBaseUrl(entry: LocalVaultServerEntry): string {
	const protocol = entry.enableHttps ? "https" : "http";
	const host = entry.host === "0.0.0.0" ? "127.0.0.1" : entry.host;
	return `${protocol}://${host}:${entry.port}`;
}

export function findLocalVaultServerEntry(
	entries: LocalVaultServerEntry[],
	entryId: string
): LocalVaultServerEntry | null {
	if (!entryId) {
		return null;
	}
	return entries.find((entry) => entry.id === entryId) ?? null;
}
