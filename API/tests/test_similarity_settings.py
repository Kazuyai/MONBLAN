import math
import unittest

from API.similarity_settings import (
    build_window_scales,
    calculate_refine_radius,
    validate_similarity_search_settings,
)


class SimilaritySearchSettingsTests(unittest.TestCase):
    def test_accepts_standard_and_custom_settings(self):
        validate_similarity_search_settings(0.60, 1.40, "standard")
        validate_similarity_search_settings(0.55, 1.80, "high")

    def test_rejects_reversed_duration_range(self):
        with self.assertRaisesRegex(ValueError, "must not exceed"):
            validate_similarity_search_settings(1.40, 0.70, "standard")

    def test_rejects_out_of_range_or_non_finite_values(self):
        for minimum, maximum in ((0.29, 1.40), (0.70, 3.01), (math.nan, 1.40)):
            with self.subTest(minimum=minimum, maximum=maximum):
                with self.assertRaises(ValueError):
                    validate_similarity_search_settings(minimum, maximum, "standard")

    def test_rejects_unknown_sensitivity(self):
        with self.assertRaisesRegex(ValueError, "sensitivity"):
            validate_similarity_search_settings(0.70, 1.40, "maximum")

    def test_builds_uniform_scales_and_keeps_custom_endpoints(self):
        self.assertEqual(
            build_window_scales(0.65, 1.42),
            [0.65, 0.7, 0.8, 0.9, 1.0, 1.1, 1.2, 1.3, 1.4, 1.42],
        )

    def test_calculates_proportional_refine_radius_with_limits(self):
        self.assertEqual(calculate_refine_radius(20, 30.0), 3)
        self.assertEqual(calculate_refine_radius(80, 30.0), 8)
        self.assertEqual(calculate_refine_radius(300, 30.0), 15)


if __name__ == "__main__":
    unittest.main()
