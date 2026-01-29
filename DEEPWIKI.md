# DEEPWIKI - Divergences Plus Plugin

本ドキュメントはDivergences Plus Pluginの技術的な詳細、アーキテクチャ、および開発者向け情報を網羅的に説明しています。

## 目次

1. [プロジェクト概要](#プロジェクト概要)
2. [アーキテクチャ](#アーキテクチャ)
3. [モジュール詳細](#モジュール詳細)
4. [設定項目の詳細](#設定項目の詳細)
5. [Local Vault Server統合](#local-vault-server統合)
6. [画像取得フロー](#画像取得フロー)
7. [UIコンポーネント](#uiコンポーネント)
8. [パフォーマンス最適化](#パフォーマンス最適化)
9. [ビルドと開発](#ビルドと開発)
10. [拡張ポイント](#拡張ポイント)

---

## プロジェクト概要

### 目的

Divergences Plus Pluginは、Obsidianの背景画像を視覚的に選択・設定するためのプラグインです。以下の機能を提供します。

- Vault内または外部HTTPサーバーから背景画像を選択
- Local Vault Serverプラグインとの設定同期
- 複数の画像ソースからの高速な画像取得
- 認証トークンとホワイトリストによるアクセス制御
- RGBAカラーピッカーによるテーマ色調整

### スコープ

このプラグインは以下に焦点を当てています。

- 背景画像の選択と適用（CSS変数経由）
- 画像の一覧表示とインタラクティブな選択
- 外部サーバーとの連携（Local Vault Server）

以下の機能は提供しません。

- 画像の編集や変換
- スライドショー表示
- タグやフォルダによるフィルタリング（Local Vault Serverのホワイトリストを除く）

### 技術スタック

- **TypeScript**: 厳格な型チェック（strict mode）
- **Obsidian API**: Vault、Plugin、requestUrl
- **esbuild**: バンドラー（CommonJS形式）
- **ESLint**: Obsidian固有のルールセット
- **CSS**: 変数ベースのスタイリング

---

## アーキテクチャ

### モジュール依存関係

```
main.ts (プラグインエントリー)
  ├── settings.ts (設定管理)
  │   └── utils/color-utils.ts (色変換)
  ├── ui/background-picker-overlay.ts (ピッカーUI)
  │   └── utils/image-utils.ts (画像処理)
  └── integrations/local-vault-server.ts (APIブリッジ)
```

### データフロー

#### 初期化フロー

```
onload()
  ├─ loadSettings() - 設定のロード
  ├─ applyThemeColors() - テーマ色の適用
  ├─ syncFromLinkedServer() - Local Vault Server設定の同期
  ├─ applySelectedBackground() - 選択された背景の適用
  ├─ ensureBackgroundPicker() - ピッカーインスタンスの準備
  └─ scheduleCacheWarmup() - キャッシュの事前ロード
```

#### 背景適用フロー

```
applySelectedBackground()
  ├─ getSelectedImageUrl() - 画像URLの決定
  │   ├─ 優先度1: Remote URL (linked / protected / useRemoteIndex)
  │   ├─ 優先度2: Local Vault URL (getResourcePath)
  │   └─ 優先度3: Fallback Remote URL
  └─ applyBackgroundUrl() - CSS変数の更新
```

#### 画像選択フロー

```
ピッカーを開く
  ├─ loadImageItems()
  │   ├─ linkedServerEntryがある場合:
  │   │   ├─ whitelist有効 → ホワイトリストフィルタ
  │   │   ├─ Vaultスキャン成功 → Vault結果を使用
  │   │   └─ Vault失敗 → Remoteインデックスを使用
  │   └─ linkedServerEntryがない場合:
  │       ├─ useRemoteIndex有効 → Remoteインデックス優先
  │       ├─ Remote失敗 → HTMLディレクトリ一覧
  │       └─ useRemoteIndex無効 → Vaultスキャンのみ
  ├─ renderGrid() - グリッドのレンダリング
  │   └─ startTileRender() - バッチレンダリング
  └─ handleTileSelection() - 背景の適用
```

### ファイル構成と責任

| ファイル | 行数 | 責任 |
|--------|------|------|
| `src/main.ts` | 333 | プラグインライフサイクル、コマンド登録、背景適用 |
| `src/settings.ts` | 438 | 設定タブUI、RGBAピッカー実装、設定永続化 |
| `src/ui/background-picker-overlay.ts` | 827 | グリッド表示、レンダリング最適化、インタラクション |
| `src/integrations/local-vault-server.ts` | 73 | Local Vault Server APIブリッジ |
| `src/utils/image-utils.ts` | 435 | 画像収集、URL構築、HTTPリクエスト |
| `src/utils/color-utils.ts` | 240 | RGBA/HSV変換、色解析 |
| `styles.css` | 281 | UIスタイリング、グリッドレイアウト |

---

## モジュール詳細

### main.ts

#### 役割

- プラグインのエントリーポイント
- Obsidianライフサイクルの管理（`onload`、`onunload`）
- 設定のロードと永続化
- 背景画像の適用
- コマンドの登録
- Local Vault Serverとの同期管理

#### 主要メソッド

##### `onload()`

プラグインが有効化されたときに呼び出されます。

```typescript
async onload(): Promise<void> {
  await this.loadSettings();
  this.applyThemeColors();
  await this.syncFromLinkedServer();
  this.applySelectedBackground();
  this.ensureBackgroundPicker();
  this.scheduleCacheWarmup();
  this.addCommand({...});
  this.addSettingTab(new MyPluginSettingTab(this.app, this));
}
```

**実行順序:**
1. 設定のロード（ディスクから）
2. テーマ色の適用
3. Local Vault Server設定の同期
4. 背景画像の適用
5. ピッカーインスタンスの準備
6. キャッシュの事前ロード（アイドル時）
7. コマンドと設定タブの登録

##### `getSelectedImageUrl()`

選択された背景画像のURLを決定します。優先順位は以下の通りです。

1. Remote URL（linked / protected / useRemoteIndexが有効）
2. Local Vault URL（`app.vault.getResourcePath()`）
3. Fallback Remote URL

```typescript
const preferRemote = Boolean(baseUrl) && (
  this.settings.useRemoteIndex ||
  this.settings.authToken.trim().length > 0 ||
  this.settings.linkedServerEntryId.trim().length > 0
);
```

**理由:**
- `linkedServerEntryId`がある場合、サーバーを単一の情報源とする
- `authToken`がある場合、保護されたリソースへのアクセスを優先
- `useRemoteIndex`が有効な場合、HTTPインデックスを優先

##### `syncFromLinkedServer()`

Local Vault Serverの設定を同期します。設定変更時にのみディスクへの書き込みを行います。

```typescript
let changed = false;
if (this.settings.serverBaseUrl !== nextBaseUrl) {
  this.settings.serverBaseUrl = nextBaseUrl;
  changed = true;
}
if (changed) {
  await this.saveSettings();
  this.applySelectedBackground();
}
```

**最適化:**
- 変更がある場合のみ書き込み
- `onSettingsChanged`コールバックを登録してリアルタイム更新

#### 設定保存フロー

```typescript
async saveSettings(): Promise<void> {
  await this.saveData(this.settings);
}
```

`this.saveData()`はObsidian APIにより、`data.json`（またはプラグインIDに基づくファイル）へJSON形式で保存されます。

---

### settings.ts

#### 役割

- 設定インターフェースとデフォルト値の定義
- 設定タブUIのレンダリング
- RGBAカラーピッカーの実装

#### 設定インターフェース

```typescript
export interface MyPluginSettings {
  serverBaseUrl: string;           // HTTPサーバーのベースURL
  imageFolderPath: string;         // Vault内の画像フォルダパス
  useRemoteIndex: boolean;         // HTTPディレクトリ一覧を使用
  authToken: string;               // Bearer認証トークン
  cssVariableName: string;         // 更新対象CSS変数名
  selectedImagePath: string;       // 選択された画像の相対パス
  linkedServerEntryId: string;     // Local Vault ServerのエントリID
  themeDarkBase00: string;         // ダークテーマ色（背景）
  themeDarkBase10: string;         // ダークテーマ色（強調）
}
```

#### RGBAピッカー実装

`addRgbaSetting()`関数は、以下の要素を持つカラーピッカーを作成します。

- SV（彩度・明度）正方形のドラッグ操作
- Hue（色相）スライダー
- Alpha（透明度）スライダー
- RGBA数値フィールド
- プレビューとリセットボタン

**色変換フロー:**

```
ユーザー入力 (HSV/RGBA)
  ├─ HSV → RGB (hsvToRgb)
  ├─ RGB → HSV (rgbToHsv)
  └─ RGBA → CSS文字列 (formatRgbaColor)
```

**RGB/HSV変換:**

- `rgbToHsv()`: RGBをHSVに変換（0-360, 0-1, 0-1）
- `hsvToRgb()`: HSVをRGBに変換（0-255, 0-255, 0-255）

**色の正規化:**

```typescript
export function normalizeRgbaString(value: string, fallback: string): string {
  const parsed = parseRgbaColor(value) ?? parseRgbaColor(fallback);
  return formatRgbaColor(parsed);
}
```

- 不正な値はフォールバック値に置き換え
- RGBA関数形式またはHex形式を解析

---

### ui/background-picker-overlay.ts

#### 役割

- 画像グリッドのオーバーレイ表示
- 画像の一括レンダリング
- インタラクティブな画像選択
- キャッシュ管理

#### 主要クラス

##### `BackgroundPickerOverlay`

**状態管理:**

```typescript
private overlayEl: HTMLDivElement | null = null;
private gridEl: HTMLDivElement | null = null;
private selectedPath = "";
private cachedKey: string | null = null;
private cachedItems: ImageItem[] = [];
```

**レンダリングトークン:**

```typescript
private renderToken = 0;
```

- 再レンダリング時にインクリメント
- 古いレンダリング操作をキャンセル
- レースコンディションの防止

#### レンダリング最適化

##### `startTileRender()`

`requestIdleCallback()`または`setTimeout()`を使用して、画像タイルをバッチでレンダリングします。

```typescript
const batchSize = 24;
while (rendered < batchSize && this.renderQueue.index < items.length) {
  fragment.appendChild(this.createTile(item, this.renderQueue.index - 1));
  rendered += 1;
}
this.gridEl.appendChild(fragment);
```

**理由:**
- メインスレッドのブロックを回避
- 多くの画像が存在する場合でもUIを応答性を維持
- フォアグラウンドで優先的に最初の数枚をレンダリング

##### `ensureResizeObserver()`

グリッドのサイズ変更を監視し、動的にレイアウトを調整します。

```typescript
this.resizeObserver = new ResizeObserver(() => {
  this.requestGridUpdate();
});
```

#### キャッシュ戦略

##### `primeCache()`

ピッカーが開かれる前に、Vault画像のキャッシュを作成します。

```typescript
void this.app.workspace.onLayoutReady(() => {
  this.scheduleCacheWarmup();
});
```

- `requestIdleCallback()`を使用して、初期レンダリング後に実行
- Remoteモードの場合はキャッシュしない（サーバーが情報源）

##### `getCacheKey()`

設定の組み合わせに基づいてキャッシュキーを生成します。

```typescript
const preferRemote = this.shouldPreferRemoteSource();
const mode = preferRemote ? "remote" : "vault";
const baseUrl = preferRemote ? this.host.settings.serverBaseUrl.trim() : "";
const authToken = preferRemote ? this.host.settings.authToken?.trim() ?? "" : "";
const folder = this.host.settings.imageFolderPath.trim();
const whitelistKey = this.getWhitelistCacheKey();
return `${mode}|${baseUrl}|${folder}|${authToken}|${whitelistKey}`;
```

**キャッシュ無効化条件:**
- モードの切り替え（remote/vault）
- 設定の変更
- ファイルの削除・移動（`isVaultCacheValid()`で検証）

---

### integrations/local-vault-server.ts

#### 役割

- Local Vault ServerプラグインのAPIへのブリッジ
- 設定の型定義
- バージョン互換性の検証

#### APIインターフェース

```typescript
export interface LocalVaultServerApi {
  apiVersion: number;
  getServerEntries: () => LocalVaultServerEntry[];
  getRunningServers: () => LocalVaultServerRunningInfo[];
  onSettingsChanged: (handler: (settings: unknown) => void) => () => void;
}
```

#### バージョン管理

```typescript
export const LOCAL_VAULT_SERVER_API_VERSION = 1;

export function getLocalVaultServerApi(app: App): LocalVaultServerApi | null {
  const api = plugin.getApi();
  if (!api || api.apiVersion !== LOCAL_VAULT_SERVER_API_VERSION) {
    return null;
  }
  return api;
}
```

**理由:**
- APIの変更時に互換性を検証
- 不一致の場合は無条件にnullを返す（安全なフォールバック）

#### エントリ検索

```typescript
export function findLocalVaultServerEntry(
  entries: LocalVaultServerEntry[],
  entryId: string
): LocalVaultServerEntry | null {
  if (!entryId) return null;
  return entries.find((entry) => entry.id === entryId) ?? null;
}
```

---

### utils/image-utils.ts

#### 役割

- Vaultからの画像ファイル収集
- HTTP経由の画像一覧取得
- URLの構築と正規化

#### 主要関数

##### `getVaultImageItems()`

Vault内の画像ファイルを再帰的に収集します。

```typescript
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
```

**サポートされる拡張子:**

```typescript
const IMAGE_EXTENSIONS = new Set([
  "png", "jpg", "jpeg", "webp", "gif", "bmp",
  "svg", "avif", "tif", "tiff",
]);
```

##### `getRemoteImageItems()`

HTTPディレクトリ一覧をパースして画像リストを作成します。

```typescript
const response = await requestUrl({url: trimmedBaseUrl, method: "GET", headers});
const doc = new DOMParser().parseFromString(html, "text/html");
const links = Array.from(doc.querySelectorAll<HTMLAnchorElement>("a[href]"));
```

**フォールバック:**
- DOMパース失敗時にエラーメッセージを返す

##### `getRemoteIndexItems()`

JSONインデックス（`__index.json`）を取得します。

```typescript
const query = new URLSearchParams();
query.set("ext", extensions.join(","));
if (options.path) {
  query.set("path", options.path);
}
if (options.recursive === false) {
  query.set("recursive", "0");
}

const url = `${trimmedBaseUrl.replace(/\/+$/, "")}/__index.json?${query.toString()}`;
```

**優先順位:**
1. JSONインデックス（`__index.json`）
2. HTMLディレクトリ一覧

#### URL構築

##### `buildUrlFromRelative()`

ベースURLと相対パスから絶対URLを構築します。

```typescript
export function buildUrlFromRelative(baseUrl: string, relativePath: string): string {
  const trimmedBaseUrl = baseUrl.trim().replace(/\/+$/, "");
  const trimmedRelativePath = relativePath.trim().replace(/^\/+/, "");
  return `${trimmedBaseUrl}/${encodePath(trimmedRelativePath})}`;
}
```

**URLエンコード:**

```typescript
function encodePath(path: string): string {
  return path
    .split("/")
    .map((segment) => encodeURIComponent(decodeURIComponentSafe(segment)))
    .join("/");
}
```

- セグメントごとにエンコード（スラッシュを維持）

##### `resolveVaultFolderPath()`

絶対パスまたは相対パスをVault相対パスに変換します。

```typescript
if (!isAbsolute) {
  return {folderPath: normalizedInput, errorMessage: ""};
}

const basePath = getVaultBasePath(app);
if (!basePath) {
  return {folderPath: "", errorMessage: "Absolute paths require a desktop vault."};
}

const relative = normalizedInput.slice(normalizedBase.length).replace(/^\/+/, "");
```

**バリデーション:**
- デスクトップVaultでのみ絶対パスを許可
- Vault外のパスを拒否

---

### utils/color-utils.ts

#### 役割

- RGBA色の解析とフォーマット
- RGB/HSV変換
- 色値の正規化

#### 主要関数

##### `parseRgbaColor()`

HexまたはRGBA関数形式を解析します。

```typescript
export function parseRgbaColor(value: string): RgbaColor | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  const hexMatch = trimmed.match(HEX_REGEX);
  if (hexMatch?.[1]) {
    return parseHexColor(hexMatch[1]);
  }

  if (trimmed.toLowerCase().startsWith("rgb")) {
    return parseRgbFunction(trimmed);
  }

  return null;
}
```

**サポートされる形式:**
- Hex: `#fff`, `#ffffff`, `#ffff`, `#ffffffff`
- RGBA: `rgba(255, 255, 255, 1)`, `rgba(100%, 100%, 100%, 100%)`

##### `rgbToHsv()` / `hsvToRgb()`

RGBとHSVの相互変換。

```typescript
export function rgbToHsv(color: RgbaColor): HsvColor {
  const r = clampChannel(color.r) / 255;
  const g = clampChannel(color.g) / 255;
  const b = clampChannel(color.b) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;

  let h = 0;
  if (delta > 0) {
    if (max === r) {
      h = ((g - b) / delta) % 6;
    } else if (max === g) {
      h = (b - r) / delta + 2;
    } else {
      h = (r - g) / delta + 4;
    }
    h *= 60;
    if (h < 0) {
      h += 360;
    }
  }

  const s = max === 0 ? 0 : delta / max;
  return {h, s, v: max, a: clampAlpha(color.a)};
}
```

**変換式:**
- Hue: 最大チャンネルに基づく色相角（0-360）
- Saturation: (max - min) / max
- Value: max

---

## 設定項目の詳細

### serverBaseUrl

**型:** `string`
**デフォルト:** `"http://127.0.0.1:3000"`

HTTPディレクトリ一覧のベースURL。

**使用シナリオ:**
- Local Vault ServerのURL
- カスタムHTTPサーバーのURL

**制約:**
- `useRemoteIndex`が有効な場合に使用
- `linkedServerEntryId`がある場合は同期により更新

### imageFolderPath

**型:** `string`
**デフォルト:** `""`

Vault内の画像フォルダパス（相対または絶対）。

**入力形式:**
- 相対パス: `"wallpapers"`, `"images/backgrounds"`
- 絶対パス: `"/Users/user/Images/wallpapers"`

**制約:**
- デスクトップVaultでのみ絶対パスを許可
- Vault外のパスは拒否
- 空の場合はエラー

### useRemoteIndex

**型:** `boolean`
**デフォルト:** `false`

HTTPディレクトリ一覧を使用するかどうか。

**効果:**
- 有効: Remoteインデックス（JSONまたはHTML）を優先
- 無効: Vaultスキャンのみ

**優先順位:**
1. JSONインデックス（`__index.json`）
2. HTMLディレクトリ一覧
3. Vaultスキャン（フォールバック）

### authToken

**型:** `string`
**デフォルト:** `""`

Bearer認証トークン。

**使用シナリオ:**
- Local Vault Serverの認証
- カスタムHTTPサーバーの認証

**効果:**
- `Authorization: Bearer {token}`ヘッダーを付与
- トークンがある場合、Remote URLを優先

### cssVariableName

**型:** `string`
**デフォルト:** `"--anp-background-image-dark"`

更新対象CSS変数名。

**使用例:**
```css
:root {
  --anp-background-image-dark: url("...");
}
```

**推奨値:**
- `--anp-background-image-dark`: ダークモード用
- `--anp-background-image-light`: ライトモード用（未実装）

### selectedImagePath

**型:** `string`
**デフォルト:** `""`

選択された画像の相対パス。

**保存形式:**
- 相対パスのみ（フォルダからの相対）
- URLではなくパスを保存（Base URL変更に対応）

### linkedServerEntryId

**型:** `string`
**デフォルト:** `""`

Local Vault ServerのエントリID。

**効果:**
- 有効な場合、サーバー設定を同期
- `serverBaseUrl`、`imageFolderPath`、`authToken`を自動更新
- ホワイトリストを有効化

### themeDarkBase00 / themeDarkBase10

**型:** `string`
**デフォルト:** `"rgba(17, 15, 32, 0.79)"`

ダークテーマの色。

**適用範囲:**
- `.theme-dark`スコープ内の`--my-color-base-00`
- `.theme-dark`スコープ内の`--my-color-base-10`

**フォーマット:**
- RGBA: `rgba(255, 255, 255, 1)`
- Hex: `#ffffffff`（4桁、6桁、8桁）

---

## Local Vault Server統合

### 概要

Local Vault Serverプラグインと連携して、設定を同期し、ホワイトリスト管理を行います。

### APIバージョニング

```typescript
export const LOCAL_VAULT_SERVER_API_VERSION = 1;
export const LOCAL_VAULT_SERVER_PLUGIN_ID = "LocalVaultServer-plugin";
```

**互換性検証:**

```typescript
const api = plugin.getApi();
if (!api || api.apiVersion !== LOCAL_VAULT_SERVER_API_VERSION) {
  return null;
}
```

**バージョン不一致時の動作:**
- APIブリッジはnullを返す
- 手動設定にフォールバック

### 設定同期フロー

```
Local Vault Server設定変更
  ↓
onSettingsChangedコールバック
  ↓
syncFromLinkedServer()
  ↓
設定の比較と更新
  ↓
saveSettings() + applySelectedBackground()
```

**同期される設定:**

1. `serverBaseUrl`: `buildLocalVaultServerBaseUrl(entry)`
2. `imageFolderPath`: Vault相対パスに変換
3. `authToken`: エントリの`authToken`

### ホワイトリスト処理

#### 有効時の動作

```typescript
if (linkedInfo.whitelistEnabled) {
  const allowedPaths = linkedInfo.whitelistFiles
    .map((value) => this.normalizeRelativePath(value))
    .filter((value) => this.isImagePath(value));
  const filteredPaths = this.filterExistingVaultRelativePaths(
    folderPath,
    allowedPaths
  );
  return buildImageItemsFromRelativePaths(...);
}
```

**フィルタリング:**
1. ホワイトリストから画像パスのみを抽出
2. Vault内に存在するパスのみをフィルタ
3. `ImageItem`リストを構築

#### バリデーション

```typescript
private isImagePath(pathValue: string): boolean {
  const ext = pathValue.split(".").pop()?.toLowerCase();
  return new Set([
    "png", "jpg", "jpeg", "webp", "gif", "bmp", "svg", "avif", "tif", "tiff",
  ]).has(ext);
}
```

### エラーハンドリング

**プラグインが利用できない場合:**

```typescript
if (!localServerApi) {
  containerEl.createEl("p", {
    text: "Local Vault Server plugin is not available...",
  });
}
```

**エントリが見つからない場合:**

```typescript
const entry = findLocalVaultServerEntry(
  api.getServerEntries(),
  this.settings.linkedServerEntryId
);
if (!entry) {
  return {enabled: false, files: []};
}
```

---

## 画像取得フロー

### 優先順位

```
Linked Server → Remote Index → Vault Scan → HTML Directory Listing
```

### 詳細フロー

#### 1. Linked Serverが有効な場合

```typescript
if (linkedInfo) {
  if (linkedInfo.whitelistEnabled) {
    // ホワイトリストフィルタ
    return buildImageItemsFromRelativePaths(...);
  }

  const localResult = getVaultImageItems(this.app, linkedInfo.baseUrl, folderPath);
  if (!localResult.errorMessage) {
    return localResult;
  }

  // Vault失敗 → Remoteインデックス
  const indexResult = await getRemoteIndexItems(linkedInfo.baseUrl, {...});
  return buildImageItemsFromRelativePaths(...);
}
```

#### 2. Remote Indexが有効な場合

```typescript
if (shouldPreferRemote) {
  const indexResult = await getRemoteIndexItems(baseUrl, {...});
  if (!indexResult.errorMessage) {
    return buildImageItemsFromRelativePaths(...);
  }

  const fallback = await getRemoteImageItems(baseUrl, authToken);
  return buildImageItemsFromRelativePaths(...);
}
```

**優先順位:**
1. JSONインデックス（`__index.json`）
2. HTMLディレクトリ一覧（`DOMParser`）

#### 3. Vaultモードの場合

```typescript
if (!this.host.settings.useRemoteIndex) {
  const localResult = getVaultImageItems(this.app, "", folderPath);
  return this.applyWhitelistFilter(localResult);
}
```

### キャッシュ戦略

#### キャッシュキー

```typescript
private getCacheKey(): string {
  const preferRemote = this.shouldPreferRemoteSource();
  const mode = preferRemote ? "remote" : "vault";
  const baseUrl = preferRemote ? this.host.settings.serverBaseUrl.trim() : "";
  const authToken = preferRemote ? this.host.settings.authToken?.trim() ?? "" : "";
  const folder = this.host.settings.imageFolderPath.trim();
  const whitelistKey = this.getWhitelistCacheKey();
  return `${mode}|${baseUrl}|${folder}|${authToken}|${whitelistKey}`;
}
```

#### キャッシュ有効性

```typescript
private isVaultCacheValid(items: ImageItem[]): boolean {
  for (const item of items) {
    if (!item.file) {
      return false;
    }
    const current = this.app.vault.getAbstractFileByPath(item.file.path);
    if (!(current instanceof TFile)) {
      return false;
    }
  }
  return true;
}
```

**無効化条件:**
- ファイルが削除された
- ファイルが移動された

---

## UIコンポーネント

### Background Picker Overlay

#### 構造

```html
<div class="anp-bg-picker-overlay">
  <div class="anp-bg-picker-dialog">
    <div class="anp-bg-picker-header">
      <h2>Background picker</h2>
      <button class="anp-bg-picker-close">Close</button>
    </div>
    <div class="anp-bg-picker-info">...</div>
    <div class="anp-bg-picker-controls">
      <button>Refresh</button>
      <button>Clear</button>
    </div>
    <div class="anp-bg-picker-status">...</div>
    <div class="anp-bg-picker-grid">...</div>
  </div>
</div>
```

#### グリッドレイアウト

```css
.anp-bg-picker-grid {
  display: grid;
  grid-template-columns: repeat(var(--anp-bg-picker-columns, 4), minmax(0, 1fr));
  grid-auto-rows: var(--anp-bg-picker-row-height, 140px);
}
```

**動的計算:**

```typescript
private findBestGridLayout(
  count: number,
  width: number,
  height: number,
  aspect: number,
  gap: number
): {columns: number; rowHeight: number} {
  for (let columns = 1; columns <= count; columns += 1) {
    const rows = Math.ceil(count / columns);
    const maxTileWidth = availableWidth / columns;
    const maxTileHeight = availableHeight / rows;
    const tileHeight = Math.min(maxTileHeight, maxTileWidth / aspect);
    const area = tileWidth * tileHeight;
    if (area > bestArea) {
      bestArea = area;
      bestColumns = columns;
      bestRowHeight = tileHeight;
    }
  }
}
```

**目的:**
- 最大のタイル面積を達成
- ウィンドウサイズに適応

### RGBA Color Picker

#### 構造

```html
<div class="anp-color-control">
  <div class="anp-color-picker">
    <div class="anp-color-sv">
      <div class="anp-color-sv-handle"></div>
    </div>
    <div class="anp-color-sliders">
      <input class="anp-color-slider anp-color-hue">
      <input class="anp-color-slider anp-color-alpha">
    </div>
  </div>
  <div class="anp-color-fields">
    <input type="number" class="anp-color-number"> <!-- R -->
    <input type="number" class="anp-color-number"> <!-- G -->
    <input type="number" class="anp-color-number"> <!-- B -->
    <input type="number" class="anp-color-number"> <!-- A -->
  </div>
  <div class="anp-color-actions">
    <div class="anp-color-preview"></div>
    <button class="anp-color-reset">Reset</button>
  </div>
</div>
```

#### インタラクション

**SV正方形:**
- ポインタドラッグで彩度・明度を調整
- 色相を固定

**Hueスライダー:**
- 色相を0-360で調整
- SV正方形の背景色を更新

**Alphaスライダー:**
- 透明度を0-1で調整
- グラデーション背景で視覚化

**数値フィールド:**
- 直接RGBA値を入力
- 自動バリデーションと正規化

---

## パフォーマンス最適化

### レンダリング分割

#### requestIdleCallback

```typescript
const requestIdle = (
  window as Window & {
    requestIdleCallback?: (callback: () => void, options?: {timeout: number}) => number;
  }
).requestIdleCallback;

if (requestIdle) {
  requestIdle(() => this.renderTileBatch(), {timeout: 120});
  return;
}
window.setTimeout(() => this.renderTileBatch(), 16);
```

**効果:**
- メインスレントをブロックしない
- アイドル時間を利用
- ブラウザのサポートがない場合はフォールバック

#### バッチサイズ

```typescript
const batchSize = 24;
while (rendered < batchSize && this.renderQueue.index < items.length) {
  fragment.appendChild(this.createTile(item, this.renderQueue.index - 1));
  rendered += 1;
}
```

**理由:**
- 1フレームでレンダリングするタイル数を制限
- 60fpsを維持

### キャッシュ戦略

#### 事前キャッシュ

```typescript
private scheduleCacheWarmup(): void {
  const requestIdle = (window as Window & {
    requestIdleCallback?: (callback: () => void, options?: {timeout: number}) => number;
  }).requestIdleCallback;

  if (requestIdle) {
    this.cacheWarmupIsIdle = true;
    this.cacheWarmupHandle = requestIdle(runWarmup, {timeout: 1200});
  }
}
```

**タイミング:**
- 初期レンダリング後に実行
- 最大1.2秒待機

#### キャッシュ無効化

```typescript
private isVaultCacheValid(items: ImageItem[]): boolean {
  for (const item of items) {
    if (!item.file) return false;
    const current = this.app.vault.getAbstractFileByPath(item.file.path);
    if (!(current instanceof TFile)) return false;
  }
  return true;
}
```

### レイアウト最適化

#### ResizeObserver

```typescript
private ensureResizeObserver(): void {
  if (this.resizeObserver || !this.gridEl) {
    return;
  }
  this.resizeObserver = new ResizeObserver(() => {
    this.requestGridUpdate();
  });
  this.resizeObserver.observe(this.gridEl);
}
```

**効果:**
- グリッドサイズの変更を監視
- 再計算を必要時のみ実行

#### requestAnimationFrame

```typescript
private requestGridUpdate(): void {
  if (this.pendingGridUpdate) return;
  this.pendingGridUpdate = true;
  requestAnimationFrame(() => {
    this.pendingGridUpdate = false;
    this.updateGridLayout();
  });
}
```

**効果:**
- レイアウト計算をブラウザの描画サイクルに同期
- 複数の更新要求をバッチ化

---

## ビルドと開発

### ビルドコマンド

#### 開発モード

```bash
npm run dev
```

- `esbuild`のウォッチモード
- インラインソースマップ
- 自動再ビルド

#### 本番ビルド

```bash
npm run build
```

- TypeScriptコンパイル（`tsc -noEmit -skipLibCheck`）
- esbuildによるバンドル
- Minify
- ソースマップなし

### Lint

```bash
npm run lint
```

- ESLintによる静的解析
- TypeScriptの型チェック
- Obsidian固有のルール適用

### ビルド設定

#### esbuild.config.mjs

```javascript
const context = await esbuild.context({
  banner: {js: banner},
  entryPoints: ["src/main.ts"],
  bundle: true,
  external: [
    "obsidian",
    "electron",
    "@codemirror/*",
    "@lezer/*",
    ...builtinModules
  ],
  format: "cjs",
  target: "es2018",
  outfile: "main.js",
  minify: prod,
});
```

**外部依存:**
- Obsidian API
- Electron
- CodeMirror
- Lezer（Obsidianのエディタ用）

#### tsconfig.json

```json
{
  "compilerOptions": {
    "baseUrl": "src",
    "strict": true,
    "target": "ES6",
    "module": "ESNext",
    "noUncheckedIndexedAccess": true,
    "useUnknownInCatchVariables": true
  }
}
```

**厳格モード:**
- 型安全の強化
- 不明なエラーのキャッチを防止

### バージョン管理

#### version-bump.mjs

```javascript
const targetVersion = process.env.npm_package_version;
const manifest = JSON.parse(readFileSync("manifest.json", "utf8"));
manifest.version = targetVersion;
writeFileSync("manifest.json", JSON.stringify(manifest, null, "\t"));

const versions = JSON.parse(readFileSync('versions.json', 'utf8'));
versions[targetVersion] = manifest.minAppVersion;
writeFileSync("versions.json", JSON.stringify(versions, null, '\t'));
```

**更新対象:**
- `manifest.json`の`version`
- `versions.json`のバージョンマップ

---

## 拡張ポイント

### 新しい画像ソースの追加

#### 手順

1. `src/utils/image-utils.ts`に関数を追加

```typescript
export async function getCustomImageItems(
  options: CustomOptions
): Promise<ImageItemsResult> {
  // カスタムロジック
}
```

2. `src/ui/background-picker-overlay.ts`の`loadImageItems()`に追加

```typescript
const customResult = await getCustomImageItems(options);
if (!customResult.errorMessage) {
  return customResult;
}
```

### 新しい設定項目の追加

#### 手順

1. `src/settings.ts`のインターフェースに追加

```typescript
export interface MyPluginSettings {
  newSetting: string;
}
```

2. デフォルト値を追加

```typescript
export const DEFAULT_SETTINGS: MyPluginSettings = {
  newSetting: "default",
};
```

3. 設定タブにUIを追加

```typescript
new Setting(containerEl)
  .setName("New Setting")
  .setDesc("Description")
  .addText((text) =>
    text
      .setValue(this.plugin.settings.newSetting)
      .onChange(async (value) => {
        this.plugin.settings.newSetting = value;
        await this.plugin.saveSettings();
      })
  );
```

### Local Vault Server APIの拡張

#### 新しいエンドポイント

```typescript
export interface LocalVaultServerApi {
  apiVersion: number;
  getServerEntries: () => LocalVaultServerEntry[];
  getCustomData: () => CustomData; // 新しいメソッド
  onSettingsChanged: (handler) => () => void;
}
```

#### バージョン管理

```typescript
export const LOCAL_VAULT_SERVER_API_VERSION = 2;

export function getLocalVaultServerApi(app: App): LocalVaultServerApi | null {
  const api = plugin.getApi();
  if (!api || api.apiVersion < LOCAL_VAULT_SERVER_API_VERSION) {
    return null; // 古いバージョンは拒否
  }
  return api;
}
```

### カラーピッカーのカスタマイズ

#### 新しい色フォーマット

```typescript
export function parseCustomColor(value: string): RgbaColor | null {
  // カスタムパースロジック
}

export function formatCustomColor(color: RgbaColor): string {
  // カスタムフォーマット
}
```

#### 設定タブでの使用

```typescript
addRgbaSetting(containerEl, {
  name: "Custom Color",
  value: this.plugin.settings.customColor,
  fallback: DEFAULT_SETTINGS.customColor,
  onChange: async (value) => {
    this.plugin.settings.customColor = value;
    await this.plugin.saveSettings();
  },
});
```

---

## 用語集

| 用語 | 説明 |
|------|------|
| Base URL | HTTPサーバーのベースURL |
| Image Folder Path | Vault内の画像フォルダパス |
| Remote Index | HTTP経由の画像一覧（JSONまたはHTML） |
| Vault Scan | Vault内のファイル再帰スキャン |
| Linked Server Entry | Local Vault ServerのエントリID |
| Whitelist | アクセスを許可するファイルリスト |
| CSS Variable | 背景画像URLを設定するCSS変数 |
| RGBA Picker | RGBA色を選択するUIコンポーネント |
| SV Square | 彩度・明度を選択する正方形領域 |
| Cache Key | キャッシュの一意識別子 |
| Render Token | レンダリング操作の一意識別子 |

---

## 参考資料

### Obsidian API

- [ドキュメント](https://docs.obsidian.md)
- [サンプルプラグイン](https://github.com/obsidianmd/obsidian-sample-plugin)

### Local Vault Server

- GitHubリポジトリ（ローカルパス）
- APIバージョニングガイドライン

### TypeScript

- [ドキュメント](https://www.typescriptlang.org/docs/)

### esbuild

- [ドキュメント](https://esbuild.github.io/)

---

## 変更履歴

### バージョン 1.0.0

- 初回リリース
- 背景ピッカーの基本機能
- Local Vault Server統合
- RGBAカラーピッカー
- JSONインデックスサポート

---

## トラブルシューティング

### 画像が表示されない

**原因:**
- `imageFolderPath`が間違っている
- Vault外の絶対パスを指定している

**解決策:**
1. 設定で`imageFolderPath`を確認
2. 相対パスを使用する

### HTTPディレクトリ一覧が取得できない

**原因:**
- `serverBaseUrl`が間違っている
- サーバーが起動していない
- `authToken`が必要

**解決策:**
1. URLを確認
2. ブラウザで直接アクセスして動作確認
3. `authToken`を設定

### 背景が適用されない

**原因:**
- `cssVariableName`が正しくない
- テーマが変数を使用していない

**解決策:**
1. `cssVariableName`を確認
2. CSS変数が存在するか確認

### Local Vault Serverと連携できない

**原因:**
- Local Vault Serverプラグインが有効でない
- APIバージョンが不一致

**解決策:**
1. Local Vault Serverプラグインを有効化
2. プラグインのバージョンを確認
3. プラグインを再起動

---

## ライセンス

0-BSD

---

## 貢献

バグ報告や機能の提案は、GitHubのIssuesを使用してください。

---

## 作者

Obsidian Plugin Sample

---

最終更新日: 2026-01-29
