"""類似動作検索で利用者が変更できる設定の検証。"""

import math


MIN_DURATION_RATIO = 0.30
MAX_DURATION_RATIO = 3.00
VALID_SENSITIVITIES = {"low", "standard", "high"}


def validate_similarity_search_settings(
    min_duration_ratio: float,
    max_duration_ratio: float,
    sensitivity: str,
) -> None:
    if not math.isfinite(min_duration_ratio) or not MIN_DURATION_RATIO <= min_duration_ratio <= MAX_DURATION_RATIO:
        raise ValueError("minDurationRatio must be between 0.30 and 3.00")
    if not math.isfinite(max_duration_ratio) or not MIN_DURATION_RATIO <= max_duration_ratio <= MAX_DURATION_RATIO:
        raise ValueError("maxDurationRatio must be between 0.30 and 3.00")
    if min_duration_ratio > max_duration_ratio:
        raise ValueError("minDurationRatio must not exceed maxDurationRatio")
    if sensitivity not in VALID_SENSITIVITIES:
        raise ValueError("sensitivity must be low, standard, or high")
