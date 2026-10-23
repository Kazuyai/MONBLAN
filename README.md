# MONBLAN

MONBLAN（Motion-based Layered Annotator）は、動画に対してタイムラインベースでアノテーションを付与するデスクトップアプリケーションです。
Electron + React + TypeScript による手動アノテーション機能と、ローカル FastAPI + AlphaPose + MotionBERT によるAI自動アノテーション機能を持ちます。

主に研究用途を想定しています。MONBLAN本体はApache License 2.0ですが、AI機能で利用するAlphaPoseには別途非商用条件があります。

## 重要な注意

- すべての処理はローカル環境で完結します。クラウドAPIには依存しません。
- 手動アノテーション機能は、AI環境が未セットアップでも利用できる方針です。
- AI自動アノテーション機能を使うには、Python、Git、PyTorch、AlphaPose、MotionBERT、各checkpointの追加セットアップが必要です。
- CUDA対応GPUを推奨します。GPUがない環境でもCPU実行できますが、処理に長時間かかることがあります。
- AlphaPose、MotionBERT、各checkpointはこのリポジトリに同梱しません。利用者が各公式配布元から取得してください。
- このプロジェクト本体のライセンスと、外部AIリポジトリ・モデル重みのライセンスは別です。利用条件は各公式配布元で確認してください。
- このREADMEと関連ドキュメントは技術的な利用方針を示すものであり、法的助言ではありません。

## 対応方針

| 機能 | 現時点の対象 |
| --- | --- |
| 手動アノテーション | 初期ベータ版はWindowsを対象。Electronアプリとして動作。 |
| AI自動アノテーション | Windowsを対象。NVIDIA GPU + CUDAを推奨し、CPU実行も許可。 |
| macOS | 現時点では配布・AI機能ともに正式対象外。 |
| Linux | 将来的な候補。現時点では正式対象外。 |
| Docker | 将来的なAI API安定化オプション。現時点では主経路にしない。 |

配布方針の詳細は `docs/distribution-policy.md` を参照してください。
AI環境の具体的なセットアップは `docs/setup-ai-environment.md` を参照してください。
APIの起動方法とエンドポイントは `API/README.md` を参照してください。
public化や配布前の確認項目は `docs/public-release-checklist.md` を参照してください。

## 主な機能

- 動画ファイルの読み込み・再生
- フレーム単位のアノテーション作成
- タイムライン上でのアノテーション編集、ドラッグ、リサイズ
- レイヤー管理
- 選択範囲の作成と範囲時間表示
- 部分再生
- 再生速度調整
- CSVエクスポート
- EAFエクスポート
- AIによる人物候補画像の抽出
- AIによる動作区間検出

## 構成

```text
src/
  main/                 Electronメインプロセス
  renderer/             React UI
API/
  api.py                FastAPIエントリーポイント
  pipeline.py           AlphaPose / MotionBERT / detect_movement 実行処理
  environment.py        AI環境診断
  detect_movement/      動作区間検出スクリプト
scripts/
  check-ai-environment.ps1
  setup-python-env.ps1
  fetch-ai-repos.ps1
  verify-ai-pipeline.ps1
docs/
  distribution-policy.md
  setup-ai-environment.md
  issues-triage.md
```

## 同梱しないもの

以下はリポジトリや配布パッケージに含めない方針です。

- `API/AlphaPose/`
- `API/MotionBERT/`
- AlphaPose checkpoint
- MotionBERT checkpoint
- `API/venv/`
- `release/`
- `dist/`
- 実行時に生成されるログ、ジョブディレクトリ、中間生成物

理由は、外部ライセンス、ファイルサイズ、環境依存性、再現性確認の観点から、利用者環境で取得・配置する方が安全なためです。

## 開発環境

### フロントエンド

- Node.js 18以上
- Yarn 1.22以上
- Electron 28
- React 18
- TypeScript

### AI API

- Python 3.11
- FastAPI
- PyTorch 2.3.0 + CUDA 11.8
- NVIDIA GPU + CUDA実行環境（推奨）
- AlphaPose
- MotionBERT

AI APIの依存関係には、CUDA対応PyTorch、AlphaPose、MotionBERTが含まれます。まずは `docs/setup-ai-environment.md` の手順で環境を確認してください。

## セットアップ

### 1. Node.js依存関係

```bash
yarn install
```

### 2. 開発起動

```bash
yarn dev
```

このコマンドで以下を起動します。

- React開発サーバー: `http://localhost:3001`
- TypeScriptウォッチビルド
- Electronアプリ
- ElectronメインプロセスからのローカルFastAPI起動

AI環境が不足している場合でも、手動アノテーション機能は利用可能にする方針です。AI機能の可否はアプリ起動後に `/environment/` の診断結果で判定します。

### 3. AI環境セットアップ

AI機能を使う場合のみ実施します。

1. アプリを起動して「AI環境セットアップ」タブを開く
2. 画面に表示される順序で、保存先、Python 3.11、Git、依存パッケージを準備する
3. 各ライセンスを確認し、AlphaPoseとMotionBERTの本体を公式リポジトリから取得する
4. 公式配布ページから学習済みモデルをダウンロードし、画面から選択して配置する
5. 「AI APIを起動・再接続」を押し、AI機能が利用可能になったことを確認する

Python 3.11とGit for Windowsが事前に必要です。NVIDIA GPUと対応ドライバーは任意ですが、利用を推奨します。AI環境は `%LOCALAPPDATA%\MONBLAN\ai` に作成され、通常はリポジトリ内やシステムのPython環境を変更しません。

checkpointは利用者が各公式配布元から取得する必要があります。ライセンス、画面操作、手動復旧手順の詳細は `docs/setup-ai-environment.md` を参照してください。

## API単体起動

開発・デバッグ時にAPIだけ起動する場合は、リポジトリルートから実行します。

```bash
python -m uvicorn API.api:app --host 127.0.0.1 --port 8000
```

環境診断:

```bash
curl http://127.0.0.1:8000/environment/
```

## ビルド

```bash
yarn build
```

Windows向けインストーラー作成:

```bash
yarn dist:windows
```

現時点のインストーラーは、AI環境を完全に同梱するものではありません。AI機能を使うには、インストール後に別途AI環境セットアップが必要です。

## 検証コマンド

```bash
yarn typecheck
yarn lint
yarn prettier:check
```

AI APIの疎通確認:

```powershell
.\scripts\verify-ai-pipeline.ps1
```

## 公開前チェック

public化や配布前には、最低限以下を確認します。

- `API/AlphaPose/` がGit管理されていない
- `API/MotionBERT/` がGit管理されていない
- checkpointファイルがGit管理されていない
- `API/venv/` がGit管理されていない
- `release/` と `dist/` がGit管理されていない
- READMEでAI機能の追加セットアップが必要であることを明記している
- 外部AIリポジトリ・モデル重みのライセンスを本体ライセンスと混同していない
- 未検証OSを正式対応として記載していない

## ライセンス

MONBLAN本体はApache License 2.0で公開します。詳細は`LICENSE`と`NOTICE`を参照してください。

ただし、AlphaPose、MotionBERT、各checkpoint、その他外部依存関係にはそれぞれ別のライセンスがあります。特にAI機能を使う場合は、利用者が各公式配布元のライセンスと利用条件を確認してください。
