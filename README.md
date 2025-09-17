# Video Annotation Tool

動画アノテーション専用デスクトップアプリケーション（React + TypeScript + Electron）

## 機能

- 🎥 動画ファイルの読み込み・再生
- 🎯 フレーム単位でのアノテーション作成
- 📝 タイムライン上でのアノテーション管理
- 📊 CSV形式でのアノテーションデータエクスポート
- ⚡ フレームレート設定・再生速度調整
- 🔧 リサイズ可能なUI（動画表示領域とタイムライン）

## 開発環境セットアップ

### 前提条件

- Node.js 18以上
- Yarn 1.22以上

### インストール

```bash
# リポジトリクローン
git clone <repository-url>
cd Annotation-Tool

# 依存関係のインストール
yarn install
```

### 開発サーバー起動

```bash
# 開発サーバー起動（推奨）
yarn dev
```

このコマンドで以下が同時に起動します：
- **[VITE]** (青) - Reactアプリ開発サーバー (http://localhost:3001)
- **[TS]** (黄) - TypeScriptコンパイラ（ウォッチモード）
- **[ELECTRON]** (緑) - Electronアプリケーション

### 個別実行（デバッグ用）

```bash
# Reactのみ（http://localhost:3001）
yarn dev:react

# TypeScriptコンパイルのみ
yarn dev:main

# Electronのみ（上記2つが起動していること前提）
yarn dev:electron
```

## ビルド・パッケージ化

### 本番用ビルド

```bash
# React + TypeScriptコンパイル
yarn build
```

これにより以下が生成されます：
- `dist/renderer/` - 最適化されたReactアプリ
- `dist/main/` - コンパイルされたElectronメインプロセス

### アプリケーションパッケージ化

```bash
# Windows用インストーラー作成（推奨）
yarn dist

# 実行可能ファイルのみ（ポータブル版）
yarn dist:dir
```

**作成されるファイル：**
- `release/Annotation Tool Setup 1.0.0.exe` - インストーラー（約77MB）
- `release/win-unpacked/Annotation Tool.exe` - 実行ファイル（約177MB）

### その他のビルドコマンド

```bash
# パッケージ化（インストーラーなし）
yarn pack
```

### リント・フォーマット

```bash
# ESLint チェック
yarn lint

# ESLint 自動修正
yarn lint:fix

# TypeScript型チェック
yarn typecheck

# Prettier フォーマット
yarn prettier

# Prettier チェック
yarn prettier:check
```

## プロジェクト構造

```
src/
├── main/           # Electronメインプロセス
│   ├── main.ts     # メインエントリーポイント
│   ├── preload.ts  # プリロードスクリプト
│   └── utils.ts    # ユーティリティ関数
└── renderer/       # Reactアプリ（レンダラープロセス）
    ├── components/ # Reactコンポーネント
    ├── pages/      # ページコンポーネント
    ├── styles/     # スタイルファイル
    ├── types/      # 型定義
    ├── utils/      # ユーティリティ関数
    ├── App.tsx     # メインアプリコンポーネント
    ├── main.tsx    # Reactエントリーポイント
    └── index.html  # HTMLテンプレート
```

## 設定ファイル

- `package.json` - パッケージ設定・スクリプト
- `tsconfig.json` - TypeScript設定（レンダラー用）
- `tsconfig.main.json` - TypeScript設定（メイン用）
- `vite.config.ts` - Vite設定
- `.eslintrc.js` - ESLint設定
- `.prettierrc` - Prettier設定

## 開発時のポイント

### 停止方法

```bash
# 開発サーバー停止
Ctrl + C  # 1回で全プロセス停止
```

### ポート設定

- **Vite**: http://localhost:3001
- `--strictPort`により、ポートが使用中の場合はエラーで停止

### ログの見方

`yarn dev`実行時の色分けログ：
- **[VITE]** (青) - React開発サーバー関連
- **[TS]** (黄) - TypeScriptコンパイル関連
- **[ELECTRON]** (緑) - Electronアプリ関連

## トラブルシューティング

### ポートエラーが発生する場合

```bash
# ポート3001を使用中のプロセスを確認
netstat -ano | findstr :3001

# プロセス強制終了（PowerShell）
powershell "Stop-Process -Id <PID> -Force"
```

### TypeScriptエラーが発生する場合

```bash
# 型チェック
yarn typecheck

# ESLintチェック
yarn lint
```

### 初回セットアップでエラーが発生する場合

```bash
# node_modules削除して再インストール
rm -rf node_modules yarn.lock
yarn install
```

## プロジェクト構造詳細

```
src/
├── main/                    # Electronメインプロセス
│   ├── main.ts             # メイン起動ファイル
│   ├── preload.ts          # セキュアなIPC通信用
│   └── utils.ts            # ユーティリティ関数
└── renderer/               # Reactアプリ（UI）
    ├── components/         # UIコンポーネント
    │   ├── Video.tsx       # 動画プレイヤー
    │   ├── Timeline.tsx    # タイムライン
    │   ├── Settings.tsx    # 設定パネル
    │   └── ...
    ├── App.tsx            # メインアプリ
    ├── App.scss           # スタイル
    └── index.tsx          # エントリーポイント

dist/                       # ビルド出力
├── main/                  # コンパイル済みElectron
└── renderer/              # ビルド済みReact

release/                    # パッケージ出力
├── win-unpacked/          # 実行ファイル
└── *.exe                  # インストーラー
```

## カスタマイズ

### アイコン変更

`assets/`ディレクトリにアイコンファイルを配置：
- `icon.ico` (Windows用、推奨サイズ: 256x256)
- `icon.icns` (macOS用)
- `icon.png` (Linux用、推奨サイズ: 512x512)

### アプリ情報変更

`package.json`の以下を編集：
```json
{
  "name": "annotation-tool",
  "productName": "Video Annotation Tool",
  "version": "1.0.0",
  "description": "...",
  "build": {
    "appId": "com.yourcompany.annotation-tool"
  }
}
```