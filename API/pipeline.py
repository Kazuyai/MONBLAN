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

import cv2

try:
    from .paths import ALPHAPOSE_DIR, DETECT_MOVEMENT_DIR, MOTIONBERT_CHECKPOINT, MOTIONBERT_DIR
except ImportError:
    from paths import ALPHAPOSE_DIR, DETECT_MOVEMENT_DIR, MOTIONBERT_CHECKPOINT, MOTIONBERT_DIR

logger = logging.getLogger(__name__)

_SIMILARITY_DETECTOR_CLASS = None
# Existing detect_movement.py returns one-based, inclusive frame ranges.
ANNOTATION_FRAME_INDEX_BASE = 1
ALPHAPOSE_CACHE_ROOT = os.path.join(tempfile.gettempdir(), "annotation-tool-alphapose-cache")
_ALPHAPOSE_CACHE_LOCK = threading.Lock()
_ALPHAPOSE_CACHE_LOCKS: dict[str, threading.Lock] = {}


def create_job_dir() -> str:
    """リクエストごとの一時作業ディレクトリを作成する。"""
    job_id = str(uuid.uuid4())
    job_dir = os.path.join(tempfile.gettempdir(), "annotation-tool-jobs", job_id)
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


def _save_subprocess_log(job_dir: str, step_name: str, stdout: str, stderr: str):
    """外部スクリプト失敗時の標準出力・標準エラーを調査用に保存する。"""
    if stdout:
        stdout_path = os.path.join(job_dir, f"{step_name}_stdout.log")
        with open(stdout_path, "w", encoding="utf-8") as file:
            file.write(stdout)
    if stderr:
        stderr_path = os.path.join(job_dir, f"{step_name}_stderr.log")
        with open(stderr_path, "w", encoding="utf-8") as file:
            file.write(stderr)


def _run_subprocess(args: list[str], cwd: str, job_dir: str, step_name: str) -> subprocess.CompletedProcess:
    """外部Pythonスクリプトを実行し、失敗時はログを残して例外化する。"""
    result = subprocess.run(
        args,
        cwd=cwd,
        capture_output=True,
        text=True,
    )

    if result.returncode != 0:
        _save_subprocess_log(job_dir, step_name, result.stdout, result.stderr)
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

    return result


def run_alphapose(video_file_path: str, job_dir: str) -> subprocess.CompletedProcess:
    """AlphaPoseで2D姿勢推定を実行し、alphapose-results.json を job_dir に出力する。"""
    return _run_subprocess(
        [
            sys.executable,
            "scripts/demo_inference.py",
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
    return _run_subprocess(
        [
            sys.executable,
            "infer_wild.py",
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
    if search_start_frame is not None and search_start_frame < ANNOTATION_FRAME_INDEX_BASE:
        raise ValueError("searchStartFrame must be frame one or greater")
    if search_end_frame is not None and search_end_frame < ANNOTATION_FRAME_INDEX_BASE:
        raise ValueError("searchEndFrame must be frame one or greater")
    if (
        search_start_frame is not None
        and search_end_frame is not None
        and search_end_frame < search_start_frame
    ):
        raise ValueError("searchEndFrame must be greater than or equal to searchStartFrame")

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
    detector = detector_class(fps=fps)
    result = detector.detect(pose_file_path, list(dict.fromkeys(selected_joints)), template_times)
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
                "startFrame": start_frame,
                "endFrame": end_frame,
                "startTime": float(segment.start_time),
                "endTime": float(segment.end_time),
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
            "selectedJoints": list(dict.fromkeys(selected_joints)),
            "selectedJointNames": result["params"]["selected_joint_names"],
            "featureType": result["params"]["feature_type"],
            "searchStartFrame": search_start_frame,
            "searchEndFrame": search_end_frame,
        },
    }


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
    if alphapose_results_path is None:
        run_alphapose(video_file_path, job_dir)
        alphapose_results_path = os.path.join(job_dir, "alphapose-results.json")

    with open(alphapose_results_path, "r", encoding="utf-8") as file:
        alphapose_results = json.load(file)

    image_data_list = []
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
        image_data_list.append(base64.b64encode(img_encoded).decode("utf-8"))

    return image_data_list


def run_pose_pipeline(
    video_file_path: str,
    auto_annotation_layer: list[dict],
    job_dir: str | None = None,
    alphapose_results_path: str | None = None,
) -> list[dict]:
    """自動アノテーション用の全パイプラインを実行し、検出された動作区間を返す。"""
    owns_job_dir = job_dir is None
    if job_dir is None:
        job_dir = create_job_dir()
    success = False
    try:
        if alphapose_results_path is None:
            run_alphapose(video_file_path, job_dir)
            alphapose_results_path = os.path.join(job_dir, "alphapose-results.json")

        # MotionBERTは対象人物をfocusで指定するため、humanIdごとにレイヤーを処理する。
        grouped_by_human_id: dict[int, list[dict]] = {}
        for item in auto_annotation_layer:
            human_id = item["humanId"]
            grouped_by_human_id.setdefault(human_id, []).append(item)

        motion_times = []
        for human_id, layers in grouped_by_human_id.items():
            focus = str(human_id + 1)
            run_motionbert(video_file_path, alphapose_results_path, job_dir, focus)
            run_npy2csv(job_dir)
            run_calc_cross_product(job_dir)

            annotation_file = os.path.join(job_dir, "auto_annotation_layer.json")
            with open(annotation_file, "w", encoding="utf-8") as file:
                json.dump(layers, file, ensure_ascii=False, indent=4)

            run_detect_movement_script(video_file_path, annotation_file, job_dir)

            motion_times_path = os.path.join(job_dir, "motion_times.json")
            with open(motion_times_path, "r", encoding="utf-8") as file:
                motion_times += json.load(file)

        success = True
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
) -> dict:
    """人物・関節・テンプレート区間を指定して、類似動作候補を返す。"""
    owns_job_dir = job_dir is None
    if job_dir is None:
        job_dir = create_job_dir()
    success = False
    try:
        if alphapose_results_path is None:
            run_alphapose(video_file_path, job_dir)
            alphapose_results_path = os.path.join(job_dir, "alphapose-results.json")
        run_motionbert(video_file_path, alphapose_results_path, job_dir, str(human_id + 1))

        pose_file_path = os.path.join(job_dir, "X3D.npy")
        if not os.path.isfile(pose_file_path):
            raise FileNotFoundError(f"MotionBERT output was not found: {pose_file_path}")

        result = run_similarity_detection(
            pose_file_path=pose_file_path,
            human_id=human_id,
            selected_joints=selected_joints,
            template_segments=template_segments,
            fps=get_video_framerate(video_file_path),
            search_start_frame=search_start_frame,
            search_end_frame=search_end_frame,
            layer_name=layer_name,
            layer_index=layer_index,
        )
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
