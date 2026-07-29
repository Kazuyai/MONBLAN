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

## Electron連携

Electron開発起動時は、メインプロセスがAPIサーバーを自動起動します。

起動コマンド:

```powershell
python -m uvicorn API.api:app --host 127.0.0.1 --port 8000
```

実装上の前提:

- Electronの `child_process.spawn` からAPIを起動する
- `cwd` はリポジトリルートに固定する
- 既に `127.0.0.1:8000` でAPIが起動している場合は、そのプロセスを再利用する
- Python実行ファイルは既定で `python` を使う
- 別のPythonを使う場合は `ANNOTATION_TOOL_PYTHON` 環境変数で指定できる

renderer側は preload 経由でAPI状態を受け取ります。

- `getApiStatus()` で現在のAPI状態を取得する
- `onApiStatusChanged()` で状態変更通知を受け取る
- `aiAvailable === true` の場合のみ自動アノテーション操作を有効にする
- `aiAvailable !== true` の場合は不足項目を表示し、通常アノテーション機能は維持する

アプリ終了時は、Electronが起動したAPIプロセスを停止します。ユーザーが事前に起動していたAPIプロセスはElectron管理外として扱います。

### 開発時の確認結果

`yarn dev` からの起動で以下を確認済みです。

- Electron起動時にFastAPIが自動起動する
- `GET /environment/` が `200 OK` を返す
- 動画ファイル選択時に `POST /get_framerate/` が `200 OK` を返す
- アプリの×ボタン終了後、Electronが起動したAPIプロセスが残らない
