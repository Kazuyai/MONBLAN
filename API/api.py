"""FastAPI のHTTP受付層。

重い処理は pipeline.py に委譲し、このファイルではルーティング、一時ファイル管理、ログ、エラー整形だけを扱う。
"""

import json
import os
import subprocess
import tempfile
import time
from datetime import datetime

from fastapi import FastAPI, File, Form, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

try:
    # 標準起動: リポジトリルートから `python -m uvicorn API.api:app` を実行する。
    from .environment import check_environment
    from .paths import BASE_DIR
    from .pipeline import (
        cleanup_job_dir,
        create_job_dir,
        extract_human_images,
        get_video_framerate,
        run_pose_pipeline,
    )
except ImportError:
    # 互換用: APIディレクトリ内から `uvicorn api:app` で起動した場合も動かす。
    from environment import check_environment
    from paths import BASE_DIR
    from pipeline import (
        cleanup_job_dir,
        create_job_dir,
        extract_human_images,
        get_video_framerate,
        run_pose_pipeline,
    )

app = FastAPI()

# 現状はローカル利用前提で全許可。Electron連携時にlocalhost限定へ絞る。
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

LOG_FILE = os.path.join(BASE_DIR, "api_log.txt")


def log_api_call(api_name: str, start_time: float, end_time: float, additional_info: str = ""):
    """API呼び出しの処理時間と結果概要を記録する。"""
    duration = end_time - start_time
    current_time = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    log_entry = f"Time: {current_time}, API: {api_name}, Duration: {duration:.2f}s, Info: {additional_info}\n"
    with open(LOG_FILE, "a", encoding="utf-8") as log_file:
        log_file.write(log_entry)


async def save_upload_to_temp(file: UploadFile) -> str:
    """UploadFileをOpenCVや外部スクリプトが読める一時mp4ファイルとして保存する。"""
    contents = await file.read()
    with tempfile.NamedTemporaryFile(delete=False, suffix=".mp4") as temp_file:
        temp_file.write(contents)
        return temp_file.name


def _format_subprocess_error(error: subprocess.CalledProcessError, job_dir: str | None = None) -> dict:
    """外部AIスクリプト失敗時に、UI側で原因を表示しやすい形へ整形する。"""
    response = {
        "message": "A subprocess error occurred",
        "command": str(error.cmd),
        "returncode": error.returncode,
        # レスポンス肥大化を避けるため、詳細ログ本体はジョブディレクトリ側に残す。
        "stdout": (error.stdout or error.output or "")[:2000],
        "stderr": (error.stderr or "")[:2000],
    }
    if job_dir:
        response["job_dir"] = job_dir
    return response


@app.get("/environment/")
async def get_environment_status():
    """AI自動アノテーション機能を利用できる環境か診断する。"""
    return check_environment()


@app.post("/get_framerate/")
async def get_framerate(file: UploadFile = File(...)):
    """動画ファイルからフレームレートを取得する軽量エンドポイント。"""
    start_time = time.time()
    temp_filename = None
    try:
        temp_filename = await save_upload_to_temp(file)
        fps = get_video_framerate(temp_filename)

        end_time = time.time()
        log_api_call("get_framerate", start_time, end_time, "Retrieved frame rate")
        return {"frame_rate": fps}

    except Exception as error:
        end_time = time.time()
        log_api_call("get_framerate", start_time, end_time, f"Error: {str(error)}")
        return JSONResponse(status_code=500, content={"message": "An error occurred", "error": str(error)})
    finally:
        if temp_filename and os.path.exists(temp_filename):
            os.remove(temp_filename)


@app.post("/get_human_images/")
async def get_human_images(file: UploadFile = File(...)):
    """AlphaPoseの検出結果から、各フレームの代表人物画像を切り出して返す。"""
    start_time = time.time()
    temp_filename = None
    job_dir = None
    success = False
    try:
        temp_filename = await save_upload_to_temp(file)
        job_dir = create_job_dir()

        image_data_list = extract_human_images(temp_filename, job_dir)

        end_time = time.time()
        log_api_call("get_human_images", start_time, end_time, f"Extracted {len(image_data_list)} human images")
        success = True
        return JSONResponse(status_code=200, content={"images": image_data_list})

    except subprocess.CalledProcessError as error:
        end_time = time.time()
        error_info = _format_subprocess_error(error, job_dir)
        log_api_call("get_human_images", start_time, end_time, f"Subprocess error: {error_info['stderr'][:200]}")
        return JSONResponse(status_code=500, content=error_info)
    except Exception as error:
        end_time = time.time()
        log_api_call("get_human_images", start_time, end_time, f"Error: {str(error)}")
        content = {"message": "An error occurred", "error": str(error)}
        if job_dir:
            content["job_dir"] = job_dir
        return JSONResponse(status_code=500, content=content)
    finally:
        if temp_filename and os.path.exists(temp_filename):
            os.remove(temp_filename)
        if job_dir:
            if success:
                cleanup_job_dir(job_dir)
            else:
                # 失敗時は原因調査のため、stdout/stderrと中間ファイルを残す。
                log_api_call("get_human_images", 0, 0, f"Job directory preserved for debugging: {job_dir}")


@app.post("/items/")
async def create_item(
    file: UploadFile = File(...),
    autoAnnotationLayer: str = Form(...),
):
    """AlphaPose、MotionBERT、動作検出を順に実行し、自動アノテーション範囲を返す。"""
    start_time = time.time()
    temp_filename = None
    job_dir = None
    success = False
    try:
        auto_annotation_layer = json.loads(autoAnnotationLayer)
        temp_filename = await save_upload_to_temp(file)
        job_dir = create_job_dir()

        motion_times = run_pose_pipeline(temp_filename, auto_annotation_layer, job_dir)

        end_time = time.time()
        log_api_call("create_item", start_time, end_time, f"Processed {len(motion_times)} motion times")
        success = True
        return motion_times

    except subprocess.CalledProcessError as error:
        end_time = time.time()
        error_info = _format_subprocess_error(error, job_dir)
        log_api_call("create_item", start_time, end_time, f"Subprocess error: {error_info['stderr'][:200]}")
        return JSONResponse(status_code=500, content=error_info)
    except Exception as error:
        end_time = time.time()
        log_api_call("create_item", start_time, end_time, f"Error: {str(error)}")
        content = {"message": "An error occurred", "error": str(error)}
        if job_dir:
            content["job_dir"] = job_dir
        return JSONResponse(status_code=500, content=content)
    finally:
        if temp_filename and os.path.exists(temp_filename):
            os.remove(temp_filename)
        if job_dir:
            if success:
                cleanup_job_dir(job_dir)
            else:
                log_api_call("create_item", 0, 0, f"Job directory preserved for debugging: {job_dir}")
