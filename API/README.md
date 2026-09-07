# Annotation Tool API

AI環境のセットアップ手順は `../docs/setup-ai-environment.md` を参照してください。
配布方針は `../docs/distribution-policy.md` を参照してください。

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
Electronアプリからは、動画全体のアップロードを避けるため `POST /get_framerate_from_path/` を優先します。

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

### `POST /get_framerate_from_path/`

ローカル動画ファイルのパスを受け取り、OpenCV でフレームレートを返します。Electronアプリ向けの高速経路です。

PowerShell例:

```powershell
Invoke-RestMethod `
  -Uri http://127.0.0.1:8000/get_framerate_from_path/ `
  -Method Post `
  -ContentType "application/json" `
  -Body '{"file_path":"C:\\path\\to\\sample.mp4"}'
```

レスポンス例:

```json
{
  "frame_rate": 30.0
}
```

### `POST /get_human_images/`

AlphaPose を実行し、動画内人物の切り出し画像を Base64 文字列の配列として返します。AI環境が未セットアップの場合は失敗します。
Electronアプリからは、動画全体のアップロードを避けるため `POST /get_human_images_from_path/` を優先します。

### `POST /get_human_images_from_path/`

ローカル動画ファイルのパスを受け取り、AlphaPose を実行して人物の切り出し画像を返します。Electronアプリ向けの高速経路です。

### `POST /items/`

AlphaPose、MotionBERT、detect_movement の一連の自動アノテーションパイプラインを実行します。AI環境が未セットアップの場合は失敗します。
Electronアプリからは、動画全体のアップロードを避けるため `POST /items_from_path/` を優先します。

### `POST /items_from_path/`

ローカル動画ファイルのパスと自動アノテーション設定を受け取り、AlphaPose、MotionBERT、detect_movement の一連の自動アノテーションパイプラインを実行します。Electronアプリ向けの高速経路です。

### `POST /similar_motion_from_path/`

利用者が選択した人物、関節、テンプレート区間を基に、v40のDTW類似動作検出を実行します。AlphaPoseとMotionBERTで選択人物の3次元姿勢を生成し、`detect_movement/similarity_detection.py` の検出器へ渡します。既存の自動動作検出とは異なり、CSV変換・外積CSV計算・`detect_movement.py` は実行しません。

リクエスト例:

```json
{
  "file_path": "C:\\path\\to\\video.mp4",
  "humanId": 0,
  "selectedJoints": [14, 15],
  "templateSegments": [
    {"startFrame": 153, "endFrame": 177}
  ],
  "layerName": "右 右腕の動き",
  "layerIndex": 2
}
```

レスポンス例:

```json
{
  "candidates": [
    {
      "startFrame": 240,
      "endFrame": 264,
      "text": "類似候補 1",
      "layerName": "右 右腕の動き",
      "layerIndex": 2,
      "humanId": 0,
      "similarity": 0.92,
      "dtwSimilarity": 0.88,
      "templateId": 0,
      "windowScale": 1.0,
      "windowLength": 24
    }
  ],
  "stats": {
    "templates": 1,
    "filteredResults": 1
  },
  "parameters": {
    "algorithm": "v40_dtw_pure_refined",
    "searchStartFrame": null,
    "searchEndFrame": null
  }
}
```

- `humanId` は人物選択UIの0始まりのIDである。MotionBERTへは内部で1始まりの`focus`として渡す。
- `selectedJoints` は選択可能な10関節のIDを指定する。
- `templateSegments` はタイムライン上のテンプレート区間であり、開始・終了フレームをともに含む。既存の自動動作検出に合わせてフレーム番号は1始まりである。
- テンプレート区間と重なる検出結果は候補から除外される。
- `searchStartFrame` と `searchEndFrame` は任意項目である。指定した場合、候補はこの範囲内に収まる区間だけに絞り込まれる。通常の注釈補完UIでは未指定とし、部分分析機能で使用する想定である。
- レスポンスの`startFrame`と`endFrame`も1始まりであり、既存の自動動作検出と同じ規約である。
- レスポンスの`candidates`は仮注釈候補である。UI側で利用者が確認してから正式な注釈として追加する。

## AlphaPose結果の再利用

Electronアプリが利用する `*_from_path` 系エンドポイントでは、動画パス・ファイルサイズ・更新時刻をキーにして AlphaPose の `alphapose-results.json` を一時ディレクトリへキャッシュします。

- `/get_human_images_from_path/` で人物画像取得を行った後、同じ動画に対して `/items_from_path/` または `/similar_motion_from_path/` を実行した場合、AlphaPose は再実行せず既存結果を再利用します。
- 通常のアップロード系エンドポイント `/get_human_images/` と `/items/` は、一時アップロードファイルを使うためキャッシュ対象外です。
- 動画ファイルが更新されると、サイズまたは更新時刻が変わるため別キャッシュとして扱います。
- キャッシュはOSの一時ディレクトリ配下 `annotation-tool-alphapose-cache` に保存され、APIプロセス終了時には自動削除されません。不要になった場合は手動削除できます。
- ログには `alphapose_cache_hit=True/False` が出力され、再利用されたか確認できます。

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

必要に応じてサンプル動画でフレームレート取得を確認します。Electronアプリと同じパス方式を優先します。

```powershell
Invoke-RestMethod `
  -Uri http://127.0.0.1:8000/get_framerate_from_path/ `
  -Method Post `
  -ContentType "application/json" `
  -Body '{"file_path":"C:\\path\\to\\sample.mp4"}'
```

類似動作検出はElectron UIから確認します。

- 動画を開き、テンプレートにする既存注釈を1つ選択する。
- 「注釈補完」タブで人物・関節を選択し、類似候補を検出する。
- テンプレート区間と重なる候補が表示されないことを確認する。
- 候補の個別挿入・削除、一括挿入、Undo/Redoが動作することを確認する。
- 先に `/get_human_images_from_path/` を実行していた場合、APIログに `alphapose_cache_hit=True` が出ることを確認する。

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
- 動画ファイル選択時に `POST /get_framerate_from_path/` が `200 OK` を返す
- アプリの×ボタン終了後、Electronが起動したAPIプロセスが残らない
