"""FastAPI のHTTP受付層。

重い処理は pipeline.py に委譲し、このファイルではルーティング、一時ファイル管理、ログ、エラー整形だけを扱う。
"""

import asyncio
import json
import os
import subprocess
import tempfile
import time
from datetime import datetime

from fastapi import FastAPI, File, Form, Response, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel

try:
    # 標準起動: リポジトリルートから `python -m uvicorn API.api:app` を実行する。
    from .environment import check_environment
    from .paths import BASE_DIR
    from .progress import (
        clear_progress,
        create_progress_callback,
        get_progress,
        initialize_progress,
        update_progress,
    )
    from .pipeline import (
        cleanup_job_dir,
        create_job_dir,
        extract_human_people,
        get_cached_analysis_results,
        find_cached_analysis_results,
        normalize_analysis_range,
        create_analysis_video,
        slice_alphapose_results,
        find_cached_alphapose_results,
        get_cached_alphapose_results,
        get_video_framerate,
        run_pose_pipeline,
        run_similarity_pipeline,
    )
except ImportError:
    # 互換用: APIディレクトリ内から `uvicorn api:app` で起動した場合も動かす。
    from environment import check_environment
    from paths import BASE_DIR
    from progress import (
        clear_progress,
        create_progress_callback,
        get_progress,
        initialize_progress,
        update_progress,
    )
    from pipeline import (
        cleanup_job_dir,
        create_job_dir,
        extract_human_people,
        get_cached_analysis_results,
        find_cached_analysis_results,
        normalize_analysis_range,
        create_analysis_video,
        slice_alphapose_results,
        find_cached_alphapose_results,
        get_cached_alphapose_results,
        get_video_framerate,
        run_pose_pipeline,
        run_similarity_pipeline,
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
environment_status_cache: dict | None = None
environment_status_lock = asyncio.Lock()


class VideoPathRequest(BaseModel):
    file_path: str
    progressId: str | None = None


class AnalysisRange(BaseModel):
    startFrame: int
    endFrame: int


class HumanImagesPathRequest(VideoPathRequest):
    analysisRange: AnalysisRange | None = None
    singlePerson: bool = False


class ItemsPathRequest(VideoPathRequest):
    autoAnnotationLayer: list[dict]
    analysisStartFrame: int | None = None
    analysisEndFrame: int | None = None
    analysisRange: AnalysisRange | None = None
    singlePerson: bool = False


class SimilarMotionTemplate(BaseModel):
    startFrame: int
    endFrame: int


class SimilarMotionPathRequest(VideoPathRequest):
    humanId: int
    selectedJoints: list[int]
    templateSegments: list[SimilarMotionTemplate]
    searchStartFrame: int | None = None
    searchEndFrame: int | None = None
    layerName: str
    layerIndex: int
    analysisRange: AnalysisRange | None = None
    singlePerson: bool = False


@app.get("/processing/{progress_id}")
async def get_processing_progress(progress_id: str):
    progress = get_progress(progress_id)
    if progress is None:
        return JSONResponse(status_code=404, content={"message": "Progress not found"})
    return progress


def analysis_range_dict(value: AnalysisRange | None) -> dict | None:
    if value is None:
        return None
    return value.model_dump() if hasattr(value, "model_dump") else value.dict()


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


def validate_local_video_path(file_path: str) -> str:
    """Electronから受け取ったローカル動画パスをOpenCVに渡せる形に検証する。"""
    resolved_path = os.path.abspath(os.path.expanduser(file_path))
    if not os.path.isfile(resolved_path):
        raise FileNotFoundError(f"Video file not found: {resolved_path}")
    return resolved_path


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


@app.get("/health/")
async def get_health_status():
    """ElectronからAPIプロセスの起動完了だけを軽量に確認する。"""
    return {"status": "ok"}


@app.get("/environment/")
async def get_environment_status(refresh: bool = False):
    """AI自動アノテーション機能を利用できる環境か診断する。"""
    global environment_status_cache

    if environment_status_cache is not None and not refresh:
        return environment_status_cache

    async with environment_status_lock:
        if environment_status_cache is None or refresh:
            environment_status_cache = await asyncio.to_thread(check_environment)
        return environment_status_cache


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


@app.post("/get_framerate_from_path/")
async def get_framerate_from_path(request: VideoPathRequest):
    """ローカル動画パスからフレームレートを取得する。Electronではアップロードを避けるためこちらを使う。"""
    start_time = time.time()
    try:
        video_path = validate_local_video_path(request.file_path)
        fps = get_video_framerate(video_path)

        end_time = time.time()
        log_api_call("get_framerate_from_path", start_time, end_time, "Retrieved frame rate")
        return {"frame_rate": fps}

    except Exception as error:
        end_time = time.time()
        log_api_call("get_framerate_from_path", start_time, end_time, f"Error: {str(error)}")
        return JSONResponse(status_code=500, content={"message": "An error occurred", "error": str(error)})


@app.post("/get_human_images/")
async def get_human_images(
    file: UploadFile = File(...),
    analysisRange: str | None = Form(None),
    singlePerson: bool = Form(False),
    progressId: str | None = Form(None),
):
    """AlphaPoseの検出結果から、各フレームの代表人物画像を切り出して返す。"""
    start_time = time.time()
    temp_filename = None
    job_dir = None
    success = False
    progress_callback = create_progress_callback(progressId)
    initialize_progress(
        progressId,
        {
            "stage": "入力データの準備",
            "description": "分析する動画と時間範囲を準備しています。",
            "step": 1,
            "totalSteps": 3,
        },
    )
    try:
        temp_filename = await save_upload_to_temp(file)
        job_dir = create_job_dir()

        selected_range = normalize_analysis_range(temp_filename, json.loads(analysisRange) if analysisRange else None)
        if selected_range is None:
            people = await asyncio.to_thread(
                extract_human_people,
                temp_filename,
                job_dir,
                single_person=singlePerson,
                progress_callback=progress_callback,
            )
        else:
            clip_path = await asyncio.to_thread(
                create_analysis_video, temp_filename, selected_range, job_dir
            )
            people = await asyncio.to_thread(
                extract_human_people,
                clip_path,
                job_dir,
                single_person=singlePerson,
                progress_callback=progress_callback,
            )
        image_data_list = [person["image"] for person in people]

        end_time = time.time()
        log_api_call("get_human_images", start_time, end_time, f"Extracted {len(image_data_list)} human images")
        success = True
        return JSONResponse(status_code=200, content={"images": image_data_list, "people": people})

    except subprocess.CalledProcessError as error:
        end_time = time.time()
        error_info = _format_subprocess_error(error, job_dir)
        log_api_call("get_human_images", start_time, end_time, f"Subprocess error: {error_info['stderr'][:200]}")
        return JSONResponse(status_code=500, content=error_info)
    except ValueError as error:
        return JSONResponse(status_code=422, content={"message": "Invalid request", "error": str(error)})
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
        clear_progress(progressId)


@app.post("/get_human_images_from_path/")
async def get_human_images_from_path(request: HumanImagesPathRequest):
    """ローカル動画パスから人物画像を切り出す。Electronではアップロードを避けるためこちらを使う。"""
    start_time = time.time()
    job_dir = None
    success = False
    progress_callback = create_progress_callback(request.progressId)
    initialize_progress(
        request.progressId,
        {
            "stage": "入力データの準備",
            "description": "分析する動画と時間範囲を準備しています。",
            "step": 1,
            "totalSteps": 3,
        },
    )
    try:
        video_path = validate_local_video_path(request.file_path)
        job_dir = create_job_dir()
        selected_range = normalize_analysis_range(video_path, analysis_range_dict(request.analysisRange))
        update_progress(
            request.progressId,
            {
                "stage": "2次元姿勢推定",
                "description": "AlphaPoseの検出結果を確認しています。",
                "step": 2,
                "totalSteps": 3,
            },
        )
        if selected_range is None:
            clip_path, alphapose_results_path, alphapose_cache_hit = await asyncio.to_thread(
                get_cached_analysis_results, video_path, None
            )
        else:
            range_results = find_cached_analysis_results(video_path, selected_range)
            full_results = find_cached_alphapose_results(video_path)
            if range_results is not None:
                clip_path, alphapose_results_path, alphapose_cache_hit = await asyncio.to_thread(
                    get_cached_analysis_results, video_path, selected_range
                )
            elif full_results is not None:
                clip_path = await asyncio.to_thread(
                    create_analysis_video, video_path, selected_range, job_dir
                )
                alphapose_results_path = await asyncio.to_thread(
                    slice_alphapose_results,
                    full_results,
                    selected_range,
                    job_dir,
                    allow_empty=True,
                )
                alphapose_cache_hit = True
            else:
                clip_path, alphapose_results_path, alphapose_cache_hit = await asyncio.to_thread(
                    get_cached_analysis_results, video_path, selected_range
                )

        update_progress(
            request.progressId,
            {
                "stage": "2次元姿勢推定",
                "description": (
                    "キャッシュ済みの姿勢推定結果を利用します。"
                    if alphapose_cache_hit
                    else "AlphaPoseによる姿勢推定が完了しました。"
                ),
                "step": 2,
                "totalSteps": 3,
                "cacheHit": alphapose_cache_hit,
            },
        )
        people = await asyncio.to_thread(
            extract_human_people,
            clip_path,
            job_dir,
            alphapose_results_path,
            single_person=request.singlePerson,
            progress_callback=progress_callback,
        )
        image_data_list = [person["image"] for person in people]

        end_time = time.time()
        log_api_call("get_human_images_from_path", start_time, end_time, f"Extracted {len(image_data_list)} human images, alphapose_cache_hit={alphapose_cache_hit}")
        success = True
        return JSONResponse(
            status_code=200,
            content={
                "images": image_data_list,
                "people": people,
                "alphaposeCache": {"hit": alphapose_cache_hit},
            },
        )

    except subprocess.CalledProcessError as error:
        end_time = time.time()
        error_info = _format_subprocess_error(error, job_dir)
        log_api_call("get_human_images_from_path", start_time, end_time, f"Subprocess error: {error_info['stderr'][:200]}")
        return JSONResponse(status_code=500, content=error_info)
    except ValueError as error:
        return JSONResponse(status_code=422, content={"message": "Invalid request", "error": str(error)})
    except Exception as error:
        end_time = time.time()
        log_api_call("get_human_images_from_path", start_time, end_time, f"Error: {str(error)}")
        content = {"message": "An error occurred", "error": str(error)}
        if job_dir:
            content["job_dir"] = job_dir
        return JSONResponse(status_code=500, content=content)
    finally:
        if job_dir:
            if success:
                cleanup_job_dir(job_dir)
            else:
                # 失敗時は原因調査のため、stdout/stderrと中間ファイルを残す。
                log_api_call("get_human_images_from_path", 0, 0, f"Job directory preserved for debugging: {job_dir}")
        clear_progress(request.progressId)


@app.post("/items/")
async def create_item(
    file: UploadFile = File(...),
    autoAnnotationLayer: str = Form(...),
    analysisStartFrame: int | None = Form(None),
    analysisEndFrame: int | None = Form(None),
    analysisRange: str | None = Form(None),
    singlePerson: bool = Form(False),
    progressId: str | None = Form(None),
):
    """AlphaPose、MotionBERT、動作検出を順に実行し、自動アノテーション範囲を返す。"""
    start_time = time.time()
    temp_filename = None
    job_dir = None
    success = False
    progress_callback = create_progress_callback(progressId)
    initialize_progress(
        progressId,
        {
            "stage": "入力データの準備",
            "description": "分析する動画と検出設定を準備しています。",
            "step": 1,
            "totalSteps": 5,
        },
    )
    try:
        auto_annotation_layer = json.loads(autoAnnotationLayer)
        temp_filename = await save_upload_to_temp(file)
        job_dir = create_job_dir()

        motion_times = await asyncio.to_thread(
            run_pose_pipeline,
            temp_filename,
            auto_annotation_layer,
            job_dir,
            analysis_start_frame=analysisStartFrame,
            analysis_end_frame=analysisEndFrame,
            analysis_range=json.loads(analysisRange) if analysisRange else None,
            single_person=singlePerson,
            progress_callback=progress_callback,
        )

        end_time = time.time()
        log_api_call("create_item", start_time, end_time, f"Processed {len(motion_times)} motion times")
        success = True
        return motion_times

    except subprocess.CalledProcessError as error:
        end_time = time.time()
        error_info = _format_subprocess_error(error, job_dir)
        log_api_call("create_item", start_time, end_time, f"Subprocess error: {error_info['stderr'][:200]}")
        return JSONResponse(status_code=500, content=error_info)
    except ValueError as error:
        return JSONResponse(status_code=422, content={"message": "Invalid request", "error": str(error)})
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
        clear_progress(progressId)


@app.post("/items_from_path/")
async def create_item_from_path(request: ItemsPathRequest, response: Response):
    """ローカル動画パスから自動アノテーションパイプラインを実行する。Electronではアップロードを避けるためこちらを使う。"""
    start_time = time.time()
    job_dir = None
    success = False
    progress_callback = create_progress_callback(request.progressId)
    initialize_progress(
        request.progressId,
        {
            "stage": "入力データの準備",
            "description": "分析する動画と検出設定を準備しています。",
            "step": 1,
            "totalSteps": 5,
        },
    )
    try:
        video_path = validate_local_video_path(request.file_path)
        job_dir = create_job_dir()
        analysis_range = analysis_range_dict(request.analysisRange)
        if analysis_range is None and request.analysisStartFrame is not None and request.analysisEndFrame is not None:
            analysis_range = {
                "startFrame": request.analysisStartFrame,
                "endFrame": request.analysisEndFrame,
            }
        update_progress(
            request.progressId,
            {
                "stage": "2次元姿勢推定",
                "description": "AlphaPoseの検出結果を確認しています。",
                "step": 2,
                "totalSteps": 5,
            },
        )
        if analysis_range is None:
            alphapose_results_path, alphapose_cache_hit = await asyncio.to_thread(
                get_cached_alphapose_results, video_path
            )
        else:
            alphapose_results_path = find_cached_analysis_results(video_path, analysis_range) or find_cached_alphapose_results(video_path)
            alphapose_cache_hit = alphapose_results_path is not None

        pipeline_metadata = {}
        update_progress(
            request.progressId,
            {
                "stage": "2次元姿勢推定",
                "description": (
                    "キャッシュ済みの姿勢推定結果を利用します。"
                    if alphapose_cache_hit
                    else "AlphaPoseで動画内の人物と関節位置を検出しています。"
                ),
                "step": 2,
                "totalSteps": 5,
                "cacheHit": alphapose_cache_hit,
            },
        )
        motion_times = await asyncio.to_thread(
            run_pose_pipeline,
            video_path,
            request.autoAnnotationLayer,
            job_dir,
            alphapose_results_path,
            analysis_start_frame=request.analysisStartFrame,
            analysis_end_frame=request.analysisEndFrame,
            analysis_range=analysis_range,
            use_motionbert_cache=True,
            pipeline_metadata=pipeline_metadata,
            single_person=request.singlePerson,
            progress_callback=progress_callback,
        )

        motionbert_cache = pipeline_metadata.get("motionbertCache", {})
        response.headers["X-MotionBERT-Cache-Hit"] = str(
            motionbert_cache.get("allHit", False)
        ).lower()
        response.headers["X-MotionBERT-Cache-Hits"] = (
            f"{motionbert_cache.get('hits', 0)}/{motionbert_cache.get('total', 0)}"
        )
        end_time = time.time()
        log_api_call(
            "create_item_from_path",
            start_time,
            end_time,
            f"Processed {len(motion_times)} motion times, alphapose_cache_hit={alphapose_cache_hit}, "
            f"motionbert_cache_hits={motionbert_cache.get('hits', 0)}/{motionbert_cache.get('total', 0)}",
        )
        success = True
        return motion_times

    except subprocess.CalledProcessError as error:
        end_time = time.time()
        error_info = _format_subprocess_error(error, job_dir)
        log_api_call("create_item_from_path", start_time, end_time, f"Subprocess error: {error_info['stderr'][:200]}")
        return JSONResponse(status_code=500, content=error_info)
    except ValueError as error:
        return JSONResponse(status_code=422, content={"message": "Invalid request", "error": str(error)})
    except Exception as error:
        end_time = time.time()
        log_api_call("create_item_from_path", start_time, end_time, f"Error: {str(error)}")
        content = {"message": "An error occurred", "error": str(error)}
        if job_dir:
            content["job_dir"] = job_dir
        return JSONResponse(status_code=500, content=content)
    finally:
        if job_dir:
            if success:
                cleanup_job_dir(job_dir)
            else:
                log_api_call("create_item_from_path", 0, 0, f"Job directory preserved for debugging: {job_dir}")
        clear_progress(request.progressId)


@app.post("/similar_motion_from_path/")
async def detect_similar_motion_from_path(request: SimilarMotionPathRequest):
    """指定人物・関節・テンプレート区間を基に、v40で類似動作候補を検索する。"""
    start_time = time.time()
    job_dir = None
    success = False
    progress_callback = create_progress_callback(request.progressId)
    initialize_progress(
        request.progressId,
        {
            "stage": "入力データの準備",
            "description": "テンプレートと検索範囲を準備しています。",
            "step": 1,
            "totalSteps": 5,
        },
    )
    try:
        if not request.templateSegments:
            raise ValueError("templateSegments must contain at least one interval")

        video_path = validate_local_video_path(request.file_path)
        job_dir = create_job_dir()
        analysis_range = analysis_range_dict(request.analysisRange)
        if analysis_range is None and request.searchStartFrame is not None and request.searchEndFrame is not None:
            analysis_range = {
                "startFrame": min(request.searchStartFrame, *(segment.startFrame for segment in request.templateSegments)),
                "endFrame": max(request.searchEndFrame, *(segment.endFrame for segment in request.templateSegments)),
            }
        validated_range = normalize_analysis_range(video_path, analysis_range)
        if validated_range is not None and any(
            segment.startFrame < validated_range["startFrame"] or segment.endFrame > validated_range["endFrame"]
            for segment in request.templateSegments
        ):
            raise ValueError("Template segment must be fully contained in analysisRange")
        update_progress(
            request.progressId,
            {
                "stage": "2次元姿勢推定",
                "description": "AlphaPoseの検出結果を確認しています。",
                "step": 2,
                "totalSteps": 5,
            },
        )
        if analysis_range is None:
            alphapose_results_path, alphapose_cache_hit = await asyncio.to_thread(
                get_cached_alphapose_results, video_path
            )
        else:
            alphapose_results_path = find_cached_analysis_results(video_path, analysis_range) or find_cached_alphapose_results(video_path)
            alphapose_cache_hit = alphapose_results_path is not None
        template_segments = [
            segment.model_dump() if hasattr(segment, "model_dump") else segment.dict()
            for segment in request.templateSegments
        ]
        update_progress(
            request.progressId,
            {
                "stage": "2次元姿勢推定",
                "description": (
                    "キャッシュ済みの姿勢推定結果を利用します。"
                    if alphapose_cache_hit
                    else "AlphaPoseで動画内の人物と関節位置を検出しています。"
                ),
                "step": 2,
                "totalSteps": 5,
                "cacheHit": alphapose_cache_hit,
            },
        )
        result = await asyncio.to_thread(
            run_similarity_pipeline,
            video_file_path=video_path,
            human_id=request.humanId,
            selected_joints=request.selectedJoints,
            template_segments=template_segments,
            search_start_frame=request.searchStartFrame,
            search_end_frame=request.searchEndFrame,
            analysis_range=analysis_range,
            layer_name=request.layerName,
            layer_index=request.layerIndex,
            job_dir=job_dir,
            alphapose_results_path=alphapose_results_path,
            single_person=request.singlePerson,
            progress_callback=progress_callback,
        )

        end_time = time.time()
        log_api_call(
            "similar_motion_from_path",
            start_time,
            end_time,
            f"Processed {len(result['candidates'])} similar motion candidates, "
            f"alphapose_cache_hit={alphapose_cache_hit}, "
            f"motionbert_cache_hit={result['motionbertCache']['hit']}, "
            f"similarity_cache_hit={result['similarityCache']['hit']}",
        )
        success = True
        result["alphaposeCache"] = {"hit": alphapose_cache_hit}
        return result

    except subprocess.CalledProcessError as error:
        end_time = time.time()
        error_info = _format_subprocess_error(error, job_dir)
        log_api_call("similar_motion_from_path", start_time, end_time, f"Subprocess error: {error_info['stderr'][:200]}")
        return JSONResponse(status_code=500, content=error_info)
    except ValueError as error:
        end_time = time.time()
        log_api_call("similar_motion_from_path", start_time, end_time, f"Invalid request: {str(error)}")
        return JSONResponse(status_code=422, content={"message": "Invalid request", "error": str(error)})
    except Exception as error:
        end_time = time.time()
        log_api_call("similar_motion_from_path", start_time, end_time, f"Error: {str(error)}")
        content = {"message": "An error occurred", "error": str(error)}
        if job_dir:
            content["job_dir"] = job_dir
        return JSONResponse(status_code=500, content=content)
    finally:
        if job_dir:
            if success:
                cleanup_job_dir(job_dir)
            else:
                log_api_call("similar_motion_from_path", 0, 0, f"Job directory preserved for debugging: {job_dir}")
        clear_progress(request.progressId)
