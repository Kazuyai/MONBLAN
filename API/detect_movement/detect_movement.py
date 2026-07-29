import csv
import numpy as np
import cv2
import json
import matplotlib.pyplot as plt

# 各キーポイントに対応する名称
keypoint_names = [
    'root',         # 0    None
    '右腰',         # 1
    '右ひざ',       # 2
    'right_foot',   # 3    None
    '左腰',         # 4
    '左ひざ',       # 5
    'left_foot',    # 6    None
    '胴体',         # 7
    '首',           # 8
    '鼻',           # 9
    '頭',           # 10   None
    '左肩',         # 11
    '左ひじ',       # 12
    'left_wrist',   # 13   None
    '右肩',         # 14
    '右ひじ',       # 15
    'right_wrist'   # 16   None
]

# パラメータの初期化
START_THRESHOLD = {'x': [], 'y': [], 'z': []}
END_THRESHOLD = {'x': [], 'y': [], 'z': []}
HOME_POSITION_THRESHOLD = {'x': 0, 'y': 0, 'z': 0}

# 手動で設定するパラメータ
HOME_POSITION_FRAME = 0  # ホームポジションのフレーム番号
MIN_DURATION = 4  # 最小動作継続フレーム数
MAX_GAP = 3  # 動作範囲を合成する際の最大ギャップ

# 軸の変化量の最小値をキーポイントごとに定義
MIN_AXIS_DIFF = [
    None,   # root
    0.10,   # 右腰
    0.10,   # 右ひざ
    None,   # 右足
    0.10,   # 左腰
    0.10,   # 左ひざ
    None,   # 左足
    0.10,   # 背中
    0.02,   # 首
    0.10,   # 鼻
    None,   # 頭
    0.02,   # 左肩
    0.02,   # 左ひじ
    None,   # 左手首
    0.02,   # 右肩
    0.02,   # 右ひじ
    None,   # 右手首
]

# CSVファイルのパスを指定
file_path = "output_cross_product.csv"

# 動画からFPSを取得する関数
def get_fps(video_path):
    cap = cv2.VideoCapture(video_path)
    fps = cap.get(cv2.CAP_PROP_FPS)
    cap.release()
    return fps

# データのスムージング（移動平均フィルタ）
def smooth_data(data, window_size=3):
    return np.convolve(data, np.ones(window_size)/window_size, mode='same')

# 動作の開始と終了のタイミングを検出する関数
def detect_motion(axis_data, home_position, start_threshold, end_threshold, home_position_threshold, min_duration, min_axis_diff):
    num_frames = len(axis_data)
    start_frames = []
    end_frames = []
    motion_active = False
    motion_start_frame = None

    # 各フレームの各軸に対する状態を管理するリスト
    # 0: 静止, 1: 動作あり(仮), 2: 動作中
    state = [0] * num_frames

    for frame_id in range(num_frames):
        # 前のフレームとの差分を計算
        if frame_id > 0:
            diff = abs(axis_data[frame_id] - axis_data[frame_id - 1])
            threshold = start_threshold[frame_id]
            # print(f"frame_id: {frame_id}, diff: {diff}, threshold: {threshold}")
            if diff > threshold:
                state[frame_id] = 1
                
    print(f"state: {state}")

    for frame_id in range(1, num_frames):
        if state[frame_id] == 1:
            count = 0
            for i in range(frame_id, num_frames):
                if state[i] == 1:
                    count += 1
                else:
                    break
            if count >= min_duration:
                for i in range(frame_id, frame_id + count):
                    state[i] = 2

    # 動作開始と終了のフレームを検出
    motion_start_frame = None
    for frame_id, value in enumerate(state, start=1):
        if value == 2:
            if motion_start_frame is None:
                motion_start_frame = frame_id
            elif frame_id == len(state):
                start_frames.append(motion_start_frame)
                end_frames.append(frame_id)
        else:
            if motion_start_frame is not None:
                if frame_id - motion_start_frame >= min_duration:
                    start_frames.append(motion_start_frame)
                    end_frames.append(frame_id - 1)
                motion_start_frame = None

    # 各動作範囲で最大値最小値を求め、一定値以下ならその動作範囲を動作なしとみなす
    new_start_frames = []
    new_end_frames = []

    for i in range(len(start_frames)):
        start = start_frames[i]
        end = end_frames[i]
        if max(axis_data[start-1:end]) - min(axis_data[start-1:end]) > min_axis_diff:
            new_start_frames.append(start)
            new_end_frames.append(end)
        else:
            # 動作なしとみなし、stateを更新
            for j in range(start, end+1):
                state[j - 1] = 0

    # 動作あり(2)と動作あり(2)の間にある短い静止状態を動作中とみなす
    max_gap = MAX_GAP
    last_motion_end = -1
    for i in range(len(new_start_frames)):
        start = new_start_frames[i]
        end = new_end_frames[i]
        if start - last_motion_end <= max_gap:
            for j in range(last_motion_end + 1, start):
                state[j - 1] = 2
        last_motion_end = end

    # stateから動作範囲を再取得
    start_frames = []
    end_frames = []
    motion_start_frame = None
    for frame_id, value in enumerate(state, start=1):
        if value == 2:
            if motion_start_frame is None:
                motion_start_frame = frame_id
            elif frame_id == num_frames:
                start_frames.append(motion_start_frame)
                end_frames.append(frame_id)
        else:
            if motion_start_frame is not None:
                if frame_id - motion_start_frame >= min_duration:
                    start_frames.append(motion_start_frame)
                    end_frames.append(frame_id - 1)
                motion_start_frame = None

    return start_frames, end_frames, state

# 動作範囲を合成する関数
def combine_motion_ranges(start_frames_list, end_frames_list):
    combined_intervals = []
    for start_frames, end_frames in zip(start_frames_list, end_frames_list):
        combined_intervals.extend(zip(start_frames, end_frames))

    if not combined_intervals:
        return [], []

    combined_intervals.sort()

    merged_intervals = []
    current_start, current_end = combined_intervals[0]

    for start, end in combined_intervals[1:]:
        if start <= current_end:
            current_end = max(current_end, end)
        else:
            merged_intervals.append((current_start, current_end))
            current_start, current_end = start, end

    merged_intervals.append((current_start, current_end))

    start_frames, end_frames = zip(*merged_intervals)
    return list(start_frames), list(end_frames)

# HOME_POSITION_THRESHOLDに上限値を設定
max_home_threshold = {
    'x': 10,  # 適切な上限値を設定
    'y': 10,
    'z': 10
}

# 自動で設定するパラメータの値を設定する（修正）
def set_parameter(keypoint_data, window_size=30):
    num_frames = len(keypoint_data['x'])
    for axis in ['x', 'y', 'z']:
        data = keypoint_data[axis]
        smoothed_data = smooth_data(data)

        # 差分を計算
        # diffs = np.abs(np.diff(smoothed_data))
        diffs = smoothed_data

        # 各フレームごとに閾値を計算
        thresholds = []
        for frame_id in range(num_frames):
            # ウィンドウの開始と終了を決定
            start = max(0, frame_id - window_size)
            end = min(num_frames - 1, frame_id + window_size)

            # # ウィンドウ内の差分を取得
            # window_diffs = diffs[start:end]

            # # 差分の中央値と標準偏差を計算
            # if len(window_diffs) > 0:
            #     median_diffs = np.median(window_diffs)
            #     std_diffs = np.std(window_diffs)
            # else:
            #     median_diffs = 0
            #     std_diffs = 0

            # # 閾値を設定
            # k = 1.0  # 必要に応じて調整
            # threshold = median_diffs + k * std_diffs
            
            # 範囲内の最大値と最小値の差を取得
            min_diff = min(diffs[start:end])
            max_diff = max(diffs[start:end])
            diff = max_diff - min_diff
            threshold = diff / 30
            
            thresholds.append(threshold)

        START_THRESHOLD[axis] = thresholds
        END_THRESHOLD[axis] = thresholds
        
        # print(f"start_threshold: {START_THRESHOLD}")

        # HOME_POSITION_THRESHOLDを標準偏差に基づいて設定し、上限を適用
        std_dev = np.std(smoothed_data)
        home_k = 1.0  # 必要に応じて調整
        threshold_home = home_k * std_dev
        HOME_POSITION_THRESHOLD[axis] = min(threshold_home, max_home_threshold[axis])

# 軸の変化量に基づいて軸を選択する関数
def set_combine_axes(keypoint_data, min_axis_diff):
    axis_diffs = {}
    for axis in ['x', 'y', 'z']:
        axis_values = keypoint_data[axis]
        # 軸の最大値と最小値の差を計算
        axis_diffs[axis] = max(axis_values) - min(axis_values)

    # 定数のしきい値以上の変化量を持つ軸から変化量が多い順に選択　(上限は2つ)
    selected_axes = [axis for axis, diff in axis_diffs.items() if diff > min_axis_diff]
    selected_axes = sorted(selected_axes, key=lambda x: axis_diffs[x], reverse=True)[:2]

    # 選択された軸がない場合、最大の変化量を持つ軸を選択
    if not selected_axes:
        selected_axes = [max(axis_diffs, key=axis_diffs.get)]

    print(f"Axis differences: {axis_diffs}")
    print(f"Selected Axes: {selected_axes}")

    return selected_axes

# 動作範囲データを取得する関数
def get_motion_times(start_frames, end_frames, frame_rate, layer_name, layer_index):
    motion_times = []
    for start, end, index in zip(start_frames, end_frames, range(len(start_frames))):
        motion_times.append({
            'startFrame': start,
            'endFrame': end,
            'text': str(index + 1),
            'layerName': layer_name,
            'layerIndex': layer_index
        })
    return motion_times

# 必要に応じてJSONファイルに書き出す関数
def write_motion_times_to_json(motion_times, output_file):
    with open(output_file, 'w', encoding='utf-8') as jsonfile:
        json.dump(motion_times, jsonfile, ensure_ascii=False, indent=4)

# プロットを画像として保存する関数
def plot_and_save(axis_data, smoothed_data, state, axis, keypoint_name, layer_name, SELECTED_KEYPOINT):
    plt.figure(figsize=(12, 6))
    frames = np.arange(len(axis_data))
    plt.plot(frames, axis_data, label='Original Data', alpha=0.5)
    plt.plot(frames, smoothed_data, label='Smoothed Data', linewidth=2)
    plt.fill_between(frames, min(axis_data), max(axis_data), where=[s == 2 for s in state], color='red', alpha=0.3, label='Detected Motion')
    plt.title(f'{layer_name} - {keypoint_name} - {axis}-axis')
    plt.xlabel('Frame')
    plt.ylabel('Value')
    plt.legend()
    plt.tight_layout()
    # 保存先のパスを指定
    filename = f'./plot/plot_{layer_name}_{axis}.png'
    plt.savefig(filename)
    plt.close()

# メインの処理関数
def process_video(video_file_path, auto_annotation_layer):
    # 動画のFPSを取得
    FRAME_RATE = get_fps(video_file_path)

    # CSVファイルの読み込み
    with open(file_path, newline='') as csvfile:
        reader = csv.reader(csvfile)
        header = next(reader)  # ヘッダー行を読み飛ばす
        data = list(reader)

    # 全フレーム数を取得
    num_frames = len(data)

    # 選択されたキーポイントごとに処理
    all_motion_times = []
    for layer in auto_annotation_layer:
        print("--------------------------------------------------")
        layer_name = layer['layerName']
        points = layer['points']
        layer_index = layer.get('index', 0)
        
        print(f"Processing Layer: {layer_name}")
        print(f"Keypoints: {points}")

        if not points:
            continue  # ポイントが空の場合はスキップ

        # 複数のキーポイントを結合して処理
        start_frames_list_combined = []
        end_frames_list_combined = []
        state_list_combined = []
        for SELECTED_KEYPOINT in points:
            # キーポイントの名称を取得
            keypoint_name = keypoint_names[SELECTED_KEYPOINT] if SELECTED_KEYPOINT < len(keypoint_names) else f"Keypoint {SELECTED_KEYPOINT}"
            # キーポイントの3軸のデータを抽出
            keypoint_data = {
                'x': [float(row[3 * SELECTED_KEYPOINT + 1]) for row in data],
                'y': [float(row[3 * SELECTED_KEYPOINT + 2]) for row in data],
                'z': [float(row[3 * SELECTED_KEYPOINT + 3]) for row in data]
            }
            
            # 合成する軸を自動で選択
            COMBINE_AXES = set_combine_axes(keypoint_data, MIN_AXIS_DIFF[SELECTED_KEYPOINT])
            
            print(f"Selected Axes for {keypoint_name}: {COMBINE_AXES}")

            # ホームポジションの値を取得
            home_position = {
                'x': keypoint_data['x'][HOME_POSITION_FRAME],
                'y': keypoint_data['y'][HOME_POSITION_FRAME],
                'z': keypoint_data['z'][HOME_POSITION_FRAME]
            }

            # パラメータの設定
            set_parameter(keypoint_data)

            # 各軸で動作検出を行う
            start_frames_list = []
            end_frames_list = []
            state_list = []
            for axis in COMBINE_AXES:
                data_axis = keypoint_data[axis]
                axis_data = smooth_data(data_axis)
                home_pos = axis_data[HOME_POSITION_FRAME]
                start_threshold_axis = START_THRESHOLD[axis]
                end_threshold_axis = END_THRESHOLD[axis]
                home_threshold = HOME_POSITION_THRESHOLD[axis]
                start_frames, end_frames, state = detect_motion(axis_data, home_pos, start_threshold_axis, end_threshold_axis, home_threshold, MIN_DURATION, MIN_AXIS_DIFF[SELECTED_KEYPOINT])
                start_frames_list.append(start_frames)
                end_frames_list.append(end_frames)
                state_list.append(state)

                # プロットと保存
                # plot_and_save(data_axis, axis_data, state, axis, keypoint_name, layer_name, SELECTED_KEYPOINT)

            # print(f"start_threshold: {START_THRESHOLD}")

            # stateを合成
            combined_state = [0] * num_frames
            for state in state_list:
                for i, s in enumerate(state):
                    if s == 2:
                        combined_state[i] = 2

            # stateを基に動作範囲を再取得
            combined_start_frames = []
            combined_end_frames = []
            motion_start_frame = None
            for frame_id, value in enumerate(combined_state, start=1):
                if value == 2:
                    if motion_start_frame is None:
                        motion_start_frame = frame_id
                    elif frame_id == num_frames:
                        combined_start_frames.append(motion_start_frame)
                        combined_end_frames.append(frame_id)
                else:
                    if motion_start_frame is not None:
                        if frame_id - motion_start_frame >= MIN_DURATION:
                            combined_start_frames.append(motion_start_frame)
                            combined_end_frames.append(frame_id - 1)
                        motion_start_frame = None

            # このキーポイントの動作範囲をリストに追加
            start_frames_list_combined.append(combined_start_frames)
            end_frames_list_combined.append(combined_end_frames)
            state_list_combined.append(combined_state)

        # 複数のキーポイントの動作範囲を結合

        # stateを合成
        combined_state = [0] * num_frames
        for state in state_list_combined:
            for i, s in enumerate(state):
                if s == 2:
                    combined_state[i] = 2

        # stateを基に動作範囲を再取得
        combined_start_frames = []
        combined_end_frames = []
        motion_start_frame = None
        
        for frame_id, value in enumerate(combined_state, start=1):
            if value == 2:
                if motion_start_frame is None:
                    motion_start_frame = frame_id
                elif frame_id == num_frames:
                    combined_start_frames.append(motion_start_frame)
                    combined_end_frames.append(frame_id)
            else:
                if motion_start_frame is not None:
                    if frame_id - motion_start_frame >= MIN_DURATION:
                        combined_start_frames.append(motion_start_frame)
                        combined_end_frames.append(frame_id - 1)
                    motion_start_frame = None

        # 動作あり(2)と動作あり(2)の間にある短い静止状態を動作中とみなす
        max_gap = MAX_GAP
        last_motion_end = -1
        for i in range(len(combined_start_frames)):
            start = combined_start_frames[i]
            end = combined_end_frames[i]
            if start - last_motion_end <= max_gap:
                for j in range(last_motion_end + 1, start):
                    combined_state[j - 1] = 2
            last_motion_end = end

        # stateを基に動作範囲を再取得
        combined_start_frames = []
        combined_end_frames = []
        motion_start_frame = None
        for frame_id, value in enumerate(combined_state, start=1):
            if value == 2:
                if motion_start_frame is None:
                    motion_start_frame = frame_id
                elif frame_id == num_frames:
                    combined_start_frames.append(motion_start_frame)
                    combined_end_frames.append(frame_id)
            else:
                if motion_start_frame is not None:
                    if frame_id - motion_start_frame >= MIN_DURATION:
                        combined_start_frames.append(motion_start_frame)
                        combined_end_frames.append(frame_id - 1)
                    motion_start_frame = None

        print(f"Combined State: {combined_state}")
        print(f"Combined Start Frames: {combined_start_frames}")
        print(f"Combined End Frames: {combined_end_frames}")

        # 動作範囲データを取得
        motion_times = get_motion_times(combined_start_frames, combined_end_frames, FRAME_RATE, layer_name, layer_index)

        # 結果を全体のリストに追加
        all_motion_times.extend(motion_times)

    # JSONファイルに書き出す
    output_file_path = "motion_times.json"
    write_motion_times_to_json(all_motion_times, output_file_path)

    return all_motion_times

# スクリプトが直接実行された場合の処理
if __name__ == '__main__':
    import sys
    print(sys.argv)
    if len(sys.argv) < 3:
        sys.exit(1)

    video_file_path = sys.argv[1]
    auto_annotation_layer_file = sys.argv[2]

    # auto_annotation_layer を読み込む
    with open(auto_annotation_layer_file, 'r', encoding='utf-8') as f:
        auto_annotation_layer = json.load(f)
        
    print(auto_annotation_layer)

    process_video(video_file_path, auto_annotation_layer)
