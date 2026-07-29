"""API内で利用するパス定数。

外部AIリポジトリや重みファイルは再配布しない前提のため、配置確認は environment.py で行う。
パスは起動ディレクトリではなく、このファイルの位置を基準に解決する。
"""

import os

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

ALPHAPOSE_DIR = os.path.join(BASE_DIR, "AlphaPose")
MOTIONBERT_DIR = os.path.join(BASE_DIR, "MotionBERT")
DETECT_MOVEMENT_DIR = os.path.join(BASE_DIR, "detect_movement")
OUT_DIR = os.path.join(BASE_DIR, "out")

# AlphaPoseは非商用ライセンスのため同梱せず、ユーザーが公式手順で配置する想定。
ALPHAPOSE_CHECKPOINT = os.path.join(
    ALPHAPOSE_DIR,
    "pretrained_models",
    "halpe26_fast_res50_256x192.pth",
)

# MotionBERT infer_wild.py のデフォルト評価重み。実行時にも明示指定して診断結果と揃える。
MOTIONBERT_CHECKPOINT = os.path.join(
    MOTIONBERT_DIR,
    "checkpoint",
    "pose3d",
    "FT_MB_lite_MB_ft_h36m_global_lite",
    "best_epoch.bin",
)
