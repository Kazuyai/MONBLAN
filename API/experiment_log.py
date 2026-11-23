"""評価実験と性能分析のための構造化された処理時間ログ。"""

from __future__ import annotations

import csv
import json
import logging
import os
import threading
import time
import uuid
from datetime import datetime
from typing import Callable

try:
    from .paths import BASE_DIR
except ImportError:
    from paths import BASE_DIR


LOG_FILE_NAME = "experiment_runs.csv"
FIELDNAMES = [
    "recorded_at",
    "run_id",
    "progress_id",
    "event_type",
    "api_name",
    "video_group",
    "video_name",
    "stage",
    "status",
    "duration_seconds",
    "wait_time_seconds",
    "result_count",
    "analysis_start_frame",
    "analysis_end_frame",
    "alphapose_cache_hit",
    "motionbert_cache_hit",
    "similarity_cache_hit",
    "details",
]

_LOG_LOCK = threading.Lock()
logger = logging.getLogger(__name__)


def get_experiment_log_path() -> str:
    log_dir = os.environ.get("MONBLAN_LOG_DIR") or BASE_DIR
    return os.path.join(log_dir, LOG_FILE_NAME)


def _format_bool(value: bool | None) -> str:
    if value is None:
        return ""
    return "true" if value else "false"


def _append_rows(path: str, rows: list[dict]) -> None:
    if not rows:
        return

    with _LOG_LOCK:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        is_new_file = not os.path.exists(path) or os.path.getsize(path) == 0
        encoding = "utf-8-sig" if is_new_file else "utf-8"
        with open(path, "a", newline="", encoding=encoding) as log_file:
            writer = csv.DictWriter(log_file, fieldnames=FIELDNAMES)
            if is_new_file:
                writer.writeheader()
            writer.writerows(rows)


class ExperimentRunRecorder:
    """段階の遷移を集計し、段階別行とリクエスト集計行を追記する。"""

    def __init__(
        self,
        api_name: str,
        video_path: str,
        progress_id: str | None = None,
        *,
        analysis_start_frame: int | None = None,
        analysis_end_frame: int | None = None,
        details: dict | None = None,
        initial_stage: str = "入力データの準備",
        log_path: str | None = None,
        clock: Callable[[], float] = time.perf_counter,
        now: Callable[[], datetime] = datetime.now,
    ) -> None:
        self.api_name = api_name
        self.progress_id = progress_id or ""
        self.video_group = os.path.basename(os.path.dirname(video_path))
        self.video_name = os.path.basename(video_path)
        self.analysis_start_frame = analysis_start_frame
        self.analysis_end_frame = analysis_end_frame
        self.details = details or {}
        self.log_path = log_path or get_experiment_log_path()
        self.clock = clock
        self.now = now
        self.run_id = str(uuid.uuid4())
        self.started_at = self.now()
        self.started_clock = self.clock()
        self.current_stage = initial_stage
        self.current_stage_started = self.started_clock
        self.stage_rows: list[dict] = []
        self.finished = False

    def _base_row(self) -> dict:
        return {
            "recorded_at": self.started_at.isoformat(timespec="seconds"),
            "run_id": self.run_id,
            "progress_id": self.progress_id,
            "api_name": self.api_name,
            "video_group": self.video_group,
            "video_name": self.video_name,
            "analysis_start_frame": self.analysis_start_frame
            if self.analysis_start_frame is not None
            else "",
            "analysis_end_frame": self.analysis_end_frame
            if self.analysis_end_frame is not None
            else "",
        }

    def _close_current_stage(self, ended_at: float) -> None:
        if not self.current_stage:
            return
        self.stage_rows.append(
            {
                **self._base_row(),
                "event_type": "stage",
                "stage": self.current_stage,
                "status": "",
                "duration_seconds": f"{max(0.0, ended_at - self.current_stage_started):.3f}",
                "wait_time_seconds": "",
                "result_count": "",
                "alphapose_cache_hit": "",
                "motionbert_cache_hit": "",
                "similarity_cache_hit": "",
                "details": "",
            }
        )

    def transition(self, stage: str | None) -> None:
        if self.finished or not stage or stage == self.current_stage:
            return
        now = self.clock()
        self._close_current_stage(now)
        self.current_stage = stage
        self.current_stage_started = now

    def progress_callback(self, callback: Callable[[dict], None] | None):
        def record_progress(state: dict) -> None:
            self.transition(state.get("stage"))
            if callback is not None:
                callback(state)

        return record_progress

    def finish(
        self,
        status: str,
        *,
        result_count: int | None = None,
        alphapose_cache_hit: bool | None = None,
        motionbert_cache_hit: bool | None = None,
        similarity_cache_hit: bool | None = None,
        error: str | None = None,
    ) -> None:
        if self.finished:
            return

        ended_at = self.clock()
        self._close_current_stage(ended_at)
        details = dict(self.details)
        if error:
            details["error"] = error
        total_duration = f"{max(0.0, ended_at - self.started_clock):.3f}"
        summary_row = {
            **self._base_row(),
            "event_type": "request",
            "stage": "",
            "status": status,
            "duration_seconds": total_duration,
            "wait_time_seconds": total_duration,
            "result_count": result_count if result_count is not None else "",
            "alphapose_cache_hit": _format_bool(alphapose_cache_hit),
            "motionbert_cache_hit": _format_bool(motionbert_cache_hit),
            "similarity_cache_hit": _format_bool(similarity_cache_hit),
            "details": json.dumps(details, ensure_ascii=False, separators=(",", ":")),
        }
        try:
            _append_rows(self.log_path, [*self.stage_rows, summary_row])
        except OSError as error:
            logger.warning("Could not write experiment timing log: %s", error)
        finally:
            self.finished = True
