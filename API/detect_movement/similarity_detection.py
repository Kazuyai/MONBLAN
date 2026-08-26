"""v40の3次元DTW類似動作検出器。

実験段階の34〜40の継承関係を、このAPI用モジュールへ集約した。
外部から利用する公開クラスはDTWPureGreedy3DDetectorのみである。
"""

from dataclasses import dataclass
from typing import Dict, List, Tuple

import numpy as np
from scipy.signal import find_peaks, savgol_filter

try:
    from numba import njit

    @njit(cache=True)
    def _dtw_cost_jit(A, B, band):
        m = A.shape[0]
        n = B.shape[0]
        d = A.shape[1]
        inf = 1e18
        D = np.full((m + 1, n + 1), inf)
        D[0, 0] = 0.0
        for i in range(1, m + 1):
            j_center = int(round(i * n / m))
            j_start = max(1, j_center - band)
            j_end = min(n, j_center + band)
            for j in range(j_start, j_end + 1):
                dist = 0.0
                for k in range(d):
                    diff = A[i - 1, k] - B[j - 1, k]
                    dist += diff * diff
                dist = dist ** 0.5
                prev = D[i - 1, j - 1]
                if D[i - 1, j] < prev:
                    prev = D[i - 1, j]
                if D[i, j - 1] < prev:
                    prev = D[i, j - 1]
                D[i, j] = dist + prev
        return D[m, n]

    _HAS_NUMBA = True
except ImportError:
    _HAS_NUMBA = False



def _dtw_cost_numpy(A: np.ndarray, B: np.ndarray, band: int) -> float:
    m, _ = A.shape
    n = B.shape[0]
    inf = 1e18
    D = np.full((m + 1, n + 1), inf, dtype=np.float64)
    D[0, 0] = 0.0
    for i in range(1, m + 1):
        j_center = int(round(i * n / m))
        j_start = max(1, j_center - band)
        j_end = min(n, j_center + band)
        for j in range(j_start, j_end + 1):
            cost = np.linalg.norm(A[i - 1] - B[j - 1])
            D[i, j] = cost + min(D[i - 1, j - 1], D[i - 1, j], D[i, j - 1])
    return float(D[m, n])



def dtw_cost(A: np.ndarray, B: np.ndarray, band: int) -> float:
    if _HAS_NUMBA:
        return float(_dtw_cost_jit(np.ascontiguousarray(A), np.ascontiguousarray(B), band))
    return _dtw_cost_numpy(A, B, band)



@dataclass
class MotionSegment:
    start_time: float
    end_time: float
    start_frame: int
    end_frame: int
    template_id: int
    dtw_similarity: float
    final_score: float
    window_scale: float
    window_length: int
    details: Dict



class SelectedJoint3DDetector:
    JOINT_RELATIONS: Dict[int, Tuple[int, int]] = {
        1: (0, 2),
        2: (1, 3),
        4: (0, 5),
        5: (4, 6),
        7: (0, 8),
        8: (7, 9),
        11: (8, 12),
        12: (11, 13),
        14: (8, 15),
        15: (14, 16),
    }

    JOINT_NAMES: Dict[int, str] = {
        1: "right_hip",
        2: "right_knee",
        4: "left_hip",
        5: "left_knee",
        7: "spine",
        8: "neck",
        11: "left_shoulder",
        12: "left_elbow",
        14: "right_shoulder",
        15: "right_elbow",
    }

    def __init__(self, fps: float = 30.0):
        self.fps = fps
        self.frames: List[Dict] = []
        self.window_scales = [0.6, 0.75, 0.9, 1.0, 1.1, 1.25, 1.4]
        self.coarse_stride = 2
        self.band_ratio = 0.15
        self.min_len_ratio = 0.70
        self.max_len_ratio = 1.40
        self.exclude_margin_ratio = 0.25
        self.peak_distance_ratio = 0.25
        self.peak_prominence = 0.001
        self.final_score_threshold = 0.38
        self.nms_iou_threshold = 0.45
        self.max_results = 80
        self.top_k_fallback = 16
        self.top_k_final_fallback = 12
        self.std_floor = 1e-2
        self.frame_refine_radius = int(round(self.fps * 0.5))

        self.w_dtw = 0.58
        self.w_len = 0.24
        self.w_boundary = 0.18

        self.body_joint_indices = {
            "root": 0,
            "neck": 8,
            "left_shoulder": 11,
            "right_shoulder": 14,
        }

    def _unit(self, v: np.ndarray) -> np.ndarray:
        norm = np.linalg.norm(v)
        if norm < 1e-8:
            return np.zeros_like(v)
        return v / norm

    def _compute_rotation_matrix(self, keypoints: np.ndarray) -> np.ndarray:
        root = keypoints[self.body_joint_indices["root"]]
        neck = keypoints[self.body_joint_indices["neck"]] - root
        left_shoulder = keypoints[self.body_joint_indices["left_shoulder"]] - root
        right_shoulder = keypoints[self.body_joint_indices["right_shoulder"]] - root

        y_axis = self._unit(neck)
        x_temp = self._unit(right_shoulder - left_shoulder)
        x_axis = self._unit(x_temp - np.dot(x_temp, y_axis) * y_axis)
        z_axis = self._unit(np.cross(x_axis, y_axis))
        if np.linalg.norm(x_axis) < 1e-8 or np.linalg.norm(y_axis) < 1e-8 or np.linalg.norm(z_axis) < 1e-8:
            return np.eye(3, dtype=np.float64)
        return np.vstack([x_axis, y_axis, z_axis]).T

    def _normalize_pose(self, keypoints: np.ndarray) -> np.ndarray:
        centered = keypoints - keypoints[self.body_joint_indices["root"]]
        R = self._compute_rotation_matrix(keypoints)
        return centered @ R

    def load_pose_data(self, pose_file: str) -> Dict:
        path = Path(pose_file)
        try:
            if path.suffix.lower() == ".npy":
                data = np.load(path)
            elif path.suffix.lower() == ".csv":
                raw = np.loadtxt(path, delimiter=",", skiprows=1)
                data = raw[:, :51].reshape(-1, 17, 3)
            else:
                return {"error": "3D data must be .npy or .csv"}
        except Exception as e:
            return {"error": f"3D data load error: {e}"}

        if data.ndim != 3 or data.shape[1:] != (17, 3):
            return {"error": f"Unexpected 3D data shape: {data.shape}"}

        frames: List[Dict] = []
        for frame_idx, keypoints in enumerate(data):
            if np.isnan(keypoints).any():
                continue
            pose = self._normalize_pose(keypoints.astype(np.float64))
            frames.append({
                "source_idx": frame_idx,
                "timestamp": frame_idx / self.fps,
                "pose": pose,
            })
        self.frames = frames
        if not frames:
            return {"error": "No valid frames"}
        return {"total_frames": len(frames), "duration": len(frames) / self.fps}

    def _joint_feature_vector(self, pose: np.ndarray, joint_idx: int) -> np.ndarray:
        p1_idx, p2_idx = self.JOINT_RELATIONS[joint_idx]
        rp = pose[joint_idx]
        p1 = pose[p1_idx]
        p2 = pose[p2_idx]

        v1 = p1 - rp
        v2 = p2 - rp
        n1 = np.linalg.norm(v1)
        n2 = np.linalg.norm(v2)
        if n1 < 1e-8 or n2 < 1e-8:
            return np.zeros(5, dtype=np.float64)

        cross_vec = np.cross(v1, v2) / (n1 * n2 + 1e-8)
        cos_val = np.dot(v1, v2) / (n1 * n2 + 1e-8)
        angle_deg = np.degrees(np.arccos(np.clip(cos_val, -1.0, 1.0)))
        cross_mag = np.linalg.norm(cross_vec)
        return np.array(
            [float(angle_deg), float(cross_vec[0]), float(cross_vec[1]), float(cross_vec[2]), float(cross_mag)],
            dtype=np.float64,
        )

    def _extract_features(self, frames: List[Dict], selected_joints: List[int]) -> np.ndarray:
        base = np.array(
            [
                np.concatenate([self._joint_feature_vector(fr["pose"], joint_idx) for joint_idx in selected_joints])
                for fr in frames
            ],
            dtype=np.float64,
        )
        if len(base) < 3:
            return base

        vel = np.zeros_like(base)
        dt = 1.0 / self.fps
        if len(base) >= 7:
            for d in range(base.shape[1]):
                smooth = savgol_filter(base[:, d], 7, 3)
                vel[1:-1, d] = (smooth[2:] - smooth[:-2]) / (2 * dt)
                vel[0, d] = vel[1, d]
                vel[-1, d] = vel[-2, d]
        else:
            for d in range(base.shape[1]):
                vel[:, d] = np.gradient(base[:, d], dt)
        return np.hstack([base, vel])

    def _extract_templates(self, user_segments: List[Tuple[float, float]]) -> List[Dict]:
        templates = []
        for i, (st, en) in enumerate(user_segments):
            idxs = [k for k, fr in enumerate(self.frames) if st <= fr["timestamp"] <= en]
            if len(idxs) < 2:
                idxs = [k for k, _ in enumerate(self.frames) if st <= (k / self.fps) <= en]
            if len(idxs) < 2:
                continue
            templates.append({"id": i, "seq_start": idxs[0], "seq_end": idxs[-1], "data": self.frames[idxs[0]:idxs[-1] + 1]})
        return templates

    def _length_score(self, seg_len: int, tmpl_len: int) -> float:
        return max(0.0, 1.0 - abs(seg_len / max(1, tmpl_len) - 1.0))

    def _boundary_score(self, X: np.ndarray, s: int, e: int) -> float:
        if s <= 0 or e >= len(X) - 1 or e <= s:
            return 0.0
        jump = 0.5 * (np.linalg.norm(X[s] - X[s - 1]) + np.linalg.norm(X[e + 1] - X[e]))
        in_std = float(np.mean(np.std(X[s:e + 1], axis=0)))
        return float(np.clip(0.65 * np.tanh(jump) + 0.35 * (1.0 / (1.0 + in_std)), 0.0, 1.0))

    def _segment_iou(self, a: MotionSegment, b: MotionSegment) -> float:
        s1, e1 = a.start_frame, a.end_frame + 1
        s2, e2 = b.start_frame, b.end_frame + 1
        inter = max(0, min(e1, e2) - max(s1, s2))
        union = (e1 - s1) + (e2 - s2) - inter
        return inter / union if union > 0 else 0.0

    def _nms(self, segs: List[MotionSegment]) -> List[MotionSegment]:
        out = []
        for seg in sorted(segs, key=lambda x: x.final_score, reverse=True):
            if all(self._segment_iou(seg, kept) < self.nms_iou_threshold for kept in out):
                out.append(seg)
            if len(out) >= self.max_results:
                break
        return sorted(out, key=lambda x: x.start_frame)

    def _coarse_candidates(self, T: np.ndarray, X: np.ndarray, m: int, exclude: Tuple[int, int]):
        ex_s, ex_e = exclude
        cands = []
        for si, scale in enumerate(self.window_scales):
            L = int(round(m * scale))
            if L < max(2, int(round(m * self.min_len_ratio))) or L > int(round(m * self.max_len_ratio)) or L >= len(X):
                continue
            band = max(1, int(round(self.band_ratio * max(m, L))))
            pos, sims = [], []
            for j in range(0, len(X) - L + 1, self.coarse_stride):
                if not (j + L - 1 < ex_s or j > ex_e):
                    continue
                sim = 1.0 / (1.0 + dtw_cost(T, X[j:j + L], band) / max(m, L))
                pos.append(j)
                sims.append(sim)
            if not sims:
                continue
            arr = np.array(sims, dtype=np.float64)
            peak_dist = max(1, int(round(m * self.peak_distance_ratio / self.coarse_stride)))
            peaks, _ = find_peaks(arr, distance=peak_dist, prominence=self.peak_prominence)
            if len(peaks) == 0:
                used = []
                for idx in np.argsort(arr)[::-1]:
                    if all(abs(int(idx) - u) >= peak_dist for u in used):
                        used.append(int(idx))
                    if len(used) >= self.top_k_fallback:
                        break
                peaks = np.array(sorted(used), dtype=np.int64)
            for p in peaks:
                cands.append((pos[p], L, float(arr[p]), si))
        return cands

    def _frame_refine(self, T: np.ndarray, X: np.ndarray, m: int, coarse_start: int, coarse_len: int):
        s0 = coarse_start
        e0 = coarse_start + coarse_len - 1
        best = None
        min_len = max(2, int(round(m * self.min_len_ratio)))
        max_len = int(round(m * self.max_len_ratio))
        for ds in range(-self.frame_refine_radius, self.frame_refine_radius + 1):
            s = s0 + ds
            if s < 0 or s >= len(X) - 1:
                continue
            for de in range(-self.frame_refine_radius, self.frame_refine_radius + 1):
                e = e0 + de
                if e <= s or e >= len(X):
                    continue
                seg_len = e - s + 1
                if seg_len < min_len or seg_len > max_len:
                    continue
                band = max(1, int(round(self.band_ratio * max(m, seg_len))))
                dtw_sim = 1.0 / (1.0 + dtw_cost(T, X[s:e + 1], band) / max(m, seg_len))
                len_score = self._length_score(seg_len, m)
                b_score = self._boundary_score(X, s, e)
                final_score = self.w_dtw * dtw_sim + self.w_len * len_score + self.w_boundary * b_score
                if best is None or final_score > best["final_score"]:
                    best = {
                        "s": s,
                        "e": e,
                        "dtw_sim": float(dtw_sim),
                        "final_score": float(final_score),
                        "len_score": float(len_score),
                        "boundary_score": float(b_score),
                    }
        return best

    def detect(self, pose_file: str, selected_joints: List[int], user_segments: List[Tuple[float, float]]) -> Dict:
        if not selected_joints:
            return {"error": "No joints selected"}
        invalid = [joint for joint in selected_joints if joint not in self.JOINT_RELATIONS]
        if invalid:
            return {"error": f"Invalid joints: {invalid}"}

        info = self.load_pose_data(pose_file)
        if "error" in info:
            return info

        templates = self._extract_templates(user_segments)
        if not templates:
            return {"error": "Template segments could not be extracted"}

        X_raw = self._extract_features(self.frames, selected_joints)
        segs = []
        scored_segs = []
        for tmpl in templates:
            T_raw = self._extract_features(tmpl["data"], selected_joints)
            if len(T_raw) < 3:
                continue
            mu = T_raw.mean(axis=0)
            sigma = np.maximum(T_raw.std(axis=0), self.std_floor)
            T = (T_raw - mu) / sigma
            X = (X_raw - mu) / sigma
            m = len(T)
            margin = max(1, int(round(self.exclude_margin_ratio * m)))
            exclude = (max(0, tmpl["seq_start"] - margin), min(len(X) - 1, tmpl["seq_end"] + margin))
            coarse = self._coarse_candidates(T, X, m, exclude)
            for c_start, c_len, c_sim, si in coarse:
                best = self._frame_refine(T, X, m, c_start, c_len)
                if best is None:
                    continue
                s, e = best["s"], best["e"]
                seg = MotionSegment(
                    start_time=self.frames[s]["timestamp"],
                    end_time=self.frames[e]["timestamp"] + 1.0 / self.fps,
                    start_frame=s,
                    end_frame=e,
                    template_id=tmpl["id"],
                    dtw_similarity=best["dtw_sim"],
                    final_score=best["final_score"],
                    window_scale=(e - s + 1) / max(1, m),
                    window_length=(e - s + 1),
                    details={
                        "coarse_similarity": c_sim,
                        "coarse_scale": self.window_scales[si],
                        "length_score": best["len_score"],
                        "boundary_score": best["boundary_score"],
                    },
                )
                scored_segs.append(seg)
                if best["final_score"] >= self.final_score_threshold:
                    segs.append(seg)

        if not segs and scored_segs:
            segs = sorted(scored_segs, key=lambda x: x.final_score, reverse=True)[:self.top_k_final_fallback]

        final = self._nms(segs)
        return {
            "segments": final,
            "stats": {
                "templates": len(templates),
                "initial_candidates": len(scored_segs),
                "threshold_passed_candidates": len(segs),
                "final_results": len(final),
                "avg_final_score": float(np.mean([seg.final_score for seg in final])) if final else 0.0,
            },
            "params": {
                "numba": _HAS_NUMBA,
                "frame_refine_radius": self.frame_refine_radius,
                "selected_joints": selected_joints,
                "selected_joint_names": [self.JOINT_NAMES[j] for j in selected_joints],
                "feature_type": "selected_joint_angle+cross+velocity",
                "final_score_threshold": self.final_score_threshold,
            },
        }



class JointSpecific3DDetector(SelectedJoint3DDetector):
    def __init__(self, fps: float = 30.0):
        super().__init__(fps)
        self.coarse_stride = 2
        self.exclude_margin_ratio = 0.25
        self.peak_distance_ratio = 0.20
        self.peak_prominence = 0.001
        self.final_score_threshold = 0.32
        self.nms_iou_threshold = 0.45
        self.max_results = 100
        self.top_k_fallback = 20
        self.top_k_final_fallback = 16

        # Remove length bonus from the final score. Length is only a search constraint.
        self.w_dtw = 0.72
        self.w_boundary = 0.28

    def _joint_feature_vector(self, pose: np.ndarray, joint_idx: int) -> np.ndarray:
        p1_idx, p2_idx = self.JOINT_RELATIONS[joint_idx]
        rp = pose[joint_idx]
        p1 = pose[p1_idx]
        p2 = pose[p2_idx]

        v1 = p1 - rp
        v2 = p2 - rp
        n1 = np.linalg.norm(v1)
        n2 = np.linalg.norm(v2)
        if n1 < 1e-8 or n2 < 1e-8:
            return np.zeros(6, dtype=np.float64)

        u1 = v1 / n1
        u2 = v2 / n2
        cross_vec = np.cross(u1, u2)
        angle_deg = np.degrees(np.arccos(np.clip(np.dot(u1, u2), -1.0, 1.0)))

        root = pose[self.body_joint_indices["root"]]
        neck = pose[self.body_joint_indices["neck"]]
        trunk = neck - root
        trunk_u = self._unit(trunk)

        if joint_idx == 8:
            # Neck: prioritize head direction relative to trunk.
            head_dir = self._unit(p2 - rp)
            yaw = float(np.dot(head_dir, np.array([1.0, 0.0, 0.0])))
            pitch = float(np.dot(head_dir, np.array([0.0, 1.0, 0.0])))
            roll = float(np.dot(head_dir, np.array([0.0, 0.0, 1.0])))
            bend = float(np.dot(head_dir, trunk_u))
            return np.array([angle_deg, yaw, pitch, roll, bend, np.linalg.norm(cross_vec)], dtype=np.float64)

        if joint_idx in (11, 14):
            # Shoulders: direction of upper limb against trunk is important.
            out_dir = self._unit(p2 - rp)
            lift = float(np.dot(out_dir, trunk_u))
            side = float(out_dir[0])
            front = float(out_dir[2])
            return np.array([angle_deg, cross_vec[0], cross_vec[1], cross_vec[2], lift, side + front], dtype=np.float64)

        if joint_idx in (12, 15):
            # Elbows: bend/forearm rotation dominates.
            fore_dir = self._unit(p2 - rp)
            return np.array([
                angle_deg,
                cross_vec[0],
                cross_vec[1],
                cross_vec[2],
                float(fore_dir[0]),
                float(fore_dir[2]),
            ], dtype=np.float64)

        if joint_idx == 7:
            # Spine: torso orientation / leaning.
            spine_dir = self._unit(p2 - rp)
            return np.array([
                angle_deg,
                cross_vec[0],
                cross_vec[1],
                cross_vec[2],
                float(spine_dir[0]),
                float(spine_dir[2]),
            ], dtype=np.float64)

        if joint_idx in (1, 4):
            # Hips: thigh direction relative to trunk and pelvis twist.
            thigh_dir = self._unit(p2 - rp)
            return np.array([
                angle_deg,
                cross_vec[0],
                cross_vec[1],
                cross_vec[2],
                float(np.dot(thigh_dir, trunk_u)),
                float(thigh_dir[2]),
            ], dtype=np.float64)

        if joint_idx in (2, 5):
            # Knees: flexion and lower leg swing.
            shin_dir = self._unit(p2 - rp)
            return np.array([
                angle_deg,
                cross_vec[0],
                cross_vec[1],
                cross_vec[2],
                float(shin_dir[0]),
                float(shin_dir[2]),
            ], dtype=np.float64)

        return np.array([angle_deg, cross_vec[0], cross_vec[1], cross_vec[2], np.linalg.norm(cross_vec), 0.0], dtype=np.float64)

    def _frame_refine(self, T: np.ndarray, X: np.ndarray, m: int, coarse_start: int, coarse_len: int):
        s0 = coarse_start
        e0 = coarse_start + coarse_len - 1
        best = None
        min_len = max(2, int(round(m * self.min_len_ratio)))
        max_len = int(round(m * self.max_len_ratio))
        for ds in range(-self.frame_refine_radius, self.frame_refine_radius + 1):
            s = s0 + ds
            if s < 0 or s >= len(X) - 1:
                continue
            for de in range(-self.frame_refine_radius, self.frame_refine_radius + 1):
                e = e0 + de
                if e <= s or e >= len(X):
                    continue
                seg_len = e - s + 1
                if seg_len < min_len or seg_len > max_len:
                    continue
                band = max(1, int(round(self.band_ratio * max(m, seg_len))))
                dtw_sim = 1.0 / (1.0 + dtw_cost(T, X[s:e + 1], band) / max(m, seg_len))
                b_score = self._boundary_score(X, s, e)
                final_score = self.w_dtw * dtw_sim + self.w_boundary * b_score
                if best is None or final_score > best["final_score"]:
                    best = {
                        "s": s,
                        "e": e,
                        "dtw_sim": float(dtw_sim),
                        "final_score": float(final_score),
                        "len_score": float(self._length_score(seg_len, m)),
                        "boundary_score": float(b_score),
                    }
        return best

    def detect(self, pose_file: str, selected_joints: List[int], user_segments: List[Tuple[float, float]]) -> Dict:
        result = super().detect(pose_file, selected_joints, user_segments)
        if "params" in result:
            result["params"]["feature_type"] = "joint_specific_angle+cross+velocity"
            result["params"]["final_score_threshold"] = self.final_score_threshold
            result["params"]["length_score_used"] = False
            result["params"]["peak_prominence"] = self.peak_prominence
            result["params"]["peak_distance_ratio"] = self.peak_distance_ratio
        return result



class JointFusion3DDetector(JointSpecific3DDetector):
    def __init__(self, fps: float = 30.0):
        super().__init__(fps)
        self.final_score_threshold = 0.28
        self.nms_iou_threshold = 0.50
        self.max_results = 120
        self.top_k_fallback = 20
        self.top_k_final_fallback = 20

        self.w_dtw = 0.78
        self.w_boundary = 0.22

    def _extract_features_single_joint(self, frames: List[Dict], joint_idx: int) -> np.ndarray:
        base = np.array([self._joint_feature_vector(fr["pose"], joint_idx) for fr in frames], dtype=np.float64)
        if len(base) < 3:
            return base

        vel = np.zeros_like(base)
        dt = 1.0 / self.fps
        if len(base) >= 7:
            for d in range(base.shape[1]):
                smooth = savgol_filter(base[:, d], 7, 3)
                vel[1:-1, d] = (smooth[2:] - smooth[:-2]) / (2 * dt)
                vel[0, d] = vel[1, d]
                vel[-1, d] = vel[-2, d]
        else:
            for d in range(base.shape[1]):
                vel[:, d] = np.gradient(base[:, d], dt)

        return np.hstack([base, vel])

    def _score_segment_single_joint(
        self,
        X_raw: np.ndarray,
        T_raw: np.ndarray,
        seg_start: int,
        seg_end: int,
    ) -> Dict[str, float] | None:
        if seg_end <= seg_start:
            return None
        if len(T_raw) < 3:
            return None

        mu = T_raw.mean(axis=0)
        sigma = np.maximum(T_raw.std(axis=0), self.std_floor)
        T = (T_raw - mu) / sigma
        X = (X_raw - mu) / sigma

        seg_len = seg_end - seg_start + 1
        m = len(T)
        if seg_len < max(2, int(round(m * self.min_len_ratio))) or seg_len > int(round(m * self.max_len_ratio)):
            return None

        band = max(1, int(round(self.band_ratio * max(m, seg_len))))
        dtw_sim = 1.0 / (1.0 + dtw_cost(T, X[seg_start:seg_end + 1], band) / max(m, seg_len))
        b_score = self._boundary_score(X, seg_start, seg_end)
        return {
            "dtw_similarity": float(dtw_sim),
            "boundary_score": float(b_score),
            "final_score": float(self.w_dtw * dtw_sim + self.w_boundary * b_score),
        }

    def _frame_refine_joint(
        self,
        X_raw: np.ndarray,
        T_raw: np.ndarray,
        coarse_start: int,
        coarse_len: int,
    ) -> Dict[str, float] | None:
        s0 = coarse_start
        e0 = coarse_start + coarse_len - 1
        m = len(T_raw)
        best = None
        min_len = max(2, int(round(m * self.min_len_ratio)))
        max_len = int(round(m * self.max_len_ratio))
        for ds in range(-self.frame_refine_radius, self.frame_refine_radius + 1):
            s = s0 + ds
            if s < 0 or s >= len(X_raw) - 1:
                continue
            for de in range(-self.frame_refine_radius, self.frame_refine_radius + 1):
                e = e0 + de
                if e <= s or e >= len(X_raw):
                    continue
                seg_len = e - s + 1
                if seg_len < min_len or seg_len > max_len:
                    continue
                score = self._score_segment_single_joint(X_raw, T_raw, s, e)
                if score is None:
                    continue
                if best is None or score["final_score"] > best["final_score"]:
                    best = {"s": s, "e": e, **score}
        return best

    def detect(self, pose_file: str, selected_joints: List[int], user_segments: List[Tuple[float, float]]) -> Dict:
        if not selected_joints:
            return {"error": "No joints selected"}
        invalid = [joint for joint in selected_joints if joint not in self.JOINT_RELATIONS]
        if invalid:
            return {"error": f"Invalid joints: {invalid}"}

        info = self.load_pose_data(pose_file)
        if "error" in info:
            return info

        templates = self._extract_templates(user_segments)
        if not templates:
            return {"error": "Template segments could not be extracted"}

        joint_features = {joint: self._extract_features_single_joint(self.frames, joint) for joint in selected_joints}

        scored_segs = []
        segs = []

        for tmpl in templates:
            joint_template_features = {
                joint: self._extract_features_single_joint(tmpl["data"], joint)
                for joint in selected_joints
            }
            m = len(next(iter(joint_template_features.values())))
            margin = max(1, int(round(self.exclude_margin_ratio * m)))
            exclude = (max(0, tmpl["seq_start"] - margin), min(len(self.frames) - 1, tmpl["seq_end"] + margin))

            # Union of coarse candidates from all selected joints.
            coarse_candidates = []
            for joint in selected_joints:
                X_joint = joint_features[joint]
                T_joint = joint_template_features[joint]
                if len(T_joint) < 3:
                    continue
                mu = T_joint.mean(axis=0)
                sigma = np.maximum(T_joint.std(axis=0), self.std_floor)
                T_norm = (T_joint - mu) / sigma
                X_norm = (X_joint - mu) / sigma
                coarse = self._coarse_candidates(T_norm, X_norm, len(T_norm), exclude)
                for c_start, c_len, c_sim, si in coarse:
                    coarse_candidates.append((joint, c_start, c_len, c_sim, si))

            for source_joint, c_start, c_len, c_sim, si in coarse_candidates:
                source_best = self._frame_refine_joint(
                    joint_features[source_joint],
                    joint_template_features[source_joint],
                    c_start,
                    c_len,
                )
                if source_best is None:
                    continue

                s = int(source_best["s"])
                e = int(source_best["e"])
                joint_scores = {}
                dtw_scores = []
                boundary_scores = []

                for joint in selected_joints:
                    score = self._score_segment_single_joint(
                        joint_features[joint],
                        joint_template_features[joint],
                        s,
                        e,
                    )
                    if score is None:
                        continue
                    joint_scores[joint] = score
                    dtw_scores.append(score["dtw_similarity"])
                    boundary_scores.append(score["boundary_score"])

                if not joint_scores:
                    continue

                fused_dtw = float(np.mean(dtw_scores))
                fused_boundary = float(np.mean(boundary_scores))
                fused_score = float(self.w_dtw * fused_dtw + self.w_boundary * fused_boundary)

                seg = MotionSegment(
                    start_time=self.frames[s]["timestamp"],
                    end_time=self.frames[e]["timestamp"] + 1.0 / self.fps,
                    start_frame=s,
                    end_frame=e,
                    template_id=tmpl["id"],
                    dtw_similarity=fused_dtw,
                    final_score=fused_score,
                    window_scale=(e - s + 1) / max(1, len(joint_template_features[source_joint])),
                    window_length=(e - s + 1),
                    details={
                        "coarse_similarity": c_sim,
                        "coarse_scale": self.window_scales[si],
                        "source_joint": source_joint,
                        "joint_scores": joint_scores,
                        "boundary_score": fused_boundary,
                    },
                )
                scored_segs.append(seg)
                if fused_score >= self.final_score_threshold:
                    segs.append(seg)

        if not segs and scored_segs:
            segs = sorted(scored_segs, key=lambda x: x.final_score, reverse=True)[:self.top_k_final_fallback]

        final = self._nms(segs)
        return {
            "segments": final,
            "stats": {
                "templates": len(templates),
                "initial_candidates": len(scored_segs),
                "threshold_passed_candidates": len(segs),
                "final_results": len(final),
                "avg_final_score": float(np.mean([seg.final_score for seg in final])) if final else 0.0,
            },
            "params": {
                "numba": _HAS_NUMBA,
                "frame_refine_radius": self.frame_refine_radius,
                "selected_joints": selected_joints,
                "selected_joint_names": [self.JOINT_NAMES[j] for j in selected_joints],
                "feature_type": "joint_specific_per_joint_fusion",
                "final_score_threshold": self.final_score_threshold,
                "length_score_used": False,
            },
        }



class OverlapReject3DDetector(JointFusion3DDetector):
    def __init__(self, fps: float = 30.0):
        super().__init__(fps)
        # Stronger self-exclusion and stricter overlap handling.
        self.template_overlap_margin_ratio = 0.20
        self.nms_iou_threshold = 0.35

    def _overlaps_template(
        self,
        start_frame: int,
        end_frame: int,
        templates: List[Dict],
    ) -> bool:
        for tmpl in templates:
            tmpl_len = tmpl["seq_end"] - tmpl["seq_start"] + 1
            margin = max(1, int(round(tmpl_len * self.template_overlap_margin_ratio)))
            forbidden_start = max(0, tmpl["seq_start"] - margin)
            forbidden_end = tmpl["seq_end"] + margin
            if not (end_frame < forbidden_start or start_frame > forbidden_end):
                return True
        return False

    def _resolve_strict_overlaps(self, segments):
        kept = []
        for seg in sorted(segments, key=lambda x: x.final_score, reverse=True):
            overlaps_existing = False
            for current in kept:
                if not (seg.end_frame < current.start_frame or seg.start_frame > current.end_frame):
                    overlaps_existing = True
                    break
            if not overlaps_existing:
                kept.append(seg)
            if len(kept) >= self.max_results:
                break
        return sorted(kept, key=lambda x: x.start_frame)

    def _boundary_score(self, X: np.ndarray, s: int, e: int) -> float:
        if e <= s:
            return 0.0

        jumps = []
        if s > 0:
            jumps.append(float(np.linalg.norm(X[s] - X[s - 1])))
        if e < len(X) - 1:
            jumps.append(float(np.linalg.norm(X[e + 1] - X[e])))

        jump = float(np.mean(jumps)) if jumps else 0.0
        in_std = float(np.mean(np.std(X[s:e + 1], axis=0)))
        return float(np.clip(0.65 * np.tanh(jump) + 0.35 * (1.0 / (1.0 + in_std)), 0.0, 1.0))

    def _coarse_candidates(self, T: np.ndarray, X: np.ndarray, m: int, exclude: Tuple[int, int]):
        ex_s, ex_e = exclude
        cands = []
        min_len = max(2, int(round(m * self.min_len_ratio)))
        max_len = int(round(m * self.max_len_ratio))

        for si, scale in enumerate(self.window_scales):
            L = int(round(m * scale))
            if L < min_len or L > max_len or L >= len(X):
                continue

            band = max(1, int(round(self.band_ratio * max(m, L))))
            positions = list(range(0, len(X) - L + 1, self.coarse_stride))
            last_start = len(X) - L
            if not positions or positions[-1] != last_start:
                positions.append(last_start)

            pos = []
            sims = []
            for j in positions:
                if not (j + L - 1 < ex_s or j > ex_e):
                    continue
                sim = 1.0 / (1.0 + dtw_cost(T, X[j:j + L], band) / max(m, L))
                pos.append(j)
                sims.append(sim)

            if not sims:
                continue

            arr = np.array(sims, dtype=np.float64)
            peak_dist = max(1, int(round(m * self.peak_distance_ratio / self.coarse_stride)))
            peaks, _ = find_peaks(arr, distance=peak_dist, prominence=self.peak_prominence)

            used = set(int(p) for p in peaks.tolist())

            def try_add_endpoint(idx: int):
                if idx in used:
                    return
                if any(abs(idx - u) < peak_dist for u in used):
                    return
                if len(arr) == 1:
                    used.add(idx)
                    return
                neighbor = arr[1] if idx == 0 else arr[-2]
                strong_enough = arr[idx] >= neighbor and arr[idx] >= np.percentile(arr, 75)
                if strong_enough:
                    used.add(idx)

            try_add_endpoint(0)
            try_add_endpoint(len(arr) - 1)

            if not used:
                fallback = []
                for idx in np.argsort(arr)[::-1]:
                    idx = int(idx)
                    if all(abs(idx - u) >= peak_dist for u in fallback):
                        fallback.append(idx)
                    if len(fallback) >= self.top_k_fallback:
                        break
                used = set(fallback)

            for p in sorted(used):
                cands.append((pos[p], L, float(arr[p]), si))

        return cands

    def detect(self, pose_file: str, selected_joints: List[int], user_segments: List[Tuple[float, float]]) -> Dict:
        if not selected_joints:
            return {"error": "No joints selected"}
        invalid = [joint for joint in selected_joints if joint not in self.JOINT_RELATIONS]
        if invalid:
            return {"error": f"Invalid joints: {invalid}"}

        info = self.load_pose_data(pose_file)
        if "error" in info:
            return info

        templates = self._extract_templates(user_segments)
        if not templates:
            return {"error": "Template segments could not be extracted"}

        joint_features = {joint: self._extract_features_single_joint(self.frames, joint) for joint in selected_joints}

        scored_segs = []
        segs = []

        for tmpl in templates:
            joint_template_features = {
                joint: self._extract_features_single_joint(tmpl["data"], joint)
                for joint in selected_joints
            }
            m = len(next(iter(joint_template_features.values())))
            margin = max(1, int(round(self.exclude_margin_ratio * m)))
            exclude = (max(0, tmpl["seq_start"] - margin), min(len(self.frames) - 1, tmpl["seq_end"] + margin))

            coarse_candidates = []
            for joint in selected_joints:
                X_joint = joint_features[joint]
                T_joint = joint_template_features[joint]
                if len(T_joint) < 3:
                    continue
                mu = T_joint.mean(axis=0)
                sigma = self._MOD__np_maximum(T_joint)
                T_norm = (T_joint - mu) / sigma
                X_norm = (X_joint - mu) / sigma
                coarse = self._coarse_candidates(T_norm, X_norm, len(T_norm), exclude)
                for c_start, c_len, c_sim, si in coarse:
                    coarse_candidates.append((joint, c_start, c_len, c_sim, si))

            for source_joint, c_start, c_len, c_sim, si in coarse_candidates:
                source_best = self._frame_refine_joint(
                    joint_features[source_joint],
                    joint_template_features[source_joint],
                    c_start,
                    c_len,
                )
                if source_best is None:
                    continue

                s = int(source_best["s"])
                e = int(source_best["e"])
                if self._overlaps_template(s, e, templates):
                    continue

                joint_scores = {}
                dtw_scores = []
                boundary_scores = []

                for joint in selected_joints:
                    score = self._score_segment_single_joint(
                        joint_features[joint],
                        joint_template_features[joint],
                        s,
                        e,
                    )
                    if score is None:
                        continue
                    joint_scores[joint] = score
                    dtw_scores.append(score["dtw_similarity"])
                    boundary_scores.append(score["boundary_score"])

                if not joint_scores:
                    continue

                fused_dtw = float(sum(dtw_scores) / len(dtw_scores))
                fused_boundary = float(sum(boundary_scores) / len(boundary_scores))
                fused_score = float(self.w_dtw * fused_dtw + self.w_boundary * fused_boundary)

                seg = MotionSegment(
                    start_time=self.frames[s]["timestamp"],
                    end_time=self.frames[e]["timestamp"] + 1.0 / self.fps,
                    start_frame=s,
                    end_frame=e,
                    template_id=tmpl["id"],
                    dtw_similarity=fused_dtw,
                    final_score=fused_score,
                    window_scale=(e - s + 1) / max(1, len(joint_template_features[source_joint])),
                    window_length=(e - s + 1),
                    details={
                        "coarse_similarity": c_sim,
                        "coarse_scale": self.window_scales[si],
                        "source_joint": source_joint,
                        "joint_scores": joint_scores,
                        "boundary_score": fused_boundary,
                    },
                )
                scored_segs.append(seg)
                if fused_score >= self.final_score_threshold:
                    segs.append(seg)

        if not segs and scored_segs:
            segs = sorted(scored_segs, key=lambda x: x.final_score, reverse=True)[:self.top_k_final_fallback]

        nms_segments = self._nms(segs)
        final = self._resolve_strict_overlaps(nms_segments)
        return {
            "segments": final,
            "stats": {
                "templates": len(templates),
                "initial_candidates": len(scored_segs),
                "threshold_passed_candidates": len(segs),
                "post_nms_candidates": len(nms_segments),
                "final_results": len(final),
                "avg_final_score": float(sum(seg.final_score for seg in final) / len(final)) if final else 0.0,
            },
            "params": {
                "numba": _HAS_NUMBA,
                "frame_refine_radius": self.frame_refine_radius,
                "selected_joints": selected_joints,
                "selected_joint_names": [self.JOINT_NAMES[j] for j in selected_joints],
                "feature_type": "joint_specific_per_joint_fusion_overlap_reject",
                "final_score_threshold": self.final_score_threshold,
                "length_score_used": False,
                "template_overlap_margin_ratio": self.template_overlap_margin_ratio,
            },
        }

    def _MOD__np_maximum(self, template_features):
        import numpy as np
        return np.maximum(template_features.std(axis=0), self.std_floor)



# APIでは利用者のテンプレートだけをデバッグ参照として扱う。
DEBUG_REFERENCE_SEGMENTS = []



class MultiTemplateUnion3DDetector(OverlapReject3DDetector):
    def __init__(self, fps: float = 30.0):
        super().__init__(fps)
        self.feature_type_name = "joint_specific_per_joint_fusion_multi_template_cluster_union"

        # Keep template-specific candidates first, then merge only truly adjacent
        # candidates. A wide gap was merging distinct repetitions near the end.
        self.cluster_gap_frames = 1
        self.support_score_floor = 0.24
        self.support_margin = 0.03

        # Cluster representative score: best template first, second template next,
        # then a small agreement bonus.
        self.w_best_template = 0.72
        self.w_second_template = 0.20
        self.w_support_bonus = 0.08

        # Suppress too-short partial matches without rewarding long segments.
        self.short_segment_ratio_floor = 0.85
        self.short_segment_penalty_power = 1.0

        # Keep all non-duplicate candidates before clustering. Accuracy matters
        # more than runtime for this experiment.
        self.dedup_gap_frames = max(1, int(round(self.fps * 0.10)))
        self.debug_reference_segments = DEBUG_REFERENCE_SEGMENTS
        self.debug_nearby_limit = 5

        # Final selection should be relative to the best cluster representative,
        # otherwise repeated motions with slightly lower scores are dropped.
        self.final_relative_margin = 0.06
        self.final_min_support_count = 1
        self.final_dtw_floor = 0.10

    def _build_template_feature_bank(self, templates: List[Dict], selected_joints: List[int]) -> List[Dict]:
        bank = []
        for tmpl in templates:
            joint_template_features = {
                joint: self._extract_features_single_joint(tmpl["data"], joint)
                for joint in selected_joints
            }
            valid_lengths = [len(feats) for feats in joint_template_features.values() if len(feats) >= 3]
            if not valid_lengths:
                continue
            bank.append(
                {
                    "id": tmpl["id"],
                    "seq_start": tmpl["seq_start"],
                    "seq_end": tmpl["seq_end"],
                    "joint_features": joint_template_features,
                    "length": valid_lengths[0],
                }
            )
        return bank

    def _score_segment_against_template(
        self,
        joint_features: Dict[int, object],
        template_bank_item: Dict,
        selected_joints: List[int],
        start_frame: int,
        end_frame: int,
    ):
        joint_scores = {}
        dtw_scores = []
        boundary_scores = []

        for joint in selected_joints:
            score = self._score_segment_single_joint(
                joint_features[joint],
                template_bank_item["joint_features"][joint],
                start_frame,
                end_frame,
            )
            if score is None:
                continue
            joint_scores[joint] = score
            dtw_scores.append(score["dtw_similarity"])
            boundary_scores.append(score["boundary_score"])

        if not joint_scores:
            return None

        fused_dtw = float(sum(dtw_scores) / len(dtw_scores))
        fused_boundary = float(sum(boundary_scores) / len(boundary_scores))
        fused_score = float(self.w_dtw * fused_dtw + self.w_boundary * fused_boundary)
        return {
            "template_id": template_bank_item["id"],
            "dtw_similarity": fused_dtw,
            "boundary_score": fused_boundary,
            "final_score": fused_score,
            "joint_scores": joint_scores,
            "template_length": template_bank_item["length"],
        }

    def _aggregate_template_scores(self, template_scores: List[Dict], seg_len: int) -> Dict:
        ranked = sorted(template_scores, key=lambda x: x["final_score"], reverse=True)
        best = ranked[0]
        second = ranked[1] if len(ranked) >= 2 else ranked[0]

        support_threshold = max(self.support_score_floor, best["final_score"] - self.support_margin)
        support_items = [item for item in ranked if item["final_score"] >= support_threshold]
        support_ratio = float(len(support_items) / len(ranked))

        base_score = (
            self.w_best_template * best["final_score"]
            + self.w_second_template * second["final_score"]
            + self.w_support_bonus * (best["final_score"] * support_ratio)
        )

        representative_template_len = int(round((best["template_length"] + second["template_length"]) / 2.0))
        representative_template_len = max(1, representative_template_len)
        seg_ratio = seg_len / representative_template_len
        if seg_ratio < self.short_segment_ratio_floor:
            short_penalty = (seg_ratio / self.short_segment_ratio_floor) ** self.short_segment_penalty_power
        else:
            short_penalty = 1.0

        aggregated_score = float(base_score * short_penalty)
        aggregated_dtw = float(0.7 * best["dtw_similarity"] + 0.3 * second["dtw_similarity"])
        aggregated_boundary = float(0.7 * best["boundary_score"] + 0.3 * second["boundary_score"])

        return {
            "best_template_id": best["template_id"],
            "second_template_id": second["template_id"],
            "dtw_similarity": aggregated_dtw,
            "boundary_score": aggregated_boundary,
            "final_score": aggregated_score,
            "base_score": float(base_score),
            "support_ratio": support_ratio,
            "support_count": len(support_items),
            "template_length": representative_template_len,
            "top_template_ids": [best["template_id"], second["template_id"]],
            "short_penalty": float(short_penalty),
            "joint_scores": best["joint_scores"],
            "template_scores": [
                {
                    "template_id": item["template_id"],
                    "dtw_similarity": item["dtw_similarity"],
                    "final_score": item["final_score"],
                }
                for item in ranked
            ],
        }

    def _build_raw_candidate(
        self,
        start_frame: int,
        end_frame: int,
        source_template_id: int,
        source_joint: int,
        coarse_similarity: float,
        coarse_scale: float,
        template_scores: List[Dict],
    ) -> Dict:
        seg_len = end_frame - start_frame + 1
        aggregated = self._aggregate_template_scores(template_scores, seg_len)
        return {
            "start_frame": start_frame,
            "end_frame": end_frame,
            "start_time": self.frames[start_frame]["timestamp"],
            "end_time": self.frames[end_frame]["timestamp"] + 1.0 / self.fps,
            "window_length": seg_len,
            "window_scale": seg_len / aggregated["template_length"],
            "dtw_similarity": aggregated["dtw_similarity"],
            "final_score": aggregated["final_score"],
            "template_id": aggregated["best_template_id"],
            "details": {
                "coarse_similarity": coarse_similarity,
                "coarse_scale": coarse_scale,
                "source_joint": source_joint,
                "source_template_id": source_template_id,
                "matched_template_id": aggregated["best_template_id"],
                "second_template_id": aggregated["second_template_id"],
                "top_template_ids": aggregated["top_template_ids"],
                "joint_scores": aggregated["joint_scores"],
                "boundary_score": aggregated["boundary_score"],
                "base_score": aggregated["base_score"],
                "support_ratio": aggregated["support_ratio"],
                "support_count": aggregated["support_count"],
                "short_penalty": aggregated["short_penalty"],
                "template_scores": aggregated["template_scores"],
            },
        }

    def _cluster_candidates(self, candidates: List[Dict]) -> List[List[Dict]]:
        if not candidates:
            return []

        ordered = sorted(candidates, key=lambda x: (x["start_frame"], x["end_frame"]))
        clusters: List[List[Dict]] = []
        current = [ordered[0]]
        current_end = ordered[0]["end_frame"]

        for cand in ordered[1:]:
            if cand["start_frame"] <= current_end + self.cluster_gap_frames:
                current.append(cand)
                current_end = max(current_end, cand["end_frame"])
            else:
                clusters.append(current)
                current = [cand]
                current_end = cand["end_frame"]

        clusters.append(current)
        return clusters

    def _select_cluster_representative(self, cluster: List[Dict]) -> Dict:
        # Prefer candidates supported by more templates first, then score, then length.
        return max(
            cluster,
            key=lambda x: (
                x["details"].get("support_count", 0),
                x["final_score"],
                x["window_length"],
            ),
        )

    def _candidate_debug_rows(self, candidates: List[Dict], ref_start: float, ref_end: float, limit: int | None = None) -> List[Dict]:
        if limit is None:
            limit = self.debug_nearby_limit
        rows = []
        for cand in candidates:
            center = 0.5 * (cand["start_time"] + cand["end_time"])
            ref_center = 0.5 * (ref_start + ref_end)
            dist = abs(center - ref_center)
            rows.append((dist, cand))
        rows.sort(key=lambda x: (x[0], -x[1]["final_score"]))
        return [cand for _, cand in rows[:limit]]

    def _segment_to_debug_dict(self, cand: Dict) -> Dict:
        return {
            "start": float(cand["start_time"]),
            "end": float(cand["end_time"]),
            "len": float(cand["end_time"] - cand["start_time"]),
            "score": float(cand["final_score"]),
            "base": float(cand["details"].get("base_score", 0.0)),
            "dtw": float(cand["dtw_similarity"]),
            "support": int(cand["details"].get("support_count", 0)),
            "penalty": float(cand["details"].get("short_penalty", 0.0)),
            "src_tmpl": cand["details"].get("source_template_id"),
            "match_tmpl": cand["details"].get("matched_template_id"),
        }

    def _build_debug_info(
        self,
        raw_candidates: List[Dict],
        clustering_candidates: List[Dict],
        cluster_representatives: List[Dict],
        filtered_representatives: List[Dict],
        user_segments: List[Tuple[float, float]],
    ) -> Dict:
        references = []
        seen = set()
        for st, en in list(user_segments) + list(self.debug_reference_segments):
            key = (round(st, 3), round(en, 3))
            if key in seen:
                continue
            seen.add(key)
            references.append({
                "reference": [st, en],
                "raw": [self._segment_to_debug_dict(c) for c in self._candidate_debug_rows(raw_candidates, st, en)],
                "cluster_input": [self._segment_to_debug_dict(c) for c in self._candidate_debug_rows(clustering_candidates, st, en)],
                "cluster_repr": [self._segment_to_debug_dict(c) for c in self._candidate_debug_rows(cluster_representatives, st, en, limit=3)],
                "final": [self._segment_to_debug_dict(c) for c in self._candidate_debug_rows(filtered_representatives, st, en, limit=3)],
            })

        top_raw = sorted(raw_candidates, key=lambda x: x["final_score"], reverse=True)[:10]
        top_cluster_input = sorted(clustering_candidates, key=lambda x: x["final_score"], reverse=True)[:10]
        top_cluster_repr = sorted(cluster_representatives, key=lambda x: x["final_score"], reverse=True)[:10]
        top_final = sorted(filtered_representatives, key=lambda x: x["final_score"], reverse=True)[:10]

        return {
            "references": references,
            "top_raw": [self._segment_to_debug_dict(c) for c in top_raw],
            "top_cluster_input": [self._segment_to_debug_dict(c) for c in top_cluster_input],
            "top_cluster_repr": [self._segment_to_debug_dict(c) for c in top_cluster_repr],
            "top_final": [self._segment_to_debug_dict(c) for c in top_final],
        }

    def _select_candidates_for_clustering(self, raw_candidates: List[Dict]) -> List[Dict]:
        if not raw_candidates:
            return []

        # Keep all candidates, but collapse near-duplicate ones generated from the
        # same local optimum. Do not trim by rank here.
        ordered = sorted(raw_candidates, key=lambda x: (x["start_frame"], x["end_frame"], -x["final_score"]))
        selected: List[Dict] = []

        for cand in ordered:
            is_duplicate = False
            for kept in selected:
                same_template = cand["details"].get("source_template_id") == kept["details"].get("source_template_id")
                same_joint = cand["details"].get("source_joint") == kept["details"].get("source_joint")
                if not (same_template and same_joint):
                    continue
                start_gap = abs(cand["start_frame"] - kept["start_frame"])
                end_gap = abs(cand["end_frame"] - kept["end_frame"])
                if start_gap <= self.dedup_gap_frames and end_gap <= self.dedup_gap_frames:
                    is_duplicate = True
                    break
            if not is_duplicate:
                selected.append(cand)

        return selected

    def _select_final_representatives(self, cluster_representatives: List[Dict]) -> List[Dict]:
        if not cluster_representatives:
            return []

        ranked = sorted(cluster_representatives, key=lambda x: (x["final_score"], x["dtw_similarity"], x["window_length"]), reverse=True)
        best = ranked[0]
        score_floor = max(self.final_score_threshold - 0.02, best["final_score"] - self.final_relative_margin)

        kept = []
        for item in ranked:
            if item["final_score"] < score_floor:
                continue
            if item["details"].get("support_count", 0) < self.final_min_support_count:
                continue
            if item["dtw_similarity"] < self.final_dtw_floor:
                continue
            kept.append(item)

        if not kept:
            kept = ranked[:self.top_k_final_fallback]
        return kept

    def detect(self, pose_file: str, selected_joints: List[int], user_segments: List[Tuple[float, float]]) -> Dict:
        if not selected_joints:
            return {"error": "No joints selected"}
        invalid = [joint for joint in selected_joints if joint not in self.JOINT_RELATIONS]
        if invalid:
            return {"error": f"Invalid joints: {invalid}"}

        info = self.load_pose_data(pose_file)
        if "error" in info:
            return info

        templates = self._extract_templates(user_segments)
        if not templates:
            return {"error": "Template segments could not be extracted"}

        template_bank = self._build_template_feature_bank(templates, selected_joints)
        if not template_bank:
            return {"error": "No valid template features"}

        joint_features = {joint: self._extract_features_single_joint(self.frames, joint) for joint in selected_joints}

        raw_candidates: List[Dict] = []

        for tmpl in template_bank:
            m = tmpl["length"]
            margin = max(1, int(round(self.exclude_margin_ratio * m)))
            exclude = (max(0, tmpl["seq_start"] - margin), min(len(self.frames) - 1, tmpl["seq_end"] + margin))

            coarse_candidates = []
            for joint in selected_joints:
                X_joint = joint_features[joint]
                T_joint = tmpl["joint_features"][joint]
                if len(T_joint) < 3:
                    continue
                mu = T_joint.mean(axis=0)
                sigma = self._MOD__np_maximum(T_joint)
                T_norm = (T_joint - mu) / sigma
                X_norm = (X_joint - mu) / sigma
                coarse = self._coarse_candidates(T_norm, X_norm, len(T_norm), exclude)
                for c_start, c_len, c_sim, si in coarse:
                    coarse_candidates.append((tmpl["id"], joint, c_start, c_len, c_sim, si))

            for source_template_id, source_joint, c_start, c_len, c_sim, si in coarse_candidates:
                source_best = self._frame_refine_joint(
                    joint_features[source_joint],
                    tmpl["joint_features"][source_joint],
                    c_start,
                    c_len,
                )
                if source_best is None:
                    continue

                s = int(source_best["s"])
                e = int(source_best["e"])
                if self._overlaps_template(s, e, templates):
                    continue

                template_scores = []
                for candidate_template in template_bank:
                    scored = self._score_segment_against_template(
                        joint_features,
                        candidate_template,
                        selected_joints,
                        s,
                        e,
                    )
                    if scored is not None:
                        template_scores.append(scored)

                if not template_scores:
                    continue

                raw = self._build_raw_candidate(
                    start_frame=s,
                    end_frame=e,
                    source_template_id=source_template_id,
                    source_joint=source_joint,
                    coarse_similarity=c_sim,
                    coarse_scale=self.window_scales[si],
                    template_scores=template_scores,
                )
                raw_candidates.append(raw)

        clustering_candidates = self._select_candidates_for_clustering(raw_candidates)
        if not clustering_candidates and raw_candidates:
            clustering_candidates = sorted(raw_candidates, key=lambda x: x["final_score"], reverse=True)[:self.top_k_final_fallback]

        clusters = self._cluster_candidates(clustering_candidates)
        cluster_representatives = [self._select_cluster_representative(cluster) for cluster in clusters]

        filtered_representatives = self._select_final_representatives(cluster_representatives)

        motion_segments = []
        for item in filtered_representatives:
            motion_segments.append(
                MotionSegment(
                    start_time=item["start_time"],
                    end_time=item["end_time"],
                    start_frame=item["start_frame"],
                    end_frame=item["end_frame"],
                    template_id=item["template_id"],
                    dtw_similarity=item["dtw_similarity"],
                    final_score=item["final_score"],
                    window_scale=item["window_scale"],
                    window_length=item["window_length"],
                    details=item["details"],
                )
            )

        final = self._resolve_strict_overlaps(sorted(motion_segments, key=lambda x: x.final_score, reverse=True))
        debug_info = self._build_debug_info(
            raw_candidates=raw_candidates,
            clustering_candidates=clustering_candidates,
            cluster_representatives=cluster_representatives,
            filtered_representatives=filtered_representatives,
            user_segments=user_segments,
        )
        return {
            "segments": final,
            "debug": debug_info,
            "stats": {
                "templates": len(template_bank),
                "initial_candidates": len(raw_candidates),
                "threshold_passed_candidates": len(clustering_candidates),
                "post_nms_candidates": len(filtered_representatives),
                "final_results": len(final),
                "avg_final_score": float(sum(seg.final_score for seg in final) / len(final)) if final else 0.0,
            },
            "params": {
                "numba": _HAS_NUMBA,
                "frame_refine_radius": self.frame_refine_radius,
                "selected_joints": selected_joints,
                "selected_joint_names": [self.JOINT_NAMES[j] for j in selected_joints],
                "feature_type": self.feature_type_name,
                "final_score_threshold": self.final_score_threshold,
                "length_score_used": False,
                "template_overlap_margin_ratio": self.template_overlap_margin_ratio,
                "template_union_mode": "template_wise_candidates_then_cluster_union",
                "cluster_gap_frames": self.cluster_gap_frames,
                "w_best_template": self.w_best_template,
                "w_second_template": self.w_second_template,
                "w_support_bonus": self.w_support_bonus,
                "short_segment_ratio_floor": self.short_segment_ratio_floor,
                "dedup_gap_frames": self.dedup_gap_frames,
                "final_relative_margin": self.final_relative_margin,
                "final_min_support_count": self.final_min_support_count,
                "final_dtw_floor": self.final_dtw_floor,
            },
        }



class DTWPureGreedy3DDetector(MultiTemplateUnion3DDetector):
    def __init__(self, fps: float = 30.0):
        super().__init__(fps)
        self.feature_type_name = "joint_specific_per_joint_dtw_pure_refined"
        self.greedy_refine_radius = max(2, int(round(self.fps * 0.20)))

        # DTW only, but keep practical selection guards.
        self.greedy_stop_threshold = 0.12
        self.candidate_relative_margin = 0.08
        self.final_relative_margin = 0.08

        # Detect same-event duplicates more robustly than IoU only.
        self.candidate_overlap_iou = 0.18
        self.candidate_overlap_cover = 0.35
        self.final_union_iou = 0.18
        self.final_union_cover = 0.30
        self.near_duplicate_gap_frames = max(1, int(round(self.fps * 0.12)))

    def _score_segment_against_single_template(
        self,
        joint_features: Dict[int, object],
        tmpl: Dict,
        selected_joints: List[int],
        start_frame: int,
        end_frame: int,
    ) -> Dict | None:
        joint_scores = {}
        dtw_scores = []

        for joint in selected_joints:
            score = self._score_segment_single_joint(
                joint_features[joint],
                tmpl["joint_features"][joint],
                start_frame,
                end_frame,
            )
            if score is None:
                continue
            joint_scores[joint] = score
            dtw_scores.append(score["dtw_similarity"])

        if not joint_scores:
            return None

        fused_dtw = float(sum(dtw_scores) / len(dtw_scores))
        return {
            "template_id": tmpl["id"],
            "dtw_similarity": fused_dtw,
            "final_score": fused_dtw,
            "joint_scores": joint_scores,
            "template_length": int(tmpl["length"]),
        }

    def _build_single_template_candidate(
        self,
        joint_features: Dict[int, object],
        tmpl: Dict,
        selected_joints: List[int],
        start_frame: int,
        end_frame: int,
        source_joint: int,
        coarse_similarity: float,
        coarse_scale: float,
    ) -> Dict | None:
        scored = self._score_segment_against_single_template(
            joint_features,
            tmpl,
            selected_joints,
            start_frame,
            end_frame,
        )
        if scored is None:
            return None

        seg_len = end_frame - start_frame + 1
        return {
            "start_frame": start_frame,
            "end_frame": end_frame,
            "start_time": self.frames[start_frame]["timestamp"],
            "end_time": self.frames[end_frame]["timestamp"] + 1.0 / self.fps,
            "window_length": seg_len,
            "window_scale": seg_len / max(1, scored["template_length"]),
            "dtw_similarity": scored["dtw_similarity"],
            "final_score": scored["final_score"],
            "template_id": tmpl["id"],
            "details": {
                "coarse_similarity": coarse_similarity,
                "coarse_scale": coarse_scale,
                "source_joint": source_joint,
                "source_template_id": tmpl["id"],
                "matched_template_id": tmpl["id"],
                "joint_scores": scored["joint_scores"],
                "base_score": scored["final_score"],
                "support_count": 1,
                "short_penalty": 1.0,
            },
        }

    def _candidate_overlap_stats(self, a: Dict, b: Dict) -> Dict[str, float]:
        s1, e1 = int(a["start_frame"]), int(a["end_frame"]) + 1
        s2, e2 = int(b["start_frame"]), int(b["end_frame"]) + 1
        inter = max(0, min(e1, e2) - max(s1, s2))
        len1 = max(1, e1 - s1)
        len2 = max(1, e2 - s2)
        union = len1 + len2 - inter
        return {
            "intersection": float(inter),
            "iou": float(inter / union) if union > 0 else 0.0,
            "cover_short": float(inter / min(len1, len2)),
            "start_gap": float(abs(s1 - s2)),
            "end_gap": float(abs((e1 - 1) - (e2 - 1))),
        }

    def _is_same_event(
        self,
        a: Dict,
        b: Dict,
        iou_threshold: float,
        cover_threshold: float,
    ) -> bool:
        stats = self._candidate_overlap_stats(a, b)
        if stats["intersection"] > 0 and (
            stats["iou"] >= iou_threshold or stats["cover_short"] >= cover_threshold
        ):
            return True
        if (
            stats["start_gap"] <= self.near_duplicate_gap_frames
            and stats["end_gap"] <= self.near_duplicate_gap_frames
        ):
            return True
        return False

    def _collapse_local_duplicates(self, candidates: List[Dict]) -> List[Dict]:
        ranked = sorted(
            candidates,
            key=lambda x: (x["final_score"], x["dtw_similarity"], x["window_length"]),
            reverse=True,
        )
        kept: List[Dict] = []
        for cand in ranked:
            if any(
                self._is_same_event(cand, current, self.candidate_overlap_iou, self.candidate_overlap_cover)
                for current in kept
            ):
                continue
            kept.append(cand)
        return sorted(kept, key=lambda x: x["start_frame"])

    def _score_floor_from_best(self, best_score: float, relative_margin: float) -> float:
        return max(self.greedy_stop_threshold, best_score - relative_margin)

    def _generate_raw_candidates_for_template(
        self,
        joint_features: Dict[int, object],
        tmpl: Dict,
        selected_joints: List[int],
        exclude_templates: List[Dict],
    ) -> List[Dict]:
        m = tmpl["length"]
        margin = max(1, int(round(self.exclude_margin_ratio * m)))
        exclude = (max(0, tmpl["seq_start"] - margin), min(len(self.frames) - 1, tmpl["seq_end"] + margin))

        raw_candidates: List[Dict] = []
        for joint in selected_joints:
            x_joint = joint_features[joint]
            t_joint = tmpl["joint_features"][joint]
            if len(t_joint) < 3:
                continue

            mu = t_joint.mean(axis=0)
            sigma = self._MOD__np_maximum(t_joint)
            t_norm = (t_joint - mu) / sigma
            x_norm = (x_joint - mu) / sigma
            coarse = self._coarse_candidates(t_norm, x_norm, len(t_norm), exclude)

            for c_start, c_len, c_sim, si in coarse:
                source_best = self._frame_refine_joint(x_joint, t_joint, c_start, c_len)
                if source_best is None:
                    continue
                s = int(source_best["s"])
                e = int(source_best["e"])
                if self._overlaps_template(s, e, exclude_templates):
                    continue
                built = self._build_single_template_candidate(
                    joint_features,
                    tmpl,
                    selected_joints,
                    s,
                    e,
                    source_joint=joint,
                    coarse_similarity=c_sim,
                    coarse_scale=self.window_scales[si],
                )
                if built is not None:
                    raw_candidates.append(built)

        deduped = self._select_candidates_for_clustering(raw_candidates)
        return self._collapse_local_duplicates(deduped)

    def _refine_selected_candidate_for_template(
        self,
        candidate: Dict,
        joint_features: Dict[int, object],
        tmpl: Dict,
        selected_joints: List[int],
        exclude_templates: List[Dict],
    ) -> Dict:
        s0 = int(candidate["start_frame"])
        e0 = int(candidate["end_frame"])
        best = candidate

        for ds in range(-self.greedy_refine_radius, self.greedy_refine_radius + 1):
            s = s0 + ds
            if s < 0 or s >= len(self.frames) - 1:
                continue
            for de in range(-self.greedy_refine_radius, self.greedy_refine_radius + 1):
                e = e0 + de
                if e <= s or e >= len(self.frames):
                    continue
                if self._overlaps_template(s, e, exclude_templates):
                    continue
                refined = self._build_single_template_candidate(
                    joint_features,
                    tmpl,
                    selected_joints,
                    s,
                    e,
                    source_joint=int(candidate["details"].get("source_joint", -1)),
                    coarse_similarity=float(candidate["details"].get("coarse_similarity", 0.0)),
                    coarse_scale=float(candidate["details"].get("coarse_scale", 0.0)),
                )
                if refined is not None and refined["final_score"] > best["final_score"]:
                    best = refined
        return best

    def _remove_overlapping_candidates(self, candidates: List[Dict], selected_candidate: Dict) -> List[Dict]:
        kept = []
        for cand in candidates:
            if self._is_same_event(cand, selected_candidate, self.candidate_overlap_iou, self.candidate_overlap_cover):
                continue
            kept.append(cand)
        return kept

    def _run_greedy_for_template(
        self,
        joint_features: Dict[int, object],
        tmpl: Dict,
        selected_joints: List[int],
        exclude_templates: List[Dict],
    ) -> Tuple[List[Dict], List[Dict], List[Dict]]:
        raw_candidates = self._generate_raw_candidates_for_template(
            joint_features,
            tmpl,
            selected_joints,
            exclude_templates,
        )
        if not raw_candidates:
            return [], [], []

        best_raw_score = max(c["final_score"] for c in raw_candidates)
        working_floor = self._score_floor_from_best(best_raw_score, self.candidate_relative_margin)
        working = [c for c in raw_candidates if c["final_score"] >= working_floor]
        working = sorted(working, key=lambda x: (x["final_score"], x["window_length"]), reverse=True)

        selected_final: List[Dict] = []
        greedy_trace: List[Dict] = []

        while working:
            seed = working[0]
            refined = self._refine_selected_candidate_for_template(
                seed,
                joint_features,
                tmpl,
                selected_joints,
                exclude_templates,
            )
            greedy_trace.append(
                {
                    "template_id": tmpl["id"],
                    "seed": self._segment_to_debug_dict(seed),
                    "refined": self._segment_to_debug_dict(refined),
                    "remaining_before": len(working),
                    "working_floor": float(working_floor),
                }
            )
            if refined["final_score"] < working_floor:
                break

            selected_final.append(refined)
            working = self._remove_overlapping_candidates(working[1:], refined)
            working = sorted(working, key=lambda x: (x["final_score"], x["window_length"]), reverse=True)

        return raw_candidates, selected_final, greedy_trace

    def _select_final_candidates(self, candidates: List[Dict]) -> List[Dict]:
        if not candidates:
            return []

        ranked = sorted(candidates, key=lambda x: (x["final_score"], x["window_length"]), reverse=True)
        best_score = ranked[0]["final_score"]
        floor = self._score_floor_from_best(best_score, self.final_relative_margin)
        kept = [cand for cand in ranked if cand["final_score"] >= floor]
        if not kept:
            kept = ranked[:self.top_k_final_fallback]
        return kept

    def _union_template_results(self, per_template_selected: List[Dict]) -> List[Dict]:
        ranked = sorted(
            per_template_selected,
            key=lambda x: (x["final_score"], x["dtw_similarity"], x["window_length"]),
            reverse=True,
        )
        final = []
        for cand in ranked:
            if any(
                self._is_same_event(cand, kept, self.final_union_iou, self.final_union_cover)
                for kept in final
            ):
                continue
            final.append(cand)
        return sorted(final, key=lambda x: x["start_frame"])

    def detect(self, pose_file: str, selected_joints: List[int], user_segments: List[Tuple[float, float]]) -> Dict:
        if not selected_joints:
            return {"error": "No joints selected"}
        invalid = [joint for joint in selected_joints if joint not in self.JOINT_RELATIONS]
        if invalid:
            return {"error": f"Invalid joints: {invalid}"}

        info = self.load_pose_data(pose_file)
        if "error" in info:
            return info

        templates = self._extract_templates(user_segments)
        if not templates:
            return {"error": "Template segments could not be extracted"}

        template_bank = self._build_template_feature_bank(templates, selected_joints)
        if not template_bank:
            return {"error": "No valid template features"}

        joint_features = {joint: self._extract_features_single_joint(self.frames, joint) for joint in selected_joints}
        exclude_templates = [{"id": t["id"], "seq_start": t["seq_start"], "seq_end": t["seq_end"]} for t in template_bank]

        all_raw_candidates: List[Dict] = []
        per_template_selected: List[Dict] = []
        greedy_trace: List[Dict] = []
        per_template_summary: List[Dict] = []

        for tmpl in template_bank:
            raw_candidates, selected_final, trace = self._run_greedy_for_template(
                joint_features,
                tmpl,
                selected_joints,
                exclude_templates,
            )
            all_raw_candidates.extend(raw_candidates)
            per_template_selected.extend(selected_final)
            greedy_trace.extend(trace)
            per_template_summary.append(
                {
                    "template_id": tmpl["id"],
                    "raw_count": len(raw_candidates),
                    "selected_count": len(selected_final),
                }
            )

        union_candidates = self._union_template_results(per_template_selected)
        final_candidates = self._select_final_candidates(union_candidates)

        motion_segments = []
        for item in final_candidates:
            motion_segments.append(
                MotionSegment(
                    start_time=item["start_time"],
                    end_time=item["end_time"],
                    start_frame=item["start_frame"],
                    end_frame=item["end_frame"],
                    template_id=item["template_id"],
                    dtw_similarity=item["dtw_similarity"],
                    final_score=item["final_score"],
                    window_scale=item["window_scale"],
                    window_length=item["window_length"],
                    details=item["details"],
                )
            )

        final_segments = self._resolve_strict_overlaps(
            sorted(motion_segments, key=lambda x: x.final_score, reverse=True)
        )

        debug_info = self._build_debug_info(
            raw_candidates=all_raw_candidates,
            clustering_candidates=all_raw_candidates,
            cluster_representatives=per_template_selected,
            filtered_representatives=final_candidates,
            user_segments=user_segments,
        )
        debug_info["greedy_trace"] = greedy_trace
        debug_info["per_template_summary"] = per_template_summary

        return {
            "segments": sorted(final_segments, key=lambda x: x.start_frame),
            "debug": debug_info,
            "stats": {
                "templates": len(template_bank),
                "initial_candidates": len(all_raw_candidates),
                "threshold_passed_candidates": len(per_template_selected),
                "post_union_candidates": len(union_candidates),
                "final_results": len(final_segments),
                "avg_final_score": float(sum(seg.final_score for seg in final_segments) / len(final_segments)) if final_segments else 0.0,
            },
            "params": {
                "numba": _HAS_NUMBA,
                "frame_refine_radius": self.frame_refine_radius,
                "selected_joints": selected_joints,
                "selected_joint_names": [self.JOINT_NAMES[j] for j in selected_joints],
                "feature_type": self.feature_type_name,
                "final_score_threshold": self.greedy_stop_threshold,
                "length_score_used": False,
                "template_overlap_margin_ratio": self.template_overlap_margin_ratio,
                "selection_mode": "template_wise_greedy_refine_then_union",
                "greedy_refine_radius": self.greedy_refine_radius,
                "candidate_relative_margin": self.candidate_relative_margin,
                "final_relative_margin": self.final_relative_margin,
                "candidate_overlap_iou": self.candidate_overlap_iou,
                "candidate_overlap_cover": self.candidate_overlap_cover,
                "final_union_iou": self.final_union_iou,
                "final_union_cover": self.final_union_cover,
                "near_duplicate_gap_frames": self.near_duplicate_gap_frames,
            },
        }
