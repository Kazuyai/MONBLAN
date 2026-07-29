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
        ALPHAPOSE_DIR,
        DETECT_MOVEMENT_DIR,
        MOTIONBERT_CHECKPOINT,
        MOTIONBERT_DIR,
    )
except ImportError:
    from paths import (
        ALPHAPOSE_CHECKPOINT,
        ALPHAPOSE_DIR,
        DETECT_MOVEMENT_DIR,
        MOTIONBERT_CHECKPOINT,
        MOTIONBERT_DIR,
    )


def _path_status(name: str, path: str, kind: str) -> dict[str, Any]:
    """ファイルまたはディレクトリの存在確認結果を、UIで扱いやすい辞書にする。"""
    exists = os.path.isdir(path) if kind == "directory" else os.path.isfile(path)
    return {
        "name": name,
        "path": path,
        "kind": kind,
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
            "ok": False,
            "available": False,
            "error": f"PyTorch import failed: {error}",
        }

    available = bool(torch.cuda.is_available())
    return {
        "name": "CUDA / PyTorch",
        "ok": available,
        "available": available,
        "torch_version": getattr(torch, "__version__", None),
        "cuda_version": getattr(torch.version, "cuda", None),
        "device_count": torch.cuda.device_count() if available else 0,
    }


def check_environment() -> dict[str, Any]:
    """AIパイプライン実行に必要なディレクトリ・スクリプト・重み・CUDAを確認する。"""
    checks = [
        _path_status("Python executable", sys.executable, "file"),
        _path_status("AlphaPose directory", ALPHAPOSE_DIR, "directory"),
        _path_status("AlphaPose script", os.path.join(ALPHAPOSE_DIR, "scripts", "demo_inference.py"), "file"),
        _path_status("AlphaPose checkpoint", ALPHAPOSE_CHECKPOINT, "file"),
        _path_status("MotionBERT directory", MOTIONBERT_DIR, "directory"),
        _path_status("MotionBERT script", os.path.join(MOTIONBERT_DIR, "infer_wild.py"), "file"),
        _path_status("MotionBERT checkpoint", MOTIONBERT_CHECKPOINT, "file"),
        _path_status("detect_movement directory", DETECT_MOVEMENT_DIR, "directory"),
        _path_status("npy2csv script", os.path.join(DETECT_MOVEMENT_DIR, "npy2csv.py"), "file"),
        _path_status(
            "cross product script",
            os.path.join(DETECT_MOVEMENT_DIR, "calc_keypoint_cross_product_rotate.py"),
            "file",
        ),
        _path_status("movement detection script", os.path.join(DETECT_MOVEMENT_DIR, "detect_movement.py"), "file"),
        _cuda_status(),
    ]

    missing = [check for check in checks if not check["ok"]]
    return {
        "ai_available": not missing,
        "checks": checks,
        "missing": missing,
    }
