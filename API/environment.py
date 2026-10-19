"""AI実行環境の診断ユーティリティ。

Electron側は check_environment() の ai_available を見て、自動アノテーションUIを
有効化するか判断する。依存が不足していても例外で落とさず、missing に不足項目を返す。
"""

import os
import sys
from typing import Any

try:
    from .paths import (
        ALPHAPOSE_CHECKPOINT,
        ALPHAPOSE_DETECTOR_CHECKPOINT,
        ALPHAPOSE_DIR,
        ALPHAPOSE_TRACKER_CHECKPOINT,
        DETECT_MOVEMENT_DIR,
        MOTIONBERT_CHECKPOINT,
        MOTIONBERT_DIR,
    )
except ImportError:
    from paths import (
        ALPHAPOSE_CHECKPOINT,
        ALPHAPOSE_DETECTOR_CHECKPOINT,
        ALPHAPOSE_DIR,
        ALPHAPOSE_TRACKER_CHECKPOINT,
        DETECT_MOVEMENT_DIR,
        MOTIONBERT_CHECKPOINT,
        MOTIONBERT_DIR,
    )


def _path_status(
    name: str,
    path: str,
    kind: str,
    category: str,
    group: str,
) -> dict[str, Any]:
    """ファイルまたはディレクトリの存在確認結果を、UIで扱いやすい辞書にする。"""
    exists = os.path.isdir(path) if kind == "directory" else os.path.isfile(path)
    return {
        "name": name,
        "path": path,
        "kind": kind,
        "category": category,
        "group": group,
        "exists": exists,
        "ok": exists,
    }


def _cuda_status() -> dict[str, Any]:
    """PyTorchとCUDAが利用できるか確認する。PyTorch未導入でも例外は外へ出さない。"""
    try:
        import torch
    except Exception as error:
        return {
            "name": "CUDA / PyTorch",
            "category": "runtime",
            "group": "cuda-pytorch",
            "ok": False,
            "available": False,
            "error": f"PyTorch import failed: {error}",
        }

    available = bool(torch.cuda.is_available())
    return {
        "name": "CUDA / PyTorch",
        "category": "runtime",
        "group": "cuda-pytorch",
        "ok": available,
        "available": available,
        "torch_version": getattr(torch, "__version__", None),
        "cuda_version": getattr(torch.version, "cuda", None),
        "device_count": torch.cuda.device_count() if available else 0,
    }


def check_environment() -> dict[str, Any]:
    """AIパイプライン実行に必要なディレクトリ・スクリプト・重み・CUDAを確認する。"""
    checks = [
        _path_status("Python executable", sys.executable, "file", "runtime", "python"),
        _path_status("AlphaPose directory", ALPHAPOSE_DIR, "directory", "external", "alphapose"),
        _path_status(
            "AlphaPose script",
            os.path.join(ALPHAPOSE_DIR, "scripts", "demo_inference.py"),
            "file",
            "external",
            "alphapose",
        ),
        _path_status("AlphaPose checkpoint", ALPHAPOSE_CHECKPOINT, "file", "external", "alphapose-model"),
        _path_status(
            "AlphaPose detector checkpoint",
            ALPHAPOSE_DETECTOR_CHECKPOINT,
            "file",
            "external",
            "alphapose-detector-model",
        ),
        _path_status(
            "AlphaPose tracker checkpoint",
            ALPHAPOSE_TRACKER_CHECKPOINT,
            "file",
            "external",
            "alphapose-tracker-model",
        ),
        _path_status("MotionBERT directory", MOTIONBERT_DIR, "directory", "external", "motionbert"),
        _path_status(
            "MotionBERT script",
            os.path.join(MOTIONBERT_DIR, "infer_wild.py"),
            "file",
            "external",
            "motionbert",
        ),
        _path_status("MotionBERT checkpoint", MOTIONBERT_CHECKPOINT, "file", "external", "motionbert-model"),
        _path_status(
            "detect_movement directory",
            DETECT_MOVEMENT_DIR,
            "directory",
            "bundled",
            "application-files",
        ),
        _path_status(
            "npy2csv script",
            os.path.join(DETECT_MOVEMENT_DIR, "npy2csv.py"),
            "file",
            "bundled",
            "application-files",
        ),
        _path_status(
            "cross product script",
            os.path.join(DETECT_MOVEMENT_DIR, "calc_keypoint_cross_product_rotate.py"),
            "file",
            "bundled",
            "application-files",
        ),
        _path_status(
            "movement detection script",
            os.path.join(DETECT_MOVEMENT_DIR, "detect_movement.py"),
            "file",
            "bundled",
            "application-files",
        ),
        _path_status(
            "MotionBERT Windows runner",
            os.path.join(os.path.dirname(__file__), "motionbert_runner.py"),
            "file",
            "bundled",
            "application-files",
        ),
        _path_status(
            "AlphaPose compatibility runner",
            os.path.join(os.path.dirname(__file__), "alphapose_runner.py"),
            "file",
            "bundled",
            "application-files",
        ),
        _cuda_status(),
    ]

    missing = [check for check in checks if not check["ok"]]
    return {
        "ai_available": not missing,
        "checks": checks,
        "missing": missing,
    }
