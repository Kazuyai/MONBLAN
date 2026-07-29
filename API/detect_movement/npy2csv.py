import numpy as np
import pandas as pd

# .npyファイルのパス
npy_file_path = 'X3D.npy'

# .npyファイルの読み込み
data = np.load(npy_file_path)

# データを2次元に変換 (reshape)
# 形状が (1305, 17, 3) の場合、(1305, 51) に変換
reshaped_data = data.reshape(data.shape[0], -1)

# データをpandas DataFrameに変換
df = pd.DataFrame(reshaped_data)

# CSVファイルのパス
csv_file_path = 'X3D.csv'

# DataFrameをCSVファイルとして保存
df.to_csv(csv_file_path, index=False)

print(f'{csv_file_path}に変換が完了しました。')
