"""FastAPI HTTP routing layer for the annotation API."""

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

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

LOG_FILE = os.path.join(BASE_DIR, "api_log.txt")


def log_api_call(api_name: str, start_time: float, end_time: float, additional_info: str = ""):
    duration = end_time - start_time
    current_time = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    log_entry = f"Time: {current_time}, API: {api_name}, Duration: {duration:.2f}s, Info: {additional_info}\n"
    with open(LOG_FILE, "a", encoding="utf-8") as log_file:
        log_file.write(log_entry)


async def save_upload_to_temp(file: UploadFile) -> str:
    contents = await file.read()
    with tempfile.NamedTemporaryFile(delete=False, suffix=".mp4") as temp_file:
        temp_file.write(contents)
        return temp_file.name


def _format_subprocess_error(error: subprocess.CalledProcessError) -> dict:
    return {
        "message": "A subprocess error occurred",
        "command": str(error.cmd),
        "returncode": error.returncode,
        "stdout": (error.stdout or error.output or "")[:2000],
        "stderr": (error.stderr or "")[:2000],
    }


@app.get("/environment/")
async def get_environment_status():
    return check_environment()


@app.post("/get_framerate/")
async def get_framerate(file: UploadFile = File(...)):
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
        error_info = _format_subprocess_error(error)
        log_api_call("get_human_images", start_time, end_time, f"Subprocess error: {error_info['stderr'][:200]}")
        return JSONResponse(status_code=500, content=error_info)
    except Exception as error:
        end_time = time.time()
        log_api_call("get_human_images", start_time, end_time, f"Error: {str(error)}")
        return JSONResponse(status_code=500, content={"message": "An error occurred", "error": str(error)})
    finally:
        if temp_filename and os.path.exists(temp_filename):
            os.remove(temp_filename)
        if job_dir:
            if success:
                cleanup_job_dir(job_dir)
            else:
                log_api_call("get_human_images", 0, 0, f"Job directory preserved for debugging: {job_dir}")


@app.post("/items/")
async def create_item(
    file: UploadFile = File(...),
    autoAnnotationLayer: str = Form(...),
):
    start_time = time.time()
    temp_filename = None
    try:
        auto_annotation_layer = json.loads(autoAnnotationLayer)
        temp_filename = await save_upload_to_temp(file)

        motion_times = run_pose_pipeline(temp_filename, auto_annotation_layer)

        end_time = time.time()
        log_api_call("create_item", start_time, end_time, f"Processed {len(motion_times)} motion times")
        return motion_times

    except subprocess.CalledProcessError as error:
        end_time = time.time()
        error_info = _format_subprocess_error(error)
        log_api_call("create_item", start_time, end_time, f"Subprocess error: {error_info['stderr'][:200]}")
        return JSONResponse(status_code=500, content=error_info)
    except Exception as error:
        end_time = time.time()
        log_api_call("create_item", start_time, end_time, f"Error: {str(error)}")
        return JSONResponse(status_code=500, content={"message": "An error occurred", "error": str(error)})
    finally:
        if temp_filename and os.path.exists(temp_filename):
            os.remove(temp_filename)
