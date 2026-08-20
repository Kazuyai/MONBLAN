# AI環境セットアップ手順

このドキュメントは、Annotation Tool のAI自動アノテーション機能をローカル環境で動かすための手順をまとめる。

## 対象環境

現時点では、以下の環境を優先対象とする。

- Windows
- NVIDIA GPU
- CUDA 11.8 系
- Python 3.11 または 3.12
- PyTorch 2.3.0 + CUDA 11.8

Docker 前提にはしない。AlphaPose / MotionBERT / OpenMMLab 系の依存は環境差が大きいため、まずは手順を明文化し、安定してから必要に応じてスクリプト化する。

## 配置方針

AI関連の外部リポジトリと重みファイルは `API` ディレクトリ配下に置く。

```text
API/
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
  detect_movement/
    npy2csv.py
    calc_keypoint_cross_product_rotate.py
    detect_movement.py
  requirements.txt
```

AlphaPose は非商用ライセンスのため、このリポジトリには同梱しない。利用者が公式リポジトリから取得する。

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
cd C:\ProgrammingPractice\GitHub\Annotation-Tool
py -3.11 -m venv API\venv
API\venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -r API\requirements.txt
```

`API\requirements.txt` は `torch==2.3.0+cu118` を含む。CUDA 11.8 以外の環境では、PyTorch / torchvision / torchaudio の組み合わせを見直す必要がある。

## AlphaPose

`API\AlphaPose` にAlphaPoseを配置する。

補助スクリプトを使う場合は以下を実行する。

```powershell
.\scripts\fetch-ai-repos.ps1 -SkipMotionBert
```

既に `API\AlphaPose` がある場合、既定では上書きしない。作り直す場合は `-Force` を付ける。

```powershell
cd API
git clone https://github.com/MVIG-SJTU/AlphaPose.git AlphaPose
```

その後、AlphaPoseの公式手順に従って依存関係とモデルを用意する。Annotation Tool 側の環境診断では、少なくとも以下を確認する。

- `API\AlphaPose`
- `API\AlphaPose\scripts\demo_inference.py`
- `API\AlphaPose\pretrained_models\halpe26_fast_res50_256x192.pth`

## MotionBERT

`API\MotionBERT` にMotionBERTを配置する。

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

Annotation Tool 側の環境診断では、少なくとも以下を確認する。

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

既定では、Electronアプリと同じく `ANNOTATION_TOOL_PYTHON` があればそれを使い、なければ `python` を使う。`API\venv` を明示的に使う場合は以下を指定する。

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

| missing の name | 対応 |
| --- | --- |
| `AlphaPose directory` | `API\AlphaPose` を配置する |
| `AlphaPose script` | AlphaPose の配置内容を確認する |
| `AlphaPose checkpoint` | `halpe26_fast_res50_256x192.pth` を指定パスに配置する |
| `MotionBERT directory` | `API\MotionBERT` を配置する |
| `MotionBERT script` | MotionBERT の配置内容を確認する |
| `MotionBERT checkpoint` | `best_epoch.bin` を指定パスに配置する |
| `CUDA / PyTorch` | PyTorch CUDA版、NVIDIAドライバ、CUDA互換性を確認する |

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

## 今後の自動化候補

手順が安定した後、以下を分離してスクリプト化する。

- `check-ai-environment.ps1`: 実装済み。現在の環境診断を実行して不足項目を表示する
- `setup-python-env.ps1`: 実装済み。venv 作成と `requirements.txt` インストール
- `fetch-ai-repos.ps1`: 実装済み。AlphaPose / MotionBERT の取得補助
- `verify-ai-pipeline.ps1`: 実装済み。サンプル動画で `/environment/` と軽量APIを確認する
