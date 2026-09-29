# Public Release Checklist

このチェックリストは、Annotation Tool をpublicリポジトリまたは配布物として公開する前に確認する項目をまとめる。

## 前提

- このプロジェクトは研究用途を想定する。
- 手動アノテーション機能とAI自動アノテーション機能を分けて説明する。
- AI自動アノテーション機能は、追加セットアップが必要な任意機能として扱う。
- 未検証のOSや環境を正式対応として記載しない。
- このドキュメントは技術的な確認項目であり、法的助言ではない。

## リポジトリに含めないもの

公開前に、以下がGit管理されていないことを確認する。

```bash
git ls-files API/AlphaPose API/MotionBERT API/venv API/out release dist
```

空であることを期待する。

含めないもの:

- `API/AlphaPose/`
- `API/MotionBERT/`
- AlphaPose checkpoint
- MotionBERT checkpoint
- `API/venv/`
- `API/out/`
- `release/`
- `dist/`
- 実行ログ
- 一時ジョブディレクトリ
- 動画データ、研究データ、個人情報を含むデータ

## ignore設定の確認

代表的なパスがignoreされることを確認する。

```bash
git check-ignore -v \
  API/AlphaPose/scripts/demo_inference.py \
  API/MotionBERT/checkpoint/pose3d/model.bin \
  API/out/result.json \
  API/venv/pyvenv.cfg \
  release/app.exe \
  dist/main/main.js \
  API/foo.pth \
  API/foo.npy
```

## README確認

READMEに以下が明記されていることを確認する。

- ツールの目的
- 手動アノテーション機能はAI環境なしでも使える方針
- AI自動アノテーション機能は追加セットアップ必須
- Windows + NVIDIA GPU + CUDA がAI機能の正式対象
- macOSは現時点でAI機能非対応扱い
- AlphaPose / MotionBERT / checkpoint は同梱しない
- 外部AIリポジトリ・モデル重みのライセンスは本体ライセンスと別
- `docs/setup-ai-environment.md` への導線
- `docs/distribution-policy.md` への導線

## ライセンス確認

公開前に以下を確認する。

- `package.json` の `license` が意図した本体ライセンスになっている
- 必要であれば `LICENSE` ファイルを追加する
- AlphaPose、MotionBERT、各checkpointを本体ライセンスの対象として説明していない
- AlphaPoseの非商用条件に反する配布説明をしていない
- checkpointの入手元と利用条件を利用者が確認する前提にしている

## 動作確認

公開前に最低限以下を確認する。

```bash
yarn typecheck
yarn lint
yarn build
```

AI環境がある場合は以下も確認する。

```powershell
.\scripts\check-ai-environment.ps1
.\scripts\verify-ai-pipeline.ps1
```

部分分析を含む実機確認は `docs/partial-analysis-verification.md` に沿って行う。

公開または配布候補の版では、既存の開発環境だけでなく、新規クローンまたは新規インストールから次の画面操作も確認する。

- 「AI環境セットアップ」タブから専用保存先を準備できる
- Pythonの確認、専用環境の作成、依存パッケージの導入が完了する
- AlphaPoseとMotionBERTを公式リポジトリから取得できる
- 利用者が公式配布元から取得したモデルを画面から配置できる
- AI APIの再接続後に、AI機能のタブが利用可能になる
- アプリを再起動しても構築済み環境が認識される
- セットアップ失敗時に実行ログが表示され、手動アノテーション機能は継続利用できる

確認する動作:

- アプリが起動する
- 動画を開ける
- フレームレートを取得できる
- 手動アノテーションを追加、編集、削除できる
- CSVをエクスポートできる
- EAFをエクスポートできる
- AI環境がない場合、AI機能だけが無効またはエラー表示になり、手動アノテーション機能は使える
- AI環境がある場合、`get_human_images` と `items` が成功する

## 公開しない情報

以下をREADME、issue、ログ、サンプルデータに含めない。

- 個人情報
- 未公開研究データ
- ローカル環境固有の絶対パス
- アクセストークン、APIキー、認証情報
- 再配布できないモデル重み
- ライセンス上同梱できない外部コード
