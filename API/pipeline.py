"""姿勢推定と動作検出の実行パイプライン。

FastAPIのリクエストごとにジョブディレクトリを作成し、AlphaPose、MotionBERT、
detect_movement の入出力をその中へ閉じ込める。os.chdir() は使わず、
subprocess.run(cwd=...) で各外部スクリプトの作業ディレクトリを指定する。
"""

import base64
import json
import logging
import os
import shutil
import subprocess
import sys
import tempfile
import uuid

import cv2

try:
    from .paths import ALPHAPOSE_DIR, DETECT_MOVEMENT_DIR, MOTIONBERT_CHECKPOINT, MOTIONBERT_DIR
except ImportError:
    from paths import ALPHAPOSE_DIR, DETECT_MOVEMENT_DIR, MOTIONBERT_CHECKPOINT, MOTIONBERT_DIR

logger = logging.getLogger(__name__)


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


def extract_human_images(video_file_path: str, job_dir: str) -> list[str]:
    """AlphaPose結果から人物領域を切り出し、JPEGのBase64文字列リストとして返す。"""
    run_alphapose(video_file_path, job_dir)

    results_path = os.path.join(job_dir, "alphapose-results.json")
    with open(results_path, "r", encoding="utf-8") as file:
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


def run_pose_pipeline(video_file_path: str, auto_annotation_layer: list[dict]) -> list[dict]:
    """自動アノテーション用の全パイプラインを実行し、検出された動作区間を返す。"""
    job_dir = create_job_dir()
    success = False
    try:
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
        if success:
            cleanup_job_dir(job_dir)
        else:
            logger.warning("Job failed. Preserving job directory for debugging: %s", job_dir)


def get_video_framerate(video_file_path: str) -> float:
    """動画ファイルをOpenCVで開き、FPSを返す。"""
    cap = cv2.VideoCapture(video_file_path)
    if not cap.isOpened():
        raise RuntimeError(f"Could not open video file: {video_file_path}")
    try:
        return cap.get(cv2.CAP_PROP_FPS)
    finally:
        cap.release()
