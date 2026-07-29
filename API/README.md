# Annotation Tool API

Annotation Tool の FastAPI バックエンドです。Electron 連携では、この API をローカルプロセスとして起動し、AI 自動アノテーション機能だけが依存します。通常の手動アノテーション機能は API が利用できない場合でも動作可能にする方針です。

## 起動コマンド

リポジトリルートから以下を実行します。

```powershell
python -m uvicorn API.api:app --host 127.0.0.1 --port 8000
```

この起動方法を標準とします。理由は以下です。

- venv の Python と uvicorn の対応が明確になる
- Electron メインプロセスから `cwd` をリポジトリルートに固定して起動しやすい
- `API` ディレクトリを Python パッケージとして扱える
- `paths.py` は `__file__` 基準のため、起動ディレクトリに依存しない

## エンドポイント

### `GET /environment/`

AI 実行環境の診断結果を返します。Electron 側はこのレスポンスの `ai_available` を見て、自動アノテーション機能の有効・無効を判断します。

レスポンス例:

```json
{
  "ai_available": false,
  "checks": [
    {
      "name": "AlphaPose directory",
      "path": "C:\\...\\API\\AlphaPose",
      "kind": "directory",
      "exists": false,
      "ok": false
    }
  ],
  "missing": [
    {
      "name": "AlphaPose directory",
      "path": "C:\\...\\API\\AlphaPose",
      "kind": "directory",
      "exists": false,
      "ok": false
    }
  ]
}
```

主なチェック項目:

- Python executable
- AlphaPose directory / script / checkpoint
- MotionBERT directory / script / checkpoint
- detect_movement directory / scripts
- CUDA / PyTorch

### `POST /get_framerate/`

動画ファイルを受け取り、OpenCV でフレームレートを返します。API疎通確認に使う最も軽い動画系エンドポイントです。

PowerShell例:

```powershell
Invoke-RestMethod `
  -Uri http://127.0.0.1:8000/get_framerate/ `
  -Method Post `
  -Form @{ file = Get-Item "C:\\path\\to\\sample.mp4" }
```

レスポンス例:

```json
{
  "frame_rate": 30.0
}
```

### `POST /get_human_images/`

AlphaPose を実行し、動画内人物の切り出し画像を Base64 文字列の配列として返します。AI環境が未セットアップの場合は失敗します。

### `POST /items/`

AlphaPose、MotionBERT、detect_movement の一連の自動アノテーションパイプラインを実行します。AI環境が未セットアップの場合は失敗します。

## 手動確認手順

### 1. 構文と import の確認

```powershell
python -m py_compile API\__init__.py API\api.py API\paths.py API\pipeline.py API\environment.py
python -c "import API.api; import API.pipeline; import API.environment; print('package imports ok')"
```

### 2. 環境診断の直接確認

```powershell
python -c "from API.environment import check_environment; import json; print(json.dumps(check_environment(), ensure_ascii=False, indent=2))"
```

AlphaPose、MotionBERT、checkpoint、CUDA のいずれかが不足していても、このコマンド自体は例外で落ちず、`ai_available: false` と `missing` を返す必要があります。

### 3. APIサーバー経由の確認

別ターミナルでAPIを起動します。

```powershell
python -m uvicorn API.api:app --host 127.0.0.1 --port 8000
```

環境診断を確認します。

```powershell
Invoke-RestMethod http://127.0.0.1:8000/environment/
```

必要に応じてサンプル動画でフレームレート取得を確認します。

```powershell
Invoke-RestMethod `
  -Uri http://127.0.0.1:8000/get_framerate/ `
  -Method Post `
  -Form @{ file = Get-Item "C:\\path\\to\\sample.mp4" }
```

## 失敗時のログ

AIパイプラインのサブプロセスが失敗した場合、ジョブディレクトリは削除せず、デバッグ用に保持します。

保存先:

```text
%TEMP%\annotation-tool-jobs\<job-id>\
```

主な保存内容:

- `<step>_stdout.log`
- `<step>_stderr.log`
- 中間生成ファイル

成功時のジョブディレクトリは自動削除されます。

## Phase 2 での利用方針

Electron 側では以下の順で扱います。

1. Electron メインプロセスからAPIを起動する
2. `GET /environment/` を呼ぶ
3. `ai_available === true` の場合のみ自動アノテーションUIを有効化する
4. `ai_available === false` の場合でも通常アノテーション機能は利用可能にする
5. Electron終了時にAPIプロセスを停止する
