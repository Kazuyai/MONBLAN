# 配布方針

このドキュメントは、MONBLANを研究用途で他者に渡すための配布方針を整理する。

## 前提

- 想定用途は研究用途。
- 商用利用は想定しない。
- 通常の手動アノテーション機能は、AI環境が未セットアップでも利用できる状態を維持する。
- AI自動アノテーション機能は、AlphaPose、MotionBERT、PyTorch、外部checkpointに依存する。GPU実行時はCUDAにも依存する。
- すべての処理はローカルで完結させる。クラウドAPIには依存しない。

## 公開時の注意

このリポジトリは将来的にpublicになる可能性があるため、ドキュメントは不特定多数の利用者が読む前提で書く。

- このプロジェクト本体のライセンスと、AlphaPose / MotionBERT / checkpoint のライセンスは別物として扱う。
- 外部リポジトリや重みファイルの利用条件は、利用者自身が各公式配布元で確認する必要がある。
- このドキュメントは技術方針であり、法的助言ではない。
- 「このリポジトリをcloneすればAI機能まで完全に使える」と誤解されないようにする。
- AI機能は追加セットアップが必要であり、通常の手動アノテーション機能とは依存関係を分けて説明する。
- 未検証環境では、AI機能を正式対応として案内しない。

## 現時点の主経路

当面の主経路は以下とする。

```text
Windows
  Electron アプリ
  ローカル FastAPI
  Python venv
  NVIDIA GPU / CUDA（推奨）
  ユーザーが配置した AlphaPose / MotionBERT / checkpoint
```

理由:

- 現在の動作確認環境に最も近い。
- Electron からローカル FastAPI を起動する実装と整合する。
- アプリ内の「AI環境セットアップ」画面から、専用Python環境と外部AIプログラムを段階的に準備できる。
- Docker / PyInstaller より、問題発生時の切り分けが容易。

## OS別サポート方針

### Windows

当面の正式対象はWindowsとし、NVIDIA GPU + CUDAを推奨環境とする。CPU実行も許可するが、処理時間が大幅に長くなる可能性を明示する。

- 手動アノテーション機能: 対象
- AI自動アノテーション機能: 対象
- 配布・セットアップ手順: 優先して整備する

### macOS

macOSは、現時点では配布・AI自動アノテーション機能ともに正式対象外とする。

理由:

- 現在のAIパイプラインはCUDA対応GPUを推奨するが、CPU実行も許可する。
- 一般的なMacでは NVIDIA CUDA を利用できない。
- `API\environment.py` はPyTorchを必須確認し、`torch.cuda.is_available()`が`false`の場合はCPU実行の警告を返す。
- Apple Silicon の MPS 対応は未検証であり、AlphaPose / MotionBERT を含む全体パイプラインの安定動作を確認していない。

将来的に検討する場合:

- CPU低速モード
- Apple Silicon / MPS 対応
- AI機能を無効化したMac向け配布

ただし、これらは現時点の主経路ではない。

### Linux

Linuxは将来的な候補とする。NVIDIA GPU + CUDA が使える環境ではAI実行の可能性があるが、現時点では正式対象にしない。

## Dockerで解決できること・できないこと

Dockerは、OS横断で全機能を同じように動かすための手段ではない。特にこのプロジェクトでは、Dockerで安定化できる範囲と、Dockerでは解決できない範囲を分けて扱う。

Dockerで改善できること:

- Python / PyTorch / CUDA 系依存の固定
- FastAPI 実行環境の再現性
- LinuxベースのAI API環境の固定
- 開発者間でのAPI環境差分の削減

Dockerだけでは解決しないこと:

- MacでCUDAを使えない問題
- NVIDIA GPUドライバやホストOS側のGPU設定
- Docker Desktop / WSL2 / NVIDIA Container Toolkit の導入
- AlphaPose / MotionBERT / checkpoint のライセンスと取得
- ホストOSの動画パスとコンテナ内パスの変換
- ElectronデスクトップUIの配布

## 配布物に含めるもの

含める:

- Electron アプリ本体
- React / Electron のビルド成果物
- FastAPI のAPIコード
- `API\detect_movement`
- `API\requirements.txt`
- `scripts\check-ai-environment.ps1`
- `scripts\setup-python-env.ps1`
- `scripts\fetch-ai-repos.ps1`
- `scripts\verify-ai-pipeline.ps1`
- `docs` 配下の手順書

含めない:

- `API\AlphaPose`
- `API\MotionBERT`
- AlphaPose checkpoint
- MotionBERT checkpoint
- `API\venv`
- `release`
- `dist`

AlphaPose は非商用ライセンスのため、リポジトリや配布パッケージに同梱しない。利用者が公式リポジトリから取得する。

## セットアップの責務分担

配布者が提供するもの:

- アプリ本体
- セットアップ手順
- アプリ内のAI環境セットアップ画面
- 環境診断スクリプト
- venv作成補助スクリプト
- 外部AIリポジトリ取得補助スクリプト
- 軽量疎通確認スクリプト

利用者が用意するもの:

- NVIDIA GPU 環境
- CUDA互換のNVIDIAドライバ
- AlphaPose
- MotionBERT
- 各checkpoint

## Dockerの位置づけ

Dockerは将来的な選択肢として残す。ただし、現時点では主経路にしない。

理由:

- WindowsでGPUを使う場合、Docker Desktop、WSL2、NVIDIA Container Toolkit が必要になる。
- 非プログラマ向けには、Docker自体が追加の学習・設定コストになる。
- Electronデスクトップアプリ本体をDocker化する必要はなく、やるとしてもAI API部分だけが対象。
- AlphaPoseやcheckpointをDocker imageに同梱できるかは、ライセンス上慎重に扱う必要がある。

将来検討する場合の方針:

- `docker compose` でAI APIだけを起動する。
- ElectronアプリはホストOS上で動かす。
- 動画ファイルはホストパスをコンテナへマウントする。
- AlphaPose / MotionBERT / checkpoint はユーザーが取得し、volumeとして渡す。
- Dockerは「環境固定を優先する利用者向けのオプション」として扱う。

### Docker設計ルール

Docker対応を行う場合は、以下のルールを守る。

- Docker化する対象は AI API のみ。
- Electron本体はホストOS上で動かす。
- Docker image に AlphaPose / MotionBERT / checkpoint を同梱しない。
- AlphaPose / MotionBERT / checkpoint は volume mount で渡す。
- 動画ファイルも volume mount で渡す。
- `*_from_path` API をDockerで使う場合は、ホストパスからコンテナ内パスへの変換設計を先に決める。
- Docker構成は主経路ではなく、`optional` な配布・開発補助として扱う。
- Docker利用者向けに、GPUが必要であることと、MacではAI機能が正式対象外であることを明記する。

### Docker実装を始める条件

Dockerfile / docker compose は、以下が満たされてから実装する。

- Windows + venv 手順で共同研究者が再現できている。
- `API\requirements.txt` の直接依存を最小化し、主要パッケージの固定方針が決まっている。
- AlphaPose / MotionBERT / checkpoint の volume mount 先が決まっている。
- 動画ファイルの path mapping 方針が決まっている。
- Docker GPU環境を検証できる対象マシンがある。

## PyInstallerの位置づけ

PyInstallerでPython APIを単一実行ファイル化する案は、現時点では主経路にしない。

理由:

- PyTorch、CUDA、外部AIスクリプトを含むため失敗しやすい。
- AlphaPose / MotionBERT を同梱しない方針と相性が悪い。
- 問題発生時のログ・依存関係切り分けが難しくなる。

## インストーラの位置づけ

Electron本体のインストーラは `electron-builder` で作成できる。

現状の設定:

- `yarn dist:windows`
- Windows x64
- NSIS installer
- 出力先は `release`

ただし、AI環境はインストーラだけでは完結しない。インストール後に以下を案内する。

1. `scripts\setup-python-env.ps1`
2. `scripts\fetch-ai-repos.ps1`
3. checkpoint配置
4. `scripts\check-ai-environment.ps1`
5. `scripts\verify-ai-pipeline.ps1`

## 推奨する公開段階

### Phase 1: 開発者・自分用

- `yarn dev`
- ローカルPython
- 手動でAI環境を配置
- 主要APIの成功系を確認

### Phase 2: 研究室内・共同研究者向け

- Electronアプリのビルド済み配布
- Windows上の専用AI環境をアプリ画面から構築
- 問題発生時に使用する補助スクリプトを提供
- AlphaPose / MotionBERT / checkpoint は利用者が取得

### Phase 3: 限定公開

- README整備
- ライセンス注意の明記
- サンプル動画での確認手順
- 既知の制約とトラブルシュート

### Phase 4: Dockerオプション検討

- AI APIだけDocker化
- GPU利用手順を検証
- volume設計を整理
- ライセンス上、同梱しないものを明確化

## 次に決めること

- 配布対象を「研究室内」までに留めるか、外部共同研究者まで広げるか。
- ElectronインストーラにPython APIコードをどのように含めるか。
- `API\requirements.txt` のうち、PyTorch以外の直接依存をどこまでバージョン固定するか。
- checkpoint入手手順をどこまで具体化するか。
- Dockerをいつ検証するか。
