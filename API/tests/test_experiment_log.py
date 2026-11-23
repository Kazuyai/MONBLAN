import csv
import tempfile
import unittest
from datetime import datetime
from pathlib import Path

from API.experiment_log import ExperimentRunRecorder


class FakeClock:
    def __init__(self):
        self.value = 0.0

    def __call__(self):
        return self.value

    def advance(self, seconds: float):
        self.value += seconds


class ExperimentRunRecorderTests(unittest.TestCase):
    def test_writes_stage_and_request_rows(self):
        clock = FakeClock()
        with tempfile.TemporaryDirectory() as directory:
            log_path = Path(directory) / "experiment_runs.csv"
            recorder = ExperimentRunRecorder(
                "similar_motion_from_path",
                str(Path("videos") / "side" / "04.mp4"),
                "progress-1",
                analysis_start_frame=10,
                analysis_end_frame=120,
                details={"sensitivity": "standard"},
                log_path=str(log_path),
                clock=clock,
                now=lambda: datetime(2026, 11, 23, 12, 0, 0),
            )

            clock.advance(1.25)
            recorder.transition("2次元姿勢推定")
            clock.advance(2.5)
            recorder.transition("3次元姿勢推定")
            clock.advance(3.0)
            recorder.finish(
                "success",
                result_count=4,
                alphapose_cache_hit=True,
                motionbert_cache_hit=False,
                similarity_cache_hit=False,
            )

            with log_path.open(encoding="utf-8-sig", newline="") as log_file:
                rows = list(csv.DictReader(log_file))

        self.assertEqual(len(rows), 4)
        self.assertEqual(rows[0]["event_type"], "stage")
        self.assertEqual(rows[0]["stage"], "入力データの準備")
        self.assertEqual(rows[0]["duration_seconds"], "1.250")
        self.assertEqual(rows[2]["stage"], "3次元姿勢推定")
        self.assertEqual(rows[3]["event_type"], "request")
        self.assertEqual(rows[3]["status"], "success")
        self.assertEqual(rows[3]["duration_seconds"], "6.750")
        self.assertEqual(rows[3]["wait_time_seconds"], "6.750")
        self.assertEqual(rows[0]["wait_time_seconds"], "")
        self.assertEqual(rows[3]["video_group"], "side")
        self.assertEqual(rows[3]["video_name"], "04.mp4")
        self.assertEqual(rows[3]["result_count"], "4")
        self.assertEqual(rows[3]["alphapose_cache_hit"], "true")
        self.assertIn('"sensitivity":"standard"', rows[3]["details"])

    def test_finish_is_idempotent(self):
        clock = FakeClock()
        with tempfile.TemporaryDirectory() as directory:
            log_path = Path(directory) / "experiment_runs.csv"
            recorder = ExperimentRunRecorder(
                "create_item_from_path",
                "01.mp4",
                log_path=str(log_path),
                clock=clock,
            )
            clock.advance(1)
            recorder.finish("failed", error="test")
            recorder.finish("success")

            with log_path.open(encoding="utf-8-sig", newline="") as log_file:
                rows = list(csv.DictReader(log_file))

        self.assertEqual(len(rows), 2)
        self.assertEqual(rows[-1]["status"], "failed")
        self.assertIn('"error":"test"', rows[-1]["details"])


if __name__ == "__main__":
    unittest.main()
