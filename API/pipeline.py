"""姿勢推定と動作検出の実行パイプライン。

FastAPIのリクエストごとにジョブディレクトリを作成し、AlphaPose、MotionBERT、
detect_movement の入出力をその中へ閉じ込める。os.chdir() は使わず、
subprocess.run(cwd=...) で各外部スクリプトの作業ディレクトリを指定する。
"""

import base64
import hashlib
import importlib.util
import json
import logging
import os
import shutil
import subprocess
import sys
import tempfile
import threading
import uuid
from typing import Callable

import cv2
import numpy as np

try:
    from .paths import (
        ALPHAPOSE_DIR,
        ALPHAPOSE_DETECTOR_CHECKPOINT,
        ALPHAPOSE_TRACKER_CHECKPOINT,
        DETECT_MOVEMENT_DIR,
        MOTIONBERT_CHECKPOINT,
        MOTIONBERT_DIR,
    )
except ImportError:
    from paths import (
        ALPHAPOSE_DIR,
        ALPHAPOSE_DETECTOR_CHECKPOINT,
        ALPHAPOSE_TRACKER_CHECKPOINT,
        DETECT_MOVEMENT_DIR,
        MOTIONBERT_CHECKPOINT,
        MOTIONBERT_DIR,
    )

logger = logging.getLogger(__name__)

ProgressCallback = Callable[[dict], None]

_SIMILARITY_DETECTOR_CLASS = None
# Existing detect_movement.py returns one-based, inclusive frame ranges.
ANNOTATION_FRAME_INDEX_BASE = 1
MIN_MOVEMENT_ANALYSIS_FRAMES = 5
ALPHAPOSE_CACHE_ROOT = os.path.join(tempfile.gettempdir(), "monblan-alphapose-cache")
MOTIONBERT_CACHE_ROOT = os.path.join(tempfile.gettempdir(), "monblan-motionbert-cache")
SIMILARITY_CACHE_ROOT = os.path.join(tempfile.gettempdir(), "monblan-similarity-cache")
_ALPHAPOSE_CACHE_LOCK = threading.Lock()
_ALPHAPOSE_CACHE_LOCKS: dict[str, threading.Lock] = {}
_MOTIONBERT_CACHE_LOCK = threading.Lock()
_MOTIONBERT_CACHE_LOCKS: dict[str, threading.Lock] = {}
_SIMILARITY_CACHE_LOCK = threading.Lock()
_SIMILARITY_CACHE_LOCKS: dict[str, threading.Lock] = {}


def report_progress(
    progress_callback: ProgressCallback | None,
    *,
    stage: str,
    description: str,
    step: int,
    total_steps: int,
    current_item: int | None = None,
    total_items: int | None = None,
    cache_hit: bool | None = None,
) -> None:
    if progress_callback is None:
        return
    progress_callback(
        {
            "stage": stage,
            "description": description,
            "step": step,
            "totalSteps": total_steps,
            "currentItem": current_item,
            "totalItems": total_items,
            "cacheHit": cache_hit,
        }
    )


def validate_frame_range(
    start_frame: int | None,
    end_frame: int | None,
    *,
    start_name: str,
    end_name: str,
) -> None:
    if start_frame is not None and start_frame < ANNOTATION_FRAME_INDEX_BASE:
        raise ValueError(f"{start_name} must be frame one or greater")
    if end_frame is not None and end_frame < ANNOTATION_FRAME_INDEX_BASE:
        raise ValueError(f"{end_name} must be frame one or greater")
    if start_frame is not None and end_frame is not None and end_frame < start_frame:
        raise ValueError(f"{end_name} must be greater than or equal to {start_name}")


def filter_results_by_frame_range(
    results: list[dict],
    start_frame: int | None,
    end_frame: int | None,
) -> list[dict]:
    if start_frame is None and end_frame is None:
        return results

    filtered_results = []
    for result in results:
        result_start_frame = int(result["startFrame"])
        result_end_frame = int(result["endFrame"])
        if start_frame is not None and result_start_frame < start_frame:
            continue
        if end_frame is not None and result_end_frame > end_frame:
            continue
        filtered_results.append(result)
    return filtered_results


def create_job_dir() -> str:
    """リクエストごとの一時作業ディレクトリを作成する。"""
    job_id = str(uuid.uuid4())
    job_dir = os.path.join(tempfile.gettempdir(), "monblan-jobs", job_id)
    os.makedirs(job_dir, exist_ok=True)
    return job_dir


def cleanup_job_dir(job_dir: str):
    """成功時に不要になったジョブディレクトリを削除する。"""
    if os.path.exists(job_dir):
        shutil.rmtree(job_dir, ignore_errors=True)


def _get_alphapose_cache_key(video_file_path: str) -> str:
    """Create a stable cache key for a local video path and its current file state."""
    resolved_path = os.path.abspath(video_file_path)
    stat = os.stat(resolved_path)
    payload = f"{resolved_path}|{stat.st_size}|{stat.st_mtime_ns}"
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def _get_cache_lock(cache_key: str) -> threading.Lock:
    with _ALPHAPOSE_CACHE_LOCK:
        if cache_key not in _ALPHAPOSE_CACHE_LOCKS:
            _ALPHAPOSE_CACHE_LOCKS[cache_key] = threading.Lock()
        return _ALPHAPOSE_CACHE_LOCKS[cache_key]


def _get_motionbert_cache_lock(cache_key: str) -> threading.Lock:
    with _MOTIONBERT_CACHE_LOCK:
        if cache_key not in _MOTIONBERT_CACHE_LOCKS:
            _MOTIONBERT_CACHE_LOCKS[cache_key] = threading.Lock()
        return _MOTIONBERT_CACHE_LOCKS[cache_key]


def _get_similarity_cache_lock(cache_key: str) -> threading.Lock:
    with _SIMILARITY_CACHE_LOCK:
        if cache_key not in _SIMILARITY_CACHE_LOCKS:
            _SIMILARITY_CACHE_LOCKS[cache_key] = threading.Lock()
        return _SIMILARITY_CACHE_LOCKS[cache_key]


def _file_state_signature(file_path: str) -> str:
    resolved_path = os.path.abspath(file_path)
    try:
        stat = os.stat(resolved_path)
    except FileNotFoundError:
        return f"{resolved_path}|missing"
    return f"{resolved_path}|{stat.st_size}|{stat.st_mtime_ns}"


def _file_content_digest(file_path: str) -> str:
    digest = hashlib.sha256()
    with open(file_path, "rb") as file:
        for chunk in iter(lambda: file.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _get_motionbert_cache_key(
    video_file_path: str,
    analysis_range: dict | None,
    alphapose_results_path: str,
    focus: str,
) -> str:
    range_key = (
        "full"
        if analysis_range is None
        else f"{analysis_range['startFrame']}-{analysis_range['endFrame']}"
    )
    payload = "|".join(
        [
            _get_alphapose_cache_key(video_file_path),
            range_key,
            str(focus),
            _file_content_digest(alphapose_results_path),
            _file_state_signature(os.path.join(MOTIONBERT_DIR, "infer_wild.py")),
            _file_state_signature(MOTIONBERT_CHECKPOINT),
        ]
    )
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def _get_similarity_cache_key(
    pose_file_path: str,
    human_id: int,
    selected_joints: list[int],
    template_segments: list[dict],
    fps: float,
    layer_name: str,
    layer_index: int,
    search_start_frame: int | None,
    search_end_frame: int | None,
    frame_offset: int,
) -> str:
    detector_path = os.path.join(DETECT_MOVEMENT_DIR, "similarity_detection.py")
    payload = {
        "schemaVersion": 1,
        "poseDigest": _file_content_digest(pose_file_path),
        "detectorState": _file_state_signature(detector_path),
        "humanId": human_id,
        "selectedJoints": selected_joints,
        "templateSegments": template_segments,
        "fps": fps,
        "layerName": layer_name,
        "layerIndex": layer_index,
        "searchStartFrame": search_start_frame,
        "searchEndFrame": search_end_frame,
        "frameOffset": frame_offset,
    }
    serialized = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(serialized.encode("utf-8")).hexdigest()


def _is_valid_motionbert_result(file_path: str) -> bool:
    if not os.path.isfile(file_path) or os.path.getsize(file_path) == 0:
        return False
    try:
        result = np.load(file_path, mmap_mode="r", allow_pickle=False)
        return result.size > 0
    except (OSError, ValueError, EOFError):
        return False


def get_cached_alphapose_results(video_file_path: str) -> tuple[str, bool]:
    """Run AlphaPose once per unchanged local video and return alphapose-results.json."""
    cache_key = _get_alphapose_cache_key(video_file_path)
    cache_dir = os.path.join(ALPHAPOSE_CACHE_ROOT, cache_key)
    results_path = os.path.join(cache_dir, "alphapose-results.json")

    cache_lock = _get_cache_lock(cache_key)
    with cache_lock:
        if os.path.isfile(results_path):
            logger.info("Reusing AlphaPose cache: %s", cache_dir)
            return results_path, True

        os.makedirs(cache_dir, exist_ok=True)
        run_alphapose(video_file_path, cache_dir)
        if not os.path.isfile(results_path):
            raise FileNotFoundError(f"AlphaPose output was not found: {results_path}")
        return results_path, False


def find_cached_alphapose_results(video_file_path: str) -> str | None:
    cache_key = _get_alphapose_cache_key(video_file_path)
    results_path = os.path.join(ALPHAPOSE_CACHE_ROOT, cache_key, "alphapose-results.json")
    with _get_cache_lock(cache_key):
        return results_path if os.path.isfile(results_path) else None


def _range_cache_paths(video_file_path: str, analysis_range: dict) -> tuple[str, str, str]:
    video_key = _get_alphapose_cache_key(video_file_path)
    range_key = f"{analysis_range['startFrame']}-{analysis_range['endFrame']}"
    cache_dir = os.path.join(ALPHAPOSE_CACHE_ROOT, video_key, range_key)
    return cache_dir, os.path.join(cache_dir, "analysis_range.mp4"), os.path.join(cache_dir, "alphapose-results.json")


def get_cached_analysis_results(video_file_path: str, analysis_range: dict | None) -> tuple[str, str, bool]:
    if analysis_range is None:
        results_path, hit = get_cached_alphapose_results(video_file_path)
        return video_file_path, results_path, hit

    cache_dir, clip_path, results_path = _range_cache_paths(video_file_path, analysis_range)
    with _get_cache_lock(f"{_get_alphapose_cache_key(video_file_path)}:{analysis_range['startFrame']}-{analysis_range['endFrame']}"):
        if os.path.isfile(results_path) and os.path.isfile(clip_path):
            return clip_path, results_path, True
        os.makedirs(cache_dir, exist_ok=True)
        create_analysis_video(video_file_path, analysis_range, cache_dir)
        run_alphapose(clip_path, cache_dir)
        if not os.path.isfile(results_path):
            raise FileNotFoundError(f"AlphaPose output was not found: {results_path}")
        return clip_path, results_path, False


def find_cached_analysis_results(video_file_path: str, analysis_range: dict | None) -> str | None:
    if analysis_range is None:
        return find_cached_alphapose_results(video_file_path)
    _, clip_path, results_path = _range_cache_paths(video_file_path, analysis_range)
    return results_path if os.path.isfile(clip_path) and os.path.isfile(results_path) else None


def normalize_analysis_range(video_file_path: str, analysis_range: dict | None) -> dict | None:
    if analysis_range is None:
        return None
    if not isinstance(analysis_range, dict):
        raise ValueError("analysisRange must be an object")

    capture = cv2.VideoCapture(video_file_path)
    if not capture.isOpened():
        raise RuntimeError(f"Could not open video file: {video_file_path}")
    try:
        frame_count = int(capture.get(cv2.CAP_PROP_FRAME_COUNT))
    finally:
        capture.release()

    start_frame = analysis_range.get("startFrame")
    end_frame = analysis_range.get("endFrame")
    if not isinstance(start_frame, int) or isinstance(start_frame, bool):
        raise ValueError("analysisRange.startFrame must be an integer")
    if not isinstance(end_frame, int) or isinstance(end_frame, bool):
        raise ValueError("analysisRange.endFrame must be an integer")
    if start_frame < ANNOTATION_FRAME_INDEX_BASE or end_frame < start_frame:
        raise ValueError("analysisRange must be a valid one-based frame interval")
    if frame_count <= 0 or end_frame > frame_count:
        raise ValueError("analysisRange exceeds the video length")
    if start_frame == 1 and end_frame == frame_count:
        return None
    return {"startFrame": start_frame, "endFrame": end_frame}


def create_analysis_video(video_file_path: str, analysis_range: dict, job_dir: str) -> str:
    output_path = os.path.join(job_dir, "analysis_range.mp4")
    capture = cv2.VideoCapture(video_file_path)
    if not capture.isOpened():
        raise RuntimeError(f"Could not open video file: {video_file_path}")

    writer = None
    written_frames = 0
    try:
        width = int(capture.get(cv2.CAP_PROP_FRAME_WIDTH))
        height = int(capture.get(cv2.CAP_PROP_FRAME_HEIGHT))
        fps = float(capture.get(cv2.CAP_PROP_FPS))
        if width <= 0 or height <= 0 or fps <= 0:
            raise RuntimeError("Could not read video metadata")
        writer = cv2.VideoWriter(
            output_path, cv2.VideoWriter_fourcc(*"mp4v"), fps, (width, height)
        )
        if not writer.isOpened():
            raise RuntimeError("Could not create partial analysis video")

        for frame_index in range(analysis_range["endFrame"]):
            success, frame = capture.read()
            if not success:
                raise RuntimeError(f"Could not read frame {frame_index + 1}")
            if frame_index + ANNOTATION_FRAME_INDEX_BASE >= analysis_range["startFrame"]:
                writer.write(frame)
                written_frames += 1
    finally:
        capture.release()
        if writer is not None:
            writer.release()

    expected_frames = analysis_range["endFrame"] - analysis_range["startFrame"] + 1
    if written_frames != expected_frames or not os.path.isfile(output_path):
        raise RuntimeError("Partial analysis video was not created completely")
    return output_path


def slice_alphapose_results(
    results_path: str, analysis_range: dict, job_dir: str, allow_empty: bool = False
) -> str:
    with open(results_path, "r", encoding="utf-8") as file:
        results = json.load(file)

    frame_offset = analysis_range["startFrame"] - ANNOTATION_FRAME_INDEX_BASE
    local_results = []
    for item in results:
        image_id = item.get("image_id", "")
        try:
            frame_index = int(image_id.split(".")[0])
        except (ValueError, AttributeError) as error:
            raise ValueError(f"Invalid AlphaPose image_id: {image_id}") from error
        if frame_offset <= frame_index < analysis_range["endFrame"]:
            local_item = {**item, "image_id": f"{frame_index - frame_offset}.jpg"}
            local_results.append(local_item)

    if not local_results and not allow_empty:
        raise ValueError("No AlphaPose results found in analysisRange")
    output_path = os.path.join(job_dir, "alphapose-results.json")
    with open(output_path, "w", encoding="utf-8") as file:
        json.dump(local_results, file)
    return output_path


def _single_person_results(results: list[dict]) -> list[dict]:
    """各フレームで面積最大の検出だけを残し、同一人物IDへ統一する。"""
    grouped_by_frame: dict[str, list[dict]] = {}
    for item in results:
        image_id = str(item.get("image_id", ""))
        grouped_by_frame.setdefault(image_id, []).append(item)

    normalized_results = []
    for items in grouped_by_frame.values():
        largest_item = max(
            items,
            key=lambda item: float(item["box"][2]) * float(item["box"][3]),
        )
        normalized_results.append({**largest_item, "idx": 1})
    return normalized_results


def create_single_person_results(results_path: str, job_dir: str) -> str:
    """AlphaPose結果を1人用に正規化し、キャッシュ原本とは別のファイルへ保存する。"""
    with open(results_path, "r", encoding="utf-8") as file:
        results = json.load(file)
    output_path = os.path.join(job_dir, "alphapose-single-person-results.json")
    with open(output_path, "w", encoding="utf-8") as file:
        json.dump(_single_person_results(results), file)
    return output_path


def prepare_analysis_input(
    video_file_path: str,
    analysis_range: dict | None,
    job_dir: str,
    alphapose_results_path: str | None = None,
    single_person: bool = False,
) -> tuple[str, str, int]:
    if analysis_range is None:
        if alphapose_results_path is None:
            run_alphapose(video_file_path, job_dir)
            alphapose_results_path = os.path.join(job_dir, "alphapose-results.json")
        if single_person:
            alphapose_results_path = create_single_person_results(
                alphapose_results_path, job_dir
            )
        return video_file_path, alphapose_results_path, 0

    analysis_video_path = create_analysis_video(video_file_path, analysis_range, job_dir)
    if alphapose_results_path is None:
        cache_path = find_cached_analysis_results(video_file_path, analysis_range)
        if cache_path is not None:
            alphapose_results_path = cache_path
        else:
            alphapose_results_path = find_cached_alphapose_results(video_file_path)

    if alphapose_results_path is not None:
        _, _, range_results_path = _range_cache_paths(video_file_path, analysis_range)
        local_results_path = (alphapose_results_path if alphapose_results_path == range_results_path
                              else slice_alphapose_results(alphapose_results_path, analysis_range, job_dir))
    else:
        run_alphapose(analysis_video_path, job_dir)
        local_results_path = os.path.join(job_dir, "alphapose-results.json")
    if single_person:
        local_results_path = create_single_person_results(local_results_path, job_dir)
    return analysis_video_path, local_results_path, analysis_range["startFrame"] - 1


def _run_subprocess(args: list[str], cwd: str, job_dir: str, step_name: str) -> subprocess.CompletedProcess:
    """外部Pythonスクリプトを実行し、失敗時はログを残して例外化する。"""
    stdout_path = os.path.join(job_dir, f"{step_name}_stdout.log")
    stderr_path = os.path.join(job_dir, f"{step_name}_stderr.log")
    process_environment = {**os.environ, "PYTHONUNBUFFERED": "1"}
    with (
        open(stdout_path, "w", encoding="utf-8") as stdout_file,
        open(stderr_path, "w", encoding="utf-8") as stderr_file,
    ):
        process = subprocess.Popen(
            args,
            cwd=cwd,
            env=process_environment,
            stdout=stdout_file,
            stderr=stderr_file,
            text=True,
        )
        returncode = process.wait()

    with open(stdout_path, "r", encoding="utf-8", errors="replace") as file:
        stdout = file.read()
    with open(stderr_path, "r", encoding="utf-8", errors="replace") as file:
        stderr = file.read()
    result = subprocess.CompletedProcess(args, returncode, stdout, stderr)

    if result.returncode != 0:
        logger.error(
            "Step '%s' failed (returncode=%d)\nstderr: %s",
            step_name,
            result.returncode,
            result.stderr[:500],
        )
        raise subprocess.CalledProcessError(
            result.returncode,
            args,
            output=result.stdout,
            stderr=result.stderr,
        )

    os.remove(stdout_path)
    os.remove(stderr_path)
    return result


def run_alphapose(video_file_path: str, job_dir: str) -> subprocess.CompletedProcess:
    """AlphaPoseで2D姿勢推定を実行し、alphapose-results.json を job_dir に出力する。"""
    if not os.path.isfile(ALPHAPOSE_DETECTOR_CHECKPOINT):
        raise FileNotFoundError(
            "AlphaPoseの人物検出モデルが見つかりません。"
            "AI環境セットアップからAlphaPose人物検出モデルを配置してください: "
            f"{ALPHAPOSE_DETECTOR_CHECKPOINT}"
        )
    if not os.path.isfile(ALPHAPOSE_TRACKER_CHECKPOINT):
        raise FileNotFoundError(
            "AlphaPoseの人物追跡モデルが見つかりません。"
            "AI環境セットアップからAlphaPose人物追跡モデルを配置してください: "
            f"{ALPHAPOSE_TRACKER_CHECKPOINT}"
        )
    return _run_subprocess(
        [
            sys.executable,
            os.path.join(os.path.dirname(__file__), "alphapose_runner.py"),
            "--cfg",
            "configs/halpe_26/resnet/256x192_res50_lr1e-3_1x.yaml",
            "--checkpoint",
            "pretrained_models/halpe26_fast_res50_256x192.pth",
            "--video",
            video_file_path,
            "--outdir",
            job_dir,
            "--pose_track",
        ],
        cwd=ALPHAPOSE_DIR,
        job_dir=job_dir,
        step_name="alphapose",
    )


def run_motionbert(video_file_path: str, json_path: str, job_dir: str, focus: str) -> subprocess.CompletedProcess:
    """MotionBERTで指定人物の3D姿勢推定を実行し、X3D.npy を job_dir に出力する。"""
    runner_path = os.path.join(os.path.dirname(__file__), "motionbert_runner.py")
    return _run_subprocess(
        [
            sys.executable,
            runner_path,
            os.path.join(MOTIONBERT_DIR, "infer_wild.py"),
            "--vid_path",
            video_file_path,
            "--json_path",
            json_path,
            "--out_path",
            job_dir,
            "--evaluate",
            MOTIONBERT_CHECKPOINT,
            "--focus",
            str(focus),
        ],
        cwd=MOTIONBERT_DIR,
        job_dir=job_dir,
        step_name="motionbert",
    )


def get_cached_motionbert_results(
    source_video_path: str,
    analysis_range: dict | None,
    analysis_video_path: str,
    alphapose_results_path: str,
    job_dir: str,
    focus: str,
) -> tuple[str, bool]:
    """同じ動画・区間・人物・モデルのMotionBERT結果を再利用する。"""
    cache_key = _get_motionbert_cache_key(
        source_video_path,
        analysis_range,
        alphapose_results_path,
        focus,
    )
    cache_dir = os.path.join(MOTIONBERT_CACHE_ROOT, cache_key)
    cache_path = os.path.join(cache_dir, "X3D.npy")
    job_result_path = os.path.join(job_dir, "X3D.npy")

    with _get_motionbert_cache_lock(cache_key):
        if _is_valid_motionbert_result(cache_path):
            shutil.copy2(cache_path, job_result_path)
            logger.info("Reusing MotionBERT cache: %s", cache_dir)
            return job_result_path, True

        if os.path.exists(cache_path):
            os.remove(cache_path)

        run_motionbert(
            analysis_video_path,
            alphapose_results_path,
            job_dir,
            focus,
        )
        if not _is_valid_motionbert_result(job_result_path):
            raise RuntimeError("MotionBERT output was not created correctly")

        os.makedirs(cache_dir, exist_ok=True)
        temporary_cache_path = os.path.join(cache_dir, f"X3D-{uuid.uuid4().hex}.tmp")
        try:
            shutil.copy2(job_result_path, temporary_cache_path)
            if not _is_valid_motionbert_result(temporary_cache_path):
                raise RuntimeError("MotionBERT cache could not be created correctly")
            os.replace(temporary_cache_path, cache_path)
        finally:
            if os.path.exists(temporary_cache_path):
                os.remove(temporary_cache_path)

        return job_result_path, False


def run_npy2csv(job_dir: str) -> subprocess.CompletedProcess:
    """MotionBERTの X3D.npy を X3D.csv に変換する。"""
    npy2csv_script = os.path.join(DETECT_MOVEMENT_DIR, "npy2csv.py")
    return _run_subprocess(
        [sys.executable, npy2csv_script],
        cwd=job_dir,
        job_dir=job_dir,
        step_name="npy2csv",
    )


def run_calc_cross_product(job_dir: str) -> subprocess.CompletedProcess:
    """X3D.csv から外積特徴量を計算し、output_cross_product.csv を出力する。"""
    calc_script = os.path.join(DETECT_MOVEMENT_DIR, "calc_keypoint_cross_product_rotate.py")
    return _run_subprocess(
        [sys.executable, calc_script],
        cwd=job_dir,
        job_dir=job_dir,
        step_name="calc_cross_product",
    )


def run_detect_movement_script(video_file_path: str, annotation_file: str, job_dir: str) -> subprocess.CompletedProcess:
    """外積特徴量とユーザー指定レイヤーから動作区間を検出する。"""
    detect_script = os.path.join(DETECT_MOVEMENT_DIR, "detect_movement.py")
    return _run_subprocess(
        [
            sys.executable,
            detect_script,
            video_file_path,
            annotation_file,
        ],
        cwd=job_dir,
        job_dir=job_dir,
        step_name="detect_movement",
    )


def _load_similarity_detector_class():
    """v40検出器を必要なときだけ読み込む。FastAPI起動時の重い依存読み込みを避ける。"""
    global _SIMILARITY_DETECTOR_CLASS
    if _SIMILARITY_DETECTOR_CLASS is not None:
        return _SIMILARITY_DETECTOR_CLASS

    detector_path = os.path.join(DETECT_MOVEMENT_DIR, "similarity_detection.py")
    spec = importlib.util.spec_from_file_location("annotation_tool_similarity_detection", detector_path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Could not load similarity detector: {detector_path}")

    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    _SIMILARITY_DETECTOR_CLASS = module.DTWPureGreedy3DDetector
    return _SIMILARITY_DETECTOR_CLASS


def run_similarity_detection(
    pose_file_path: str,
    human_id: int,
    selected_joints: list[int],
    template_segments: list[dict],
    fps: float,
    layer_name: str,
    layer_index: int,
    search_start_frame: int | None = None,
    search_end_frame: int | None = None,
    frame_offset: int = 0,
) -> dict:
    """v40を実行し、UIで扱う注釈候補と検出メタデータを返す。"""
    if fps <= 0:
        raise ValueError("Frame rate must be greater than zero")
    if human_id < 0:
        raise ValueError("humanId must be zero or greater")
    if not selected_joints:
        raise ValueError("selectedJoints must contain at least one joint")
    if not template_segments:
        raise ValueError("templateSegments must contain at least one interval")
    validate_frame_range(
        search_start_frame,
        search_end_frame,
        start_name="searchStartFrame",
        end_name="searchEndFrame",
    )

    template_times: list[tuple[float, float]] = []
    template_frame_ranges: list[tuple[int, int]] = []
    for index, segment in enumerate(template_segments):
        try:
            start_frame = int(segment["startFrame"])
            end_frame = int(segment["endFrame"])
        except (KeyError, TypeError, ValueError) as error:
            raise ValueError(f"Invalid template segment at index {index}") from error
        if end_frame < start_frame:
            raise ValueError(f"Template segment {index} ends before it starts")
        if start_frame < ANNOTATION_FRAME_INDEX_BASE:
            raise ValueError(f"Template segment {index} starts before frame one")
        template_frame_ranges.append((start_frame, end_frame))
        template_times.append(
            (
                (start_frame - ANNOTATION_FRAME_INDEX_BASE) / fps,
                (end_frame - ANNOTATION_FRAME_INDEX_BASE) / fps,
            )
        )

    detector_class = _load_similarity_detector_class()
    unique_selected_joints = list(dict.fromkeys(selected_joints))
    invalid_joints = [
        joint for joint in unique_selected_joints if joint not in detector_class.JOINT_RELATIONS
    ]
    if invalid_joints:
        raise ValueError(f"selectedJoints contains unsupported joints: {invalid_joints}")

    detector = detector_class(fps=fps)
    result = detector.detect(pose_file_path, unique_selected_joints, template_times)
    if "error" in result:
        raise RuntimeError(result["error"])

    def overlaps_template(candidate_start_frame: int, candidate_end_frame: int) -> bool:
        return any(
            candidate_start_frame <= template_end_frame
            and template_start_frame <= candidate_end_frame
            for template_start_frame, template_end_frame in template_frame_ranges
        )

    all_candidates = []
    for segment in result["segments"]:
        # startFrame/endFrame are compatible with existing annotation results.
        start_frame = int(segment.start_frame) + ANNOTATION_FRAME_INDEX_BASE
        end_frame = int(segment.end_frame) + ANNOTATION_FRAME_INDEX_BASE
        if overlaps_template(start_frame, end_frame):
            continue
        if search_start_frame is not None and start_frame < search_start_frame:
            continue
        if search_end_frame is not None and end_frame > search_end_frame:
            continue
        all_candidates.append(
            {
                "startFrame": start_frame + frame_offset,
                "endFrame": end_frame + frame_offset,
                "startTime": float(segment.start_time + frame_offset / fps),
                "endTime": float(segment.end_time + frame_offset / fps),
                "text": "",
                "layerName": layer_name,
                "layerIndex": layer_index,
                "humanId": human_id,
                "similarity": float(segment.final_score),
                "dtwSimilarity": float(segment.dtw_similarity),
                "templateId": int(segment.template_id),
                "windowScale": float(segment.window_scale),
                "windowLength": int(segment.window_length),
            }
        )

    candidates = [
        {
            **candidate,
            "text": f"類似候補 {candidate_index}",
        }
        for candidate_index, candidate in enumerate(all_candidates, start=1)
    ]

    stats = result["stats"]
    return {
        "candidates": candidates,
        "stats": {
            "templates": int(stats["templates"]),
            "initialCandidates": int(stats["initial_candidates"]),
            "thresholdPassedCandidates": int(stats["threshold_passed_candidates"]),
            "postUnionCandidates": int(stats["post_union_candidates"]),
            "finalResults": int(stats["final_results"]),
            "filteredResults": len(candidates),
            "averageFinalScore": float(stats["avg_final_score"]),
        },
        "parameters": {
            "algorithm": "v40_dtw_pure_refined",
            "fps": float(fps),
            "selectedJoints": unique_selected_joints,
            "selectedJointNames": result["params"]["selected_joint_names"],
            "featureType": result["params"]["feature_type"],
            "searchStartFrame": search_start_frame,
            "searchEndFrame": search_end_frame,
        },
    }


def get_cached_similarity_results(
    pose_file_path: str,
    human_id: int,
    selected_joints: list[int],
    template_segments: list[dict],
    fps: float,
    layer_name: str,
    layer_index: int,
    search_start_frame: int | None = None,
    search_end_frame: int | None = None,
    frame_offset: int = 0,
) -> tuple[dict, bool]:
    cache_key = _get_similarity_cache_key(
        pose_file_path,
        human_id,
        selected_joints,
        template_segments,
        fps,
        layer_name,
        layer_index,
        search_start_frame,
        search_end_frame,
        frame_offset,
    )
    cache_dir = os.path.join(SIMILARITY_CACHE_ROOT, cache_key)
    cache_path = os.path.join(cache_dir, "result.json")

    with _get_similarity_cache_lock(cache_key):
        if os.path.isfile(cache_path):
            try:
                with open(cache_path, "r", encoding="utf-8") as cache_file:
                    cached_result = json.load(cache_file)
                if all(key in cached_result for key in ("candidates", "stats", "parameters")):
                    logger.info("Reusing similarity detection cache: %s", cache_dir)
                    return cached_result, True
            except (OSError, json.JSONDecodeError, TypeError):
                logger.warning("Discarding invalid similarity detection cache: %s", cache_dir)
            shutil.rmtree(cache_dir, ignore_errors=True)

        result = run_similarity_detection(
            pose_file_path=pose_file_path,
            human_id=human_id,
            selected_joints=selected_joints,
            template_segments=template_segments,
            fps=fps,
            layer_name=layer_name,
            layer_index=layer_index,
            search_start_frame=search_start_frame,
            search_end_frame=search_end_frame,
            frame_offset=frame_offset,
        )
        os.makedirs(cache_dir, exist_ok=True)
        temporary_path = os.path.join(cache_dir, f"result-{uuid.uuid4().hex}.tmp")
        try:
            with open(temporary_path, "w", encoding="utf-8") as cache_file:
                json.dump(result, cache_file, ensure_ascii=False, separators=(",", ":"))
            os.replace(temporary_path, cache_path)
        finally:
            if os.path.exists(temporary_path):
                os.remove(temporary_path)
        return result, False


def _largest_person_per_frame(alphapose_results: list[dict]) -> list[dict]:
    """AlphaPose結果をフレームごとにまとめ、各フレームで面積最大の人物を代表として選ぶ。"""
    grouped_by_idx: dict[object, list[dict]] = {}
    for item in alphapose_results:
        idx = item["idx"]
        grouped_by_idx.setdefault(idx, []).append(item)

    human_images = []
    for items in grouped_by_idx.values():
        max_item = max(items, key=lambda item: int(item["box"][2]) * int(item["box"][3]))
        human_images.append(max_item)
    return human_images


def _read_frame(video_file_path: str, frame_id: int):
    """OpenCVで指定フレームを読み込む。VideoCapture は必ず解放する。"""
    cap = cv2.VideoCapture(video_file_path)
    if not cap.isOpened():
        raise RuntimeError(f"Could not open video file: {video_file_path}")

    try:
        current_frame = 0
        frame = None
        while current_frame <= frame_id:
            ret, frame = cap.read()
            if not ret:
                raise RuntimeError(f"Could not read frame {current_frame}")
            current_frame += 1
        return frame
    finally:
        cap.release()


def extract_human_images(
    video_file_path: str,
    job_dir: str,
    alphapose_results_path: str | None = None,
) -> list[str]:
    """AlphaPose結果から人物領域を切り出し、JPEGのBase64文字列リストとして返す。"""
    return [person["image"] for person in extract_human_people(video_file_path, job_dir, alphapose_results_path)]


def extract_human_people(
    video_file_path: str,
    job_dir: str,
    alphapose_results_path: str | None = None,
    single_person: bool = False,
    progress_callback: ProgressCallback | None = None,
) -> list[dict]:
    if alphapose_results_path is None:
        report_progress(
            progress_callback,
            stage="2次元姿勢推定",
            description="AlphaPoseで動画内の人物と関節位置を検出しています。",
            step=2,
            total_steps=3,
        )
        run_alphapose(video_file_path, job_dir)
        alphapose_results_path = os.path.join(job_dir, "alphapose-results.json")

    report_progress(
        progress_callback,
        stage="人物画像の抽出",
        description="検出結果から人物ごとの代表画像を作成しています。",
        step=3,
        total_steps=3,
    )
    with open(alphapose_results_path, "r", encoding="utf-8") as file:
        alphapose_results = json.load(file)
    if single_person:
        alphapose_results = _single_person_results(alphapose_results)

    people = []
    for item in _largest_person_per_frame(alphapose_results):
        frame_id = int(item["image_id"].split(".")[0])
        frame = _read_frame(video_file_path, frame_id)

        x, y, width, height = map(int, item["box"])
        x2 = x + width
        y2 = y + height

        # AlphaPoseのboxが動画範囲外へ出る場合があるため、フレーム内に丸める。
        frame_height, frame_width, _ = frame.shape
        x = max(0, min(x, frame_width))
        y = max(0, min(y, frame_height))
        x2 = max(0, min(x2, frame_width))
        y2 = max(0, min(y2, frame_height))

        if x >= x2 or y >= y2:
            continue

        cropped = frame[y:y2, x:x2]
        success, img_encoded = cv2.imencode(".jpg", cropped)
        if not success:
            continue
        people.append({"humanId": int(item["idx"]) - 1, "image": base64.b64encode(img_encoded).decode("utf-8")})

    return people


def run_pose_pipeline(
    video_file_path: str,
    auto_annotation_layer: list[dict],
    job_dir: str | None = None,
    alphapose_results_path: str | None = None,
    analysis_start_frame: int | None = None,
    analysis_end_frame: int | None = None,
    analysis_range: dict | None = None,
    use_motionbert_cache: bool = False,
    pipeline_metadata: dict | None = None,
    single_person: bool = False,
    progress_callback: ProgressCallback | None = None,
) -> list[dict]:
    """自動アノテーション用の全パイプラインを実行し、検出された動作区間を返す。"""
    owns_job_dir = job_dir is None
    if job_dir is None:
        job_dir = create_job_dir()
    success = False
    try:
        if analysis_range is None and analysis_start_frame is not None and analysis_end_frame is not None:
            analysis_range = {"startFrame": analysis_start_frame, "endFrame": analysis_end_frame}
        if analysis_range is None:
            validate_frame_range(
                analysis_start_frame,
                analysis_end_frame,
                start_name="analysisStartFrame",
                end_name="analysisEndFrame",
            )
        selected_range = normalize_analysis_range(video_file_path, analysis_range)
        if selected_range is None:
            capture = cv2.VideoCapture(video_file_path)
            try:
                analysis_frame_count = int(capture.get(cv2.CAP_PROP_FRAME_COUNT))
            finally:
                capture.release()
        else:
            analysis_frame_count = selected_range["endFrame"] - selected_range["startFrame"] + 1
        if analysis_frame_count < MIN_MOVEMENT_ANALYSIS_FRAMES:
            raise ValueError(f"動作範囲検出には{MIN_MOVEMENT_ANALYSIS_FRAMES}フレーム以上の分析区間が必要です。")
        if alphapose_results_path is None:
            report_progress(
                progress_callback,
                stage="2次元姿勢推定",
                description="AlphaPoseで動画内の人物と関節位置を検出しています。",
                step=2,
                total_steps=5,
            )
        analysis_video_path, pose_results_path, frame_offset = prepare_analysis_input(
            video_file_path,
            selected_range,
            job_dir,
            alphapose_results_path,
            single_person,
        )

        # MotionBERTは対象人物をfocusで指定するため、humanIdごとにレイヤーを処理する。
        grouped_by_human_id: dict[int, list[dict]] = {}
        for item in auto_annotation_layer:
            human_id = item["humanId"]
            grouped_by_human_id.setdefault(human_id, []).append(item)

        motion_times = []
        motionbert_cache_hits = 0
        grouped_people = list(grouped_by_human_id.items())
        for person_index, (human_id, layers) in enumerate(grouped_people, start=1):
            report_progress(
                progress_callback,
                stage="3次元姿勢推定",
                description="MotionBERTで2次元姿勢を3次元姿勢へ変換しています。",
                step=3,
                total_steps=5,
                current_item=person_index,
                total_items=len(grouped_people),
            )
            focus = str(human_id + 1)
            if use_motionbert_cache:
                _, motionbert_cache_hit = get_cached_motionbert_results(
                    video_file_path,
                    selected_range,
                    analysis_video_path,
                    pose_results_path,
                    job_dir,
                    focus,
                )
            else:
                run_motionbert(analysis_video_path, pose_results_path, job_dir, focus)
                motionbert_cache_hit = False
            if motionbert_cache_hit:
                motionbert_cache_hits += 1
            report_progress(
                progress_callback,
                stage="動作区間の検出",
                description="選択した関節の変化から動作区間を検出しています。",
                step=4,
                total_steps=5,
                current_item=person_index,
                total_items=len(grouped_people),
                cache_hit=motionbert_cache_hit,
            )
            run_npy2csv(job_dir)
            run_calc_cross_product(job_dir)

            annotation_file = os.path.join(job_dir, "auto_annotation_layer.json")
            with open(annotation_file, "w", encoding="utf-8") as file:
                json.dump(layers, file, ensure_ascii=False, indent=4)

            run_detect_movement_script(analysis_video_path, annotation_file, job_dir)

            motion_times_path = os.path.join(job_dir, "motion_times.json")
            with open(motion_times_path, "r", encoding="utf-8") as file:
                local_results = json.load(file)
            for item in local_results:
                item["startFrame"] += frame_offset
                item["endFrame"] += frame_offset
            motion_times += local_results

        if pipeline_metadata is not None:
            pipeline_metadata["motionbertCache"] = {
                "hits": motionbert_cache_hits,
                "total": len(grouped_by_human_id),
                "allHit": bool(grouped_by_human_id)
                and motionbert_cache_hits == len(grouped_by_human_id),
            }

        report_progress(
            progress_callback,
            stage="結果の整理",
            description="検出結果を注釈として表示できる形式に整理しています。",
            step=5,
            total_steps=5,
        )
        success = True
        if selected_range is None:
            motion_times = filter_results_by_frame_range(
                motion_times, analysis_start_frame, analysis_end_frame
            )
        return sorted(motion_times, key=lambda item: item["layerIndex"])

    finally:
        if success and owns_job_dir:
            cleanup_job_dir(job_dir)
        elif not success:
            logger.warning("Job failed. Preserving job directory for debugging: %s", job_dir)


def run_similarity_pipeline(
    video_file_path: str,
    human_id: int,
    selected_joints: list[int],
    template_segments: list[dict],
    layer_name: str,
    layer_index: int,
    search_start_frame: int | None = None,
    search_end_frame: int | None = None,
    job_dir: str | None = None,
    alphapose_results_path: str | None = None,
    analysis_range: dict | None = None,
    single_person: bool = False,
    progress_callback: ProgressCallback | None = None,
) -> dict:
    """人物・関節・テンプレート区間を指定して、類似動作候補を返す。"""
    owns_job_dir = job_dir is None
    if job_dir is None:
        job_dir = create_job_dir()
    success = False
    try:
        selected_range = normalize_analysis_range(video_file_path, analysis_range)
        for segment in template_segments:
            if segment["startFrame"] < 1 or segment["endFrame"] < segment["startFrame"]:
                raise ValueError("Invalid template segment")
        if selected_range is not None and search_start_frame is None and search_end_frame is None:
            search_start_frame = selected_range["startFrame"]
            search_end_frame = selected_range["endFrame"]
        validate_frame_range(
            search_start_frame,
            search_end_frame,
            start_name="searchStartFrame",
            end_name="searchEndFrame",
        )
        if selected_range is not None and any(
            segment["startFrame"] < selected_range["startFrame"]
            or segment["endFrame"] > selected_range["endFrame"]
            for segment in template_segments
        ):
            raise ValueError("Template segment must be fully contained in analysisRange")
        if alphapose_results_path is None:
            report_progress(
                progress_callback,
                stage="2次元姿勢推定",
                description="AlphaPoseで動画内の人物と関節位置を検出しています。",
                step=2,
                total_steps=5,
            )
        analysis_video_path, pose_results_path, frame_offset = prepare_analysis_input(
            video_file_path,
            selected_range,
            job_dir,
            alphapose_results_path,
            single_person,
        )
        report_progress(
            progress_callback,
            stage="3次元姿勢推定",
            description="MotionBERTで対象人物の3次元姿勢を推定しています。",
            step=3,
            total_steps=5,
        )
        pose_file_path, motionbert_cache_hit = get_cached_motionbert_results(
            video_file_path,
            selected_range,
            analysis_video_path,
            pose_results_path,
            job_dir,
            str(human_id + 1),
        )

        local_templates = [
            {
                "startFrame": segment["startFrame"] - frame_offset,
                "endFrame": segment["endFrame"] - frame_offset,
            }
            for segment in template_segments
        ]
        report_progress(
            progress_callback,
            stage="類似動作の検索",
            description="テンプレートと近い関節の動きを検索しています。",
            step=4,
            total_steps=5,
            cache_hit=motionbert_cache_hit,
        )
        result, similarity_cache_hit = get_cached_similarity_results(
            pose_file_path=pose_file_path,
            human_id=human_id,
            selected_joints=selected_joints,
            template_segments=local_templates,
            fps=get_video_framerate(analysis_video_path),
            search_start_frame=search_start_frame - frame_offset if search_start_frame is not None else None,
            search_end_frame=search_end_frame - frame_offset if search_end_frame is not None else None,
            layer_name=layer_name,
            layer_index=layer_index,
            frame_offset=frame_offset,
        )
        report_progress(
            progress_callback,
            stage="結果の整理",
            description="類似候補をタイムラインへ表示できる形式に整理しています。",
            step=5,
            total_steps=5,
            cache_hit=similarity_cache_hit,
        )
        result["parameters"]["searchStartFrame"] = search_start_frame
        result["parameters"]["searchEndFrame"] = search_end_frame
        result["analysisRange"] = analysis_range
        result["motionbertCache"] = {"hit": motionbert_cache_hit}
        result["similarityCache"] = {"hit": similarity_cache_hit}
        success = True
        return result
    finally:
        if success and owns_job_dir:
            cleanup_job_dir(job_dir)
        elif not success:
            logger.warning("Similarity job failed. Preserving job directory for debugging: %s", job_dir)


def get_video_framerate(video_file_path: str) -> float:
    """動画ファイルをOpenCVで開き、FPSを返す。"""
    cap = cv2.VideoCapture(video_file_path)
    if not cap.isOpened():
        raise RuntimeError(f"Could not open video file: {video_file_path}")
    try:
        return cap.get(cv2.CAP_PROP_FPS)
    finally:
        cap.release()
