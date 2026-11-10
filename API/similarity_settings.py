"""類似動作検索で利用者が変更できる設定の検証。"""

import math


MIN_DURATION_RATIO = 0.30
MAX_DURATION_RATIO = 3.00
VALID_SENSITIVITIES = {"low", "standard", "high"}


def build_window_scales(
    min_duration_ratio: float,
    max_duration_ratio: float,
) -> list[float]:
    """0.1刻みの倍率に、利用者が指定した最小値と最大値を加える。"""
    validate_similarity_search_settings(
        min_duration_ratio,
        max_duration_ratio,
        "standard",
    )

    first_tenth = math.ceil(min_duration_ratio * 10 - 1e-9)
    last_tenth = math.floor(max_duration_ratio * 10 + 1e-9)
    scales = {
        round(min_duration_ratio, 6),
        round(max_duration_ratio, 6),
        *(round(value / 10, 6) for value in range(first_tenth, last_tenth + 1)),
    }
    if min_duration_ratio <= 1.0 <= max_duration_ratio:
        scales.add(1.0)
    return sorted(scales)


def calculate_refine_radius(template_length: int, fps: float) -> int:
    """テンプレート長の10%を、3フレームから0.5秒の範囲に収める。"""
    if template_length <= 0:
        raise ValueError("template_length must be greater than zero")
    if not math.isfinite(fps) or fps <= 0:
        raise ValueError("fps must be greater than zero")

    proportional_radius = int(round(template_length * 0.10))
    maximum_radius = max(3, int(round(fps * 0.5)))
    return min(maximum_radius, max(3, proportional_radius))


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
