"""Path constants for the annotation API."""

import os

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

ALPHAPOSE_DIR = os.path.join(BASE_DIR, "AlphaPose")
MOTIONBERT_DIR = os.path.join(BASE_DIR, "MotionBERT")
DETECT_MOVEMENT_DIR = os.path.join(BASE_DIR, "detect_movement")
OUT_DIR = os.path.join(BASE_DIR, "out")

ALPHAPOSE_CHECKPOINT = os.path.join(
    ALPHAPOSE_DIR,
    "pretrained_models",
    "halpe26_fast_res50_256x192.pth",
)
MOTIONBERT_CHECKPOINT = os.path.join(
    MOTIONBERT_DIR,
    "checkpoint",
    "pose3d",
    "FT_MB_lite_MB_ft_h36m_global_lite",
    "best_epoch.bin",
)
