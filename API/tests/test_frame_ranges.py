import unittest

from API.frame_ranges import (
    filter_results_by_frame_range,
    inclusive_frame_ranges_overlap,
    local_detection_interval_to_annotation,
    validate_frame_range,
)


class FrameRangeTests(unittest.TestCase):
    def test_rejects_zero_based_and_reversed_ranges(self):
        with self.assertRaisesRegex(ValueError, "startFrame"):
            validate_frame_range(
                0,
                10,
                start_name="startFrame",
                end_name="endFrame",
            )
        with self.assertRaisesRegex(ValueError, "endFrame"):
            validate_frame_range(
                10,
                9,
                start_name="startFrame",
                end_name="endFrame",
            )

    def test_filter_keeps_only_fully_contained_inclusive_ranges(self):
        results = [
            {"startFrame": 9, "endFrame": 12},
            {"startFrame": 10, "endFrame": 12},
            {"startFrame": 18, "endFrame": 20},
            {"startFrame": 18, "endFrame": 21},
        ]

        self.assertEqual(
            filter_results_by_frame_range(results, 10, 20),
            [results[1], results[2]],
        )

    def test_inclusive_ranges_overlap_at_shared_boundary(self):
        self.assertTrue(inclusive_frame_ranges_overlap(10, 20, 20, 30))
        self.assertFalse(inclusive_frame_ranges_overlap(10, 19, 20, 30))

    def test_partial_analysis_offset_restores_global_frame_numbers(self):
        self.assertEqual(
            local_detection_interval_to_annotation(0, 59, frame_offset=120),
            (121, 180),
        )


if __name__ == "__main__":
    unittest.main()
