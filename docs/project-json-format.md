# Project JSON Format

Annotation Tool のプロジェクトJSONは、作業途中の注釈状態を保存し、後から再編集するための形式です。
CSV/EAF は外部ツール向けの成果物出力、プロジェクトJSONはこのアプリ向けの再開用データとして扱います。

## 対象

- 動画ファイル情報
- フレームレート
- 動画長
- 注釈レイヤー名
- 注釈データ

## 保存しないもの

- Undo/Redo履歴
- 現在の再生状態
- 選択中の注釈
- 選択範囲
- 類似動作候補
- AI処理中の状態

## スキーマ

```json
{
  "version": 1,
  "createdAt": "2026-09-04T00:00:00.000Z",
  "updatedAt": "2026-09-04T00:00:00.000Z",
  "videos": [
    {
      "name": "sample.mp4",
      "path": "C:\\videos\\sample.mp4"
    }
  ],
  "frameRate": 29.97,
  "videoDuration": 120.5,
  "layerNames": ["レイヤー1"],
  "annotations": [
    {
      "id": "annotation-id",
      "startFrame": 1,
      "endFrame": 30,
      "text": "注釈",
      "layerIndex": 0
    }
  ]
}
```

## 注意点

- `path` にはローカル動画ファイルの絶対パスが入るため、他者と共有する場合は個人情報や研究データのパスが含まれないか確認する。
- 別PCで読み込む場合、保存された動画パスが存在しない可能性がある。その場合は動画ファイルを開き直す。
- `version` は今後の形式変更に備えた互換性管理用の値。
- `frameRate` が誤っていると、注釈の時間表示やエクスポート結果もずれる。
