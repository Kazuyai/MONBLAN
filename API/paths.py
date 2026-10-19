"""API内で利用するパス定数。

外部AIリポジトリや重みファイルは再配布しない前提のため、配置確認は environment.py で行う。
パスは起動ディレクトリではなく、このファイルの位置を基準に解決する。
"""

import os

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

# 配布版では書き込み可能な外部ディレクトリを指定できるようにする。
# 未指定時は従来どおりAPIディレクトリ配下を使用し、既存の開発環境を維持する。
AI_HOME = os.path.abspath(os.environ.get("ANNOTATION_TOOL_AI_HOME", BASE_DIR))

ALPHAPOSE_DIR = os.path.join(AI_HOME, "AlphaPose")
MOTIONBERT_DIR = os.path.join(AI_HOME, "MotionBERT")
DETECT_MOVEMENT_DIR = os.path.join(BASE_DIR, "detect_movement")
OUT_DIR = os.path.join(BASE_DIR, "out")

# AlphaPoseは非商用ライセンスのため同梱せず、ユーザーが公式手順で配置する想定。
ALPHAPOSE_CHECKPOINT = os.path.join(
    ALPHAPOSE_DIR,
    "pretrained_models",
    "halpe26_fast_res50_256x192.pth",
)
ALPHAPOSE_DETECTOR_CHECKPOINT = os.path.join(
    ALPHAPOSE_DIR,
    "detector",
    "yolo",
    "data",
    "yolov3-spp.weights",
)
ALPHAPOSE_TRACKER_CHECKPOINT = os.path.join(
    ALPHAPOSE_DIR,
    "trackers",
    "weights",
    "osnet_ain_x1_0_msmt17_256x128_amsgrad_ep50_lr0.0015_coslr_b64_fb10_softmax_labsmth_flip_jitter.pth",
)

# MotionBERT infer_wild.py のデフォルト評価重み。実行時にも明示指定して診断結果と揃える。
MOTIONBERT_CHECKPOINT = os.path.join(
    MOTIONBERT_DIR,
    "checkpoint",
    "pose3d",
    "FT_MB_lite_MB_ft_h36m_global_lite",
    "best_epoch.bin",
)
