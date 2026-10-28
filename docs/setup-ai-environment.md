# AI環境セットアップ手順

このドキュメントは、MONBLANのAI自動アノテーション機能をローカル環境で動かすための手順をまとめる。

配布全体の方針は `distribution-policy.md` を参照する。

## 対象環境

現時点では、以下の環境を優先対象とする。

- Windows
- NVIDIA GPU（推奨）
- CUDA 11.8 系（GPU実行時）
- Python 3.11
- PyTorch 2.3.0 + CUDA 11.8

AI機能の正式対象はWindowsとする。NVIDIA GPU + CUDAを推奨するが、利用できない場合も警告付きでCPU実行を許可する。macOSは現時点では配布・AI機能ともに非対応扱いにする。

Docker 前提にはしない。GPU、CUDA、ドライバーの組み合わせはホスト環境の影響を受けるため、Windows上の専用Python環境を標準構成とする。

## 事前に用意するもの

- Python 3.11
- Git for Windows
- NVIDIA GPU（推奨）
- CUDA 11.8対応のNVIDIAドライバー（GPU実行時）
- 依存パッケージと外部リポジトリを取得できるネットワーク接続
- AI環境とモデルを保存できる空き容量

PythonとGitは、インストール後に新しく起動したアプリから利用できるようPATHを設定する。

## 推奨セットアップ手順

通常の利用者はPowerShellを操作せず、アプリの「AI環境セットアップ」タブから以下の順序で進める。

1. 「保存先を準備」を押す。
2. 「Pythonを確認」でPython 3.11が認識されることを確認する。
3. 「Gitを確認」でGit for Windowsが認識されることを確認する。
4. 専用Python環境を作成する。
5. AI依存パッケージをインストールする。ダウンロード量が大きいため、完了まで画面を閉じない。
6. ライセンスを確認し、AlphaPose本体とMotionBERT本体を取得する。
7. 各モデルの「公式ページ」を開き、指定された学習済みモデルをダウンロードする。
8. 「ファイルを選択」からモデルを配置する。
9. 「AI APIを起動・再接続」を押す。
10. 状態が「利用可能」になり、各セットアップ項目がチェック表示になることを確認する。

AlphaPoseは非商用用途に制限される。リポジトリとモデルを取得する前に、利用者自身が公式のライセンスと利用条件を確認すること。本リポジトリにはAlphaPose、MotionBERT、学習済みモデルを同梱しない。

## 保存先

画面から構築したAI環境は、リポジトリではなく次の利用者専用領域に保存する。

```text
%LOCALAPPDATA%\MONBLAN\ai\
```

標準構成は次のとおり。

```text
ai/
  venv/
  AlphaPose/
    scripts/demo_inference.py
    pretrained_models/
      halpe26_fast_res50_256x192.pth
  MotionBERT/
    infer_wild.py
    checkpoint/
      pose3d/
        FT_MB_lite_MB_ft_h36m_global_lite/
          best_epoch.bin
```

`API\detect_movement`などMONBLAN本体の処理はリポジトリ側に保持する。

## 学習済みモデル

### AlphaPose

「公式ページ」から `halpe26_fast_res50_256x192.pth` を取得し、AlphaPoseモデルの「ファイルを選択」から配置する。ファイル名と形式が異なるモデルは選択しない。

### MotionBERT

「公式ページ」から `best_epoch.bin` を取得し、MotionBERTモデルの「ファイルを選択」から配置する。配置時には公式配布ファイルのSHA-256を検証し、一致しないファイルは受け付けない。

## セットアップに失敗した場合

- 画面下部の「実行ログ」を開き、最初に表示されたエラーを確認する。
- Pythonが見つからない場合はPython 3.11をインストールし、アプリを再起動してから再確認する。
- `git was not found`と表示された場合はGit for Windowsをインストールし、アプリを再起動する。
- パッケージ取得に失敗した場合はネットワーク接続と空き容量を確認し、同じ手順を再実行する。
- モデルを選択できない場合は、指定された拡張子と公式配布元を確認する。
- MotionBERTモデルのハッシュが一致しない場合は、そのファイルを使用せず公式ページから再取得する。
- API再接続後も利用可能にならない場合は、不足表示の項目を確認してから「AI APIを起動・再接続」を再実行する。

セットアップ途中で失敗しても、手動アノテーション機能は利用できる。既存環境を削除する前に、実行ログと表示された保存先を記録する。

## 手動セットアップと開発者向けスクリプト

以降は、画面からセットアップできない場合の復旧や開発時の確認に使用する。通常利用では実行不要である。引数を省略したスクリプトはリポジトリの`API`配下を対象にするため、画面と同じ保存先を操作する場合は`-AiRoot`を明示する。

## Python環境

リポジトリルートから作業する。

補助スクリプトを使う場合は以下を実行する。

```powershell
.\scripts\setup-python-env.ps1
```

既存の `API\venv` を作り直す場合は `-Force` を付ける。

```powershell
.\scripts\setup-python-env.ps1 -Force
```

venv作成だけ確認し、依存インストールを後で行う場合は `-SkipInstall` を付ける。

```powershell
.\scripts\setup-python-env.ps1 -SkipInstall
```

手動で作業する場合は以下を実行する。

```powershell
cd C:\path\to\MONBLAN
py -3.11 -m venv API\venv
API\venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -r API\requirements.txt
```

セットアップは動作確認済みバージョンを固定した`API\requirements-lock.txt`を使用する。`torch==2.3.0+cu118`と`torchvision==0.18.0+cu118`はCUDAが利用できない場合もCPU実行に使用できる。

## AlphaPose

`API\AlphaPose` にAlphaPoseを配置する。

アプリの「AI環境セットアップ」画面を使用する場合は、「AlphaPose本体を取得」の「取得」を押すと、専用のAI環境保存先へ公式リポジトリを取得できる。

補助スクリプトを使う場合は以下を実行する。

```powershell
.\scripts\fetch-ai-repos.ps1 -SkipMotionBert
```

既に `API\AlphaPose` がある場合、既定では上書きしない。作り直す場合は `-Force` を付ける。

```powershell
cd API
git clone https://github.com/MVIG-SJTU/AlphaPose.git AlphaPose
```

その後、AlphaPoseの公式手順に従って依存関係とモデルを用意する。MONBLAN側の環境診断では、少なくとも以下を確認する。

アプリのセットアップ画面では「公式ページ」から配布ページを開き、ダウンロードした `halpe26_fast_res50_256x192.pth` を「ファイルを選択」で専用AI環境へ配置できる。AlphaPoseの利用条件を確認したうえで取得すること。

- `API\AlphaPose`
- `API\AlphaPose\scripts\demo_inference.py`
- `API\AlphaPose\pretrained_models\halpe26_fast_res50_256x192.pth`

## MotionBERT

`API\MotionBERT` にMotionBERTを配置する。

アプリの「AI環境セットアップ」画面を使用する場合は、「MotionBERT本体を取得」の「取得」を押すと、専用のAI環境保存先へ公式リポジトリを取得できる。

補助スクリプトを使う場合は以下を実行する。

```powershell
.\scripts\fetch-ai-repos.ps1 -SkipAlphaPose
```

既に `API\MotionBERT` がある場合、既定では上書きしない。作り直す場合は `-Force` を付ける。

```powershell
cd API
git clone https://github.com/Walter0807/MotionBERT.git MotionBERT
```

MotionBERTの重みは以下に配置する。

```text
API\MotionBERT\checkpoint\pose3d\FT_MB_lite_MB_ft_h36m_global_lite\best_epoch.bin
```

アプリのセットアップ画面では「公式ページ」からHugging Face上の公式配布ファイルを開き、ダウンロードした `best_epoch.bin` を「ファイルを選択」で専用AI環境へ配置できる。配置時には公式ファイルのSHA-256と照合する。

MONBLAN側の環境診断では、少なくとも以下を確認する。

- `API\MotionBERT`
- `API\MotionBERT\infer_wild.py`
- `API\MotionBERT\checkpoint\pose3d\FT_MB_lite_MB_ft_h36m_global_lite\best_epoch.bin`

## detect_movement

`API\detect_movement` はこのプロジェクト側の処理として利用する。環境診断では以下を確認する。

- `API\detect_movement`
- `API\detect_movement\npy2csv.py`
- `API\detect_movement\calc_keypoint_cross_product_rotate.py`
- `API\detect_movement\detect_movement.py`

## 環境診断

Python環境を有効化した状態で、以下を実行する。

まずは補助スクリプトを使う。

```powershell
.\scripts\check-ai-environment.ps1
```

既定では、Electronアプリと同じく `MONBLAN_PYTHON` があればそれを使い、なければ `python` を使う。旧環境との互換用に `ANNOTATION_TOOL_PYTHON` も認識する。`API\venv` を明示的に使う場合は以下を指定する。

```powershell
.\scripts\check-ai-environment.ps1 -UseVenv
```

別のPythonを明示する場合は以下のように指定する。

```powershell
.\scripts\check-ai-environment.ps1 -PythonPath C:\path\to\python.exe
```

JSONとして確認したい場合は以下を使う。

```powershell
.\scripts\check-ai-environment.ps1 -Json
```

Pythonから直接確認する場合は以下を実行する。

```powershell
python -c "from API.environment import check_environment; import json; print(json.dumps(check_environment(), ensure_ascii=False, indent=2))"
```

`ai_available` が `true` であれば、AI自動アノテーション機能を使える状態。

`false` の場合は `missing` に不足項目が出る。主な対応は以下。

| missing の name         | 対応                                                             |
| ----------------------- | ---------------------------------------------------------------- |
| `AlphaPose directory`   | `API\AlphaPose` を配置する                                       |
| `AlphaPose script`      | AlphaPose の配置内容を確認する                                   |
| `AlphaPose checkpoint`  | `halpe26_fast_res50_256x192.pth` を指定パスに配置する            |
| `MotionBERT directory`  | `API\MotionBERT` を配置する                                      |
| `MotionBERT script`     | MotionBERT の配置内容を確認する                                  |
| `MotionBERT checkpoint` | `best_epoch.bin` を指定パスに配置する                            |
| `CUDA / PyTorch`        | PyTorchを必須確認し、CUDA・GPUが利用できない場合は警告を表示する |

## API起動確認

```powershell
python -m uvicorn API.api:app --host 127.0.0.1 --port 8000
```

別のPowerShellで軽量検証を実行する。

```powershell
.\scripts\verify-ai-pipeline.ps1
```

サンプル動画でフレームレート取得まで確認する場合は以下を実行する。

```powershell
.\scripts\verify-ai-pipeline.ps1 -SampleVideoPath C:\path\to\sample.mp4
```

別のPowerShellで確認する。

```powershell
Invoke-RestMethod http://127.0.0.1:8000/environment/
```

動画ファイルのパス方式が使えるか確認する。

```powershell
Invoke-RestMethod `
  -Uri http://127.0.0.1:8000/get_framerate_from_path/ `
  -Method Post `
  -ContentType "application/json" `
  -Body '{"file_path":"C:\\path\\to\\sample.mp4"}'
```

## 既知の注意点

- 日本語や空白を含むパスは、外部AIスクリプト側で問題になる可能性がある。まずは英数字のみの短いパスで確認する。
- `mmcv` / `mmdet` / `mmengine` は PyTorch / CUDA と組み合わせ依存が強い。importエラーが出る場合はバージョン整合性を確認する。
- `torch.cuda.is_available()` が `false` の場合、NVIDIAドライバ、PyTorch CUDA版、GPU認識を順に確認する。
- AlphaPose / MotionBERT の公式リポジトリ構成が変わった場合、`API\paths.py` と `API\environment.py` の診断パスも見直す。
- AI処理中に元動画ファイルを移動・削除すると、ファイルパス方式のAPIは失敗する。

## 補助スクリプト一覧

画面操作の内部処理や開発時の確認には、以下のスクリプトを使用する。

- `check-ai-environment.ps1`: 実装済み。現在の環境診断を実行して不足項目を表示する
- `setup-python-env.ps1`: 実装済み。venv 作成と `requirements.txt` インストール
- `fetch-ai-repos.ps1`: 実装済み。AlphaPose / MotionBERT の取得補助
- `verify-ai-pipeline.ps1`: 実装済み。サンプル動画で `/environment/` と軽量APIを確認する
