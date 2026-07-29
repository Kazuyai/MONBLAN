from fastapi import FastAPI, UploadFile, File, Form, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
import subprocess
import os
import cv2
import tempfile
import json
import base64
import time
from datetime import datetime

app = FastAPI()

origins = ["*"]
# CORSの設定を追加
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ログを記録する関数
def log_api_call(api_name: str, start_time: float, end_time: float, additional_info: str = ""):
    duration = end_time - start_time
    current_time = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    log_entry = f"Time: {current_time}, API: {api_name}, Duration: {duration:.2f}s, Info: {additional_info}\n"
    with open("api_log.txt", "a", encoding='utf-8') as log_file:
        log_file.write(log_entry)

# AlphaPoseのコードを実行する関数
def run_alphapose(video_file_path):
    # AlphaPoseのコードを実行
    a = subprocess.run(['python', 'scripts/demo_inference.py', '--cfg', 'configs/halpe_26/resnet/256x192_res50_lr1e-3_1x.yaml',
                        '--checkpoint', 'pretrained_models/halpe26_fast_res50_256x192.pth', '--video', video_file_path,
                        '--outdir', '../out', '--pose_track'], shell=True)
    return a

@app.post("/get_framerate/")
async def get_framerate(file: UploadFile = File(...)):
    start_time = time.time()
    api_name = "get_framerate"
    try:
        # 一時ファイルとして動画を保存
        contents = await file.read()
        with tempfile.NamedTemporaryFile(delete=False, suffix=".mp4") as temp_file:
            temp_file.write(contents)
            temp_filename = temp_file.name

        # OpenCVを使って動画を読み込み
        cap = cv2.VideoCapture(temp_filename)
        if not cap.isOpened():
            return JSONResponse(status_code=400, content={"message": "Error opening video file"})

        # フレームレートを取得
        fps = cap.get(cv2.CAP_PROP_FPS)
        cap.release()

        # 一時ファイルを削除
        os.remove(temp_filename)

        end_time = time.time()
        log_api_call(api_name, start_time, end_time, "Retrieved frame rate")

        return {"frame_rate": fps}
    except Exception as e:
        end_time = time.time()
        log_api_call(api_name, start_time, end_time, f"Error: {str(e)}")
        return JSONResponse(status_code=500, content={"message": "An error occurred", "error": str(e)})

@app.post("/get_human_images/")
async def get_human_images(file: UploadFile = File(...)):
    start_time = time.time()
    api_name = "get_human_images"
    try:
        # 一時ファイルとして動画を保存
        contents = await file.read()
        with tempfile.NamedTemporaryFile(delete=False, suffix=".mp4") as temp_file:
            temp_file.write(contents)
            temp_filename = temp_file.name

        # AlphaPoseディレクトリに移動
        os.chdir('AlphaPose')

        # AlphaPoseのコードを実行
        run_alphapose(temp_filename)

        print("AlphaPose END")

        with open("../out/alphapose-results.json", 'r', encoding='utf-8') as jsonfile:
            alphapose_results = json.load(jsonfile)
            
        print("alphapose_results:", alphapose_results)

        # idxごとにデータを整理
        alphapose_results_grouped_by_idx = {}
        for item in alphapose_results:
            idx = item["idx"]
            if idx not in alphapose_results_grouped_by_idx:
                alphapose_results_grouped_by_idx[idx] = []
            alphapose_results_grouped_by_idx[idx].append(item)
        
        print("alphapose_results_grouped_by_idx:", alphapose_results_grouped_by_idx)

        # 各idxごとにboxの四角形が最も大きいものを選択
        human_images = []
        for idx, items in alphapose_results_grouped_by_idx.items():
            max_area = 0
            max_item = None
            for item in items:
                box = item["box"]  # [x, y, w, h] の形式

                x, y, w, h = map(int, [box[0], box[1], box[2], box[3]])
                area = w * h  # 面積を計算

                if area > max_area:
                    max_area = area
                    max_item = item
            human_images.append(max_item)
            
        # 各idxごとにboxの範囲を画像で切り出す
        image_data_list = []
        cap = cv2.VideoCapture(temp_filename)

        print("cap.isOpened()", cap.isOpened())

        print("cap.get(cv2.CAP_PROP_FRAME_COUNT):", cap.get(cv2.CAP_PROP_FRAME_COUNT))
        for item in human_images:
            frame_id = int(item["image_id"].split(".")[0])
            box = item["box"]  # [x, y, w, h] の形式

            print("frame_id:", frame_id)

            # 動画キャプチャを再初期化
            cap = cv2.VideoCapture(temp_filename)
            if not cap.isOpened():
                return JSONResponse(status_code=400, content={"message": "Error opening video file"})

            # フレームを順次読み込む
            current_frame = 0
            while current_frame <= frame_id:
                ret, frame = cap.read()
                if not ret:
                    return JSONResponse(status_code=400, content={"message": f"Error reading frame {current_frame}"})
                current_frame += 1

            print(f"Requested frame: {frame_id}, Current frame: {current_frame}")

            # 画像を切り出す (boxは[x, y, w, h]の形式)
            x, y, w, h = map(int, [box[0], box[1], box[2], box[3]])
            x2 = x + w
            y2 = y + h

            # 座標をフレームの境界内に収める
            height, width, _ = frame.shape
            x = max(0, min(x, width))
            y = max(0, min(y, height))
            x2 = max(0, min(x2, width))
            y2 = max(0, min(y2, height))

            # 無効な座標チェック
            if x >= x2 or y >= y2:
                print(f"Invalid box coordinates: {box}")
                continue

            cropped = frame[y:y2, x:x2]

            print("cropped:", cropped.shape)

            # 画像をJPEG形式にエンコードし、Base64エンコードする
            _, img_encoded = cv2.imencode('.jpg', cropped)
            encoded_image = base64.b64encode(img_encoded).decode('utf-8')
            image_data_list.append(encoded_image)

        cap.release()

        # 一時ファイルを削除
        os.remove(temp_filename)

        # 元のディレクトリに戻る
        os.chdir('../')

        end_time = time.time()
        log_api_call(api_name, start_time, end_time, f"Extracted {len(image_data_list)} human images")

        print("END")

        return JSONResponse(status_code=200, content={"images": image_data_list})

    except Exception as e:
        end_time = time.time()
        log_api_call(api_name, start_time, end_time, f"Error: {str(e)}")
        return JSONResponse(status_code=500, content={"message": "An error occurred", "error": str(e)})

@app.post("/items/")
async def create_item(
    file: UploadFile = File(...),
    autoAnnotationLayer: str = Form(...)
):
    start_time = time.time()
    api_name = "create_item"
    try:
        # autoAnnotationLayer
        auto_annotation_layer = json.loads(autoAnnotationLayer)
        print("autoAnnotationLayer:", auto_annotation_layer)

        # 一時ファイルとして動画を保存
        contents = await file.read()
        with tempfile.NamedTemporaryFile(delete=False, suffix=".mp4") as temp_file:
            temp_file.write(contents)
            temp_filename = temp_file.name

        # AlphaPoseディレクトリに移動
        os.chdir('AlphaPose')

        # AlphaPoseのコードを実行
        run_alphapose(temp_filename)

        print("AlphaPose END")

        # ここからMotionBERTの処理
        motion_times = []
        auto_annotation_layer_grouped_by_human_id = {}
        for item in auto_annotation_layer:
            humanId = item["humanId"]
            if humanId not in auto_annotation_layer_grouped_by_human_id:
                auto_annotation_layer_grouped_by_human_id[humanId] = []
            auto_annotation_layer_grouped_by_human_id[humanId].append(item)

        print(auto_annotation_layer_grouped_by_human_id)

        for humanId, auto_annotation_layer in auto_annotation_layer_grouped_by_human_id.items():
            print("humanId:", humanId)
            print(auto_annotation_layer)
            os.chdir('../MotionBERT')

            # MotionBERTのコードを実行
            focus = str(humanId + 1)
            print("focus:", focus)
            subprocess.run(['python', 'infer_wild.py', '--vid_path', temp_filename, '--json_path',
                            '../out/alphapose-results.json', '--out_path', '../detect_movement', '--focus', focus], shell=True)

            print("MotionBERT END")

            os.chdir('../detect_movement')

            # npy形式のファイルをcsv形式に変換
            subprocess.run(['python', 'npy2csv.py'], shell=True)

            print("npy2csv END")

            # 外積の値を計算
            subprocess.run(['python', 'calc_keypoint_cross_product_rotate.py'], shell=True)

            print("calc_keypoint_cross_product END")

            # auto_annotation_layer を JSON ファイルに保存
            with open('auto_annotation_layer.json', 'w', encoding='utf-8') as f:
                json.dump(auto_annotation_layer, f, ensure_ascii=False, indent=4)

            # 動作範囲の検出
            subprocess.run(['python', 'detect_movement.py', temp_filename, 'auto_annotation_layer.json'], check=True)

            # 結果のjsonファイルを取得
            with open("motion_times.json", 'r', encoding='utf-8') as jsonfile:
                motion_times += json.load(jsonfile)

        # layerIndexでソート
        motion_times = sorted(motion_times, key=lambda x: x['layerIndex'])

        print("END")

        # 一時ファイルを削除
        os.remove(temp_filename)
        
        # 元のディレクトリに戻る
        os.chdir('../')

        end_time = time.time()
        log_api_call(api_name, start_time, end_time, f"Processed {len(motion_times)} motion times")

        return motion_times
    except subprocess.CalledProcessError as e:
        end_time = time.time()
        log_api_call(api_name, start_time, end_time, f"Subprocess error: {str(e)}")
        return JSONResponse(status_code=500, content={"message": "A subprocess error occurred", "error": str(e)})
    except Exception as e:
        end_time = time.time()
        log_api_call(api_name, start_time, end_time, f"Error: {str(e)}")
        return JSONResponse(status_code=500, content={"message": "An error occurred", "error": str(e)})
