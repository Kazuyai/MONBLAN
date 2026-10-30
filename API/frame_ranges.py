"""Frame interval helpers shared by the annotation pipelines."""

ANNOTATION_FRAME_INDEX_BASE = 1


def validate_frame_range(
    start_frame: int | None,
    end_frame: int | None,
    *,
    start_name: str,
    end_name: str,
) -> None:
    if start_frame is not None and start_frame < ANNOTATION_FRAME_INDEX_BASE:
        raise ValueError(f"{start_name} must be frame one or greater")
    if end_frame is not None and end_frame < ANNOTATION_FRAME_INDEX_BASE:
        raise ValueError(f"{end_name} must be frame one or greater")
    if start_frame is not None and end_frame is not None and end_frame < start_frame:
        raise ValueError(f"{end_name} must be greater than or equal to {start_name}")


def filter_results_by_frame_range(
    results: list[dict],
    start_frame: int | None,
    end_frame: int | None,
) -> list[dict]:
    if start_frame is None and end_frame is None:
        return results

    filtered_results = []
    for result in results:
        result_start_frame = int(result["startFrame"])
        result_end_frame = int(result["endFrame"])
        if start_frame is not None and result_start_frame < start_frame:
            continue
        if end_frame is not None and result_end_frame > end_frame:
            continue
        filtered_results.append(result)
    return filtered_results


def inclusive_frame_ranges_overlap(
    first_start: int,
    first_end: int,
    second_start: int,
    second_end: int,
) -> bool:
    return first_start <= second_end and second_start <= first_end


def local_detection_interval_to_annotation(
    local_start_frame: int,
    local_end_frame: int,
    frame_offset: int = 0,
) -> tuple[int, int]:
    return (
        local_start_frame + ANNOTATION_FRAME_INDEX_BASE + frame_offset,
        local_end_frame + ANNOTATION_FRAME_INDEX_BASE + frame_offset,
    )
