import numpy as np
import csv
import matplotlib.pyplot as plt
from scipy.ndimage import uniform_filter1d

keypoint_relations = [
    [None, None],   # 0     root
    [0, 2],         # 1     right_hip
    [1, 3],         # 2     right_knee
    [None, None],   # 3     right_foot
    [0, 5],         # 4     left_hip
    [4, 6],         # 5     left_knee
    [None, None],   # 6     left_foot
    [0, 8],         # 7     spine
    [7, 9],         # 8     neck
    [8, 10],        # 9     nose
    [None, None],   # 10    head
    [8, 12],        # 11    left_shoulder
    [11, 13],       # 12    left_elbow
    [None, None],   # 13    left_wrist
    [8, 15],        # 14    right_shoulder
    [14, 16],       # 15    right_elbow
    [None, None]    # 16    right_wrist
]

input_file_path = 'X3D.csv'
output_file_path = 'output_cross_product.csv'

def unit_vector(vector):
    norm = np.linalg.norm(vector)
    if norm == 0:
        return vector
    return vector / norm

def compute_rotation_matrix(neck, hip, left_shoulder, right_shoulder):
    # 体の軸を計算
    y_axis = unit_vector(neck - hip)  # 腰から首へのベクトル
    x_axis_temp = unit_vector(right_shoulder - left_shoulder)  # 左右の肩を結ぶベクトル
    # x軸をy軸に直交させる
    x_axis = unit_vector(x_axis_temp - np.dot(x_axis_temp, y_axis) * y_axis)
    # z軸をx軸とy軸の外積で求める
    z_axis = np.cross(x_axis, y_axis)
    z_axis = unit_vector(z_axis)
    # 回転行列を構築
    R = np.vstack([x_axis, y_axis, z_axis]).T  # 各軸を列として持つ行列
    return R

def apply_rotation(point, R):
    return np.dot(R.T, point)

frames = []

# CSVファイルの読み込みと処理
with open(input_file_path, 'r') as inputfile, open(output_file_path, 'w', newline='') as outputfile:
    csv_reader = csv.reader(inputfile)
    header = next(csv_reader)
    num_keypoints = 17

    fieldnames = ['frame_id'] + [f'cross_product_{i}_{axis}' for i in range(num_keypoints) for axis in ['x', 'y', 'z']]
    writer = csv.DictWriter(outputfile, fieldnames=fieldnames)
    writer.writeheader()

    for row_count, row in enumerate(csv_reader, start=0):
        frame_id = row_count
        cross_products = {}
        keypoints = np.array(row[:num_keypoints * 3], dtype=float).reshape((num_keypoints, 3))
        
        # 全てのキーポイントをrootを基準に補正
        root = keypoints[0]
        keypoints -= root

        left_shoulder = keypoints[11]
        right_shoulder = keypoints[14]
        neck = keypoints[8]
        hip = keypoints[0]

        # 回転行列を計算
        R = compute_rotation_matrix(neck, hip, left_shoulder, right_shoulder)

        # 各キーポイントを補正する
        transformed_keypoints = [apply_rotation(point, R) for point in keypoints]
        transformed_keypoints = np.array(transformed_keypoints)

        # クロスプロダクトの計算
        for i in range(num_keypoints):
            if keypoint_relations[i][0] is None or keypoint_relations[i][1] is None:
                cross_products[f'cross_product_{i}_x'] = np.nan
                cross_products[f'cross_product_{i}_y'] = np.nan
                cross_products[f'cross_product_{i}_z'] = np.nan
            else:
                rp = transformed_keypoints[i]
                p1 = transformed_keypoints[keypoint_relations[i][0]]
                p2 = transformed_keypoints[keypoint_relations[i][1]]
                cross_product = np.cross(p1 - rp, p2 - rp)
                cross_products[f'cross_product_{i}_x'] = cross_product[0]
                cross_products[f'cross_product_{i}_y'] = cross_product[1]
                cross_products[f'cross_product_{i}_z'] = cross_product[2]

        cross_products['frame_id'] = frame_id

        writer.writerow(cross_products)
