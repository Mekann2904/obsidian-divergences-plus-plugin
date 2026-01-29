<!-- Path: README.md -->
<!-- Role: Divergences Plus プラグインの説明書。 -->
<!-- Why: 設定方法と Local Vault Server 連携を明確にするため。 -->
<!-- Related: src/main.ts, src/settings.ts, src/ui/background-picker-overlay.ts, ../obsidian-local-vault-server-plugin/main.ts -->

# Divergences Plus Plugin

Obsidian の背景画像を選ぶためのシンプルなプラグインです。
Vault 内の画像か、ローカル HTTP サーバーの画像を使えます。

このプラグインは、Visual Custom CSS (Annotator) プラグインの背景画像設定と互換性があります。

## 主な機能
- 背景ピッカーのオーバーレイ表示。
- Vault 画像のスキャン。
- Local Vault Server との設定同期。
- JSON インデックスによる高速な取得。
- 認証トークン対応。

## 詳細なドキュメント
本プラグインのアーキテクチャ、設定詳細、統合方法については [DEEPWIKI.md](DEEPWIKI.md) を参照してください。

## 前提
- Obsidian デスクトップ。  
- Node.js（ビルド用）。  
- Local Vault Server プラグイン（任意）。

## クイックスタート

### 基本的な使い方（Vault画像）

1. プラグインを導入
2. **設定 → コミュニティプラグイン** で有効化
3. **Image folder path** に画像フォルダを設定（例: `wallpapers`）
4. ピッカーを開いて背景を選択

### HTTPサーバー経由での使用

1. Local Vault Server プラグインを有効化
2. Local Vault Server でサーバーエントリを作成
3. Divergences Plus で **Linked server entry** を選択
4. 設定が自動同期されます
5. ピッカーを開いて背景を選択

## Local Vault Server 連携
- Local Vault Server を有効化。  
- **Linked server entry** でエントリを選択。  
- Base URL / フォルダ / トークンが自動同期されます。  
- リンク中は Local Vault Server の whitelist / index を唯一の情報源にします。  

## JSON インデックス
- **Use HTTP directory listing** が ON の場合、`__index.json` を優先します。
- 失敗時は HTML のディレクトリ一覧にフォールバックします。
- JSON インデックスの方が高速で安定します。

## 設定項目

### Local Vault Server リンク

| 項目 | 説明 |
|------|------|
| Linked server entry | Local Vault Server のエントリを選択すると、Base URL、フォルダ、トークンが自動同期されます |

### 画像ソース

| 項目 | 説明 |
|------|------|
| Base URL | HTTP サーバーのベース URL（例: `http://127.0.0.1:3000`） |
| Image folder path | Vault 内の画像フォルダパス（例: `wallpapers`）または絶対パス（デスクトップ Vault のみ） |
| Use HTTP directory listing | 有効にすると HTTP サーバーから画像一覧を取得します |
| Auth token | Local Vault Server の Bearer トークン（必要な場合） |

### 表示

| 項目 | 説明 |
|------|------|
| CSS variable | 背景画像を設定する CSS 変数名（デフォルト: `--anp-background-image-dark`） |

### テーマ色

| 項目 | 説明 |
|------|------|
| Base 00 | ダークテーマの背景色（`--my-color-base-00`） |
| Base 10 | ダークテーマの強調色（`--my-color-base-10`） |

RGBA カラーピッカーを使用して色を調整できます。

## ビルド
```bash
npm install
npm run dev
```

本番ビルド:
```bash
npm run build
```

## 手動インストール
`main.js`, `manifest.json`, `styles.css` を以下に配置します。
`<Vault>/.obsidian/plugins/obsidian-divergences-plus-plugin/`

## よくある質問（FAQ）

### Q: 背景画像が表示されません
**A:** 以下を確認してください
1. `Image folder path` が正しいか
2. 指定したフォルダ内に画像ファイルがあるか
3. `CSS variable` が正しい変数名か
4. 使用中のテーマがその変数を使用しているか

### Q: HTTP サーバーから画像が取得できません
**A:** 以下を確認してください
1. Local Vault Server が起動しているか
2. `Base URL` が正しいか
3. `Auth token` が必要か
4. ブラウザで URL に直接アクセスして動作確認

### Q: モバイルで動作しますか
**A:** 一部の機能に制限があります
- 絶対パスはデスクトップ Vault のみで使用可能
- HTTP サーバー経由はモバイルでも使用可能

### Q: Visual Custom CSS (Annotator) と併用できますか
**A:** はい、互換性があります
デフォルトの `--anp-background-image-dark` 変数は Annotator と互換性があります。

### Q: ピッカーが開くのが遅いです
**A:** 画像数が多い場合、レンダリングに時間がかかります
- JSON インデックスを使用すると高速化されます
- 最初の起動時のみキャッシュが作成されるため、2回目以降は高速です

## 既知の制限事項

- 大量の画像（500枚以上）がある場合、ピッカーの表示に時間がかかることがあります
- Vault 外の絶対パスはデスクトップ Vault のみで使用可能です
- Local Vault Server の API バージョンが一致しない場合、連携できません
- 画像のサムネイルは元の解像度で表示されます（リサイズは行われません）

## 関連プロジェクト

### Local Vault Server Plugin
このプラグインと連携して、HTTP サーバー経由で画像を提供します。

### Visual Custom CSS (Annotator)
このプラグインと互換性のある背景画像設定を提供します。

## クレジット

- Obsidian Plugin Sample
- Local Vault Server Plugin

## ライセンス

0-BSD

## サポート

バグ報告や機能のリクエストは、GitHub の Issues を使用してください。

詳細な技術ドキュメントについては [DEEPWIKI.md](DEEPWIKI.md) を参照してください。