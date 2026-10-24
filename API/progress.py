"""In-memory progress state for long-running local API requests."""

import threading
from copy import deepcopy


_PROGRESS_LOCK = threading.Lock()
_PROGRESS_STATES: dict[str, dict] = {}


def initialize_progress(progress_id: str | None, initial_state: dict) -> None:
    if not progress_id:
        return
    with _PROGRESS_LOCK:
        _PROGRESS_STATES[progress_id] = deepcopy(initial_state)


def update_progress(progress_id: str | None, state: dict) -> None:
    if not progress_id:
        return
    with _PROGRESS_LOCK:
        current = _PROGRESS_STATES.get(progress_id, {})
        _PROGRESS_STATES[progress_id] = {**current, **deepcopy(state)}


def get_progress(progress_id: str) -> dict | None:
    with _PROGRESS_LOCK:
        state = _PROGRESS_STATES.get(progress_id)
        return deepcopy(state) if state is not None else None


def clear_progress(progress_id: str | None) -> None:
    if not progress_id:
        return
    with _PROGRESS_LOCK:
        _PROGRESS_STATES.pop(progress_id, None)


def create_progress_callback(progress_id: str | None):
    if not progress_id:
        return None

    def callback(state: dict) -> None:
        update_progress(progress_id, state)

    return callback
