<!-- Path: README.md -->
<!-- Role: Divergences Plus プラグインの説明書。 -->
<!-- Why: 設定方法と Local Vault Server 連携を明確にするため。 -->
<!-- Related: src/main.ts, src/settings.ts, src/ui/background-picker-overlay.ts, ../obsidian-local-vault-server-plugin/main.ts -->

# Divergences Plus Plugin

Obsidian の背景画像を選ぶためのシンプルなプラグインです。  
Vault 内の画像か、ローカル HTTP サーバーの画像を使えます。

## 主な機能
- 背景ピッカーのオーバーレイ表示。  
- Vault 画像のスキャン。  
- Local Vault Server との設定同期。  
- JSON インデックスによる高速な取得。  
- 認証トークン対応。  

## 前提
- Obsidian デスクトップ。  
- Node.js（ビルド用）。  
- Local Vault Server プラグイン（任意）。

## クイックスタート
1. プラグインを導入。  
2. **設定 → コミュニティプラグイン** で有効化。  
3. **Image folder path** を設定。  
4. ピッカーを開いて背景を選択。

## Local Vault Server 連携
- Local Vault Server を有効化。  
- **Linked server entry** でエントリを選択。  
- Base URL / フォルダ / トークンが自動同期されます。  
- リンク中は Local Vault Server の whitelist / index を唯一の情報源にします。  

## JSON インデックス
- **Use HTTP directory listing** が ON の場合、`__index.json` を優先します。  
- 失敗時は HTML のディレクトリ一覧にフォールバックします。  
- JSON インデックスの方が高速で安定します。

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
