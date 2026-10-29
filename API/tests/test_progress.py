import unittest
from uuid import uuid4

from API.progress import (
    clear_progress,
    create_progress_callback,
    get_progress,
    initialize_progress,
    update_progress,
)


class ProgressStateTests(unittest.TestCase):
    def setUp(self):
        self.progress_id = str(uuid4())

    def tearDown(self):
        clear_progress(self.progress_id)

    def test_state_is_copied_on_write_and_read(self):
        initial_state = {"stage": "alphapose", "detail": {"current": 1}}
        initialize_progress(self.progress_id, initial_state)
        initial_state["detail"]["current"] = 99

        stored_state = get_progress(self.progress_id)
        self.assertEqual(
            stored_state,
            {"stage": "alphapose", "detail": {"current": 1}},
        )

        stored_state["detail"]["current"] = 50
        self.assertEqual(get_progress(self.progress_id)["detail"]["current"], 1)

    def test_update_merges_top_level_state(self):
        initialize_progress(
            self.progress_id,
            {"stage": "alphapose", "status": "running"},
        )
        update_progress(self.progress_id, {"stage": "motionbert", "percent": 50})

        self.assertEqual(
            get_progress(self.progress_id),
            {"stage": "motionbert", "status": "running", "percent": 50},
        )

    def test_callback_updates_and_clear_removes_state(self):
        callback = create_progress_callback(self.progress_id)
        self.assertIsNotNone(callback)

        callback({"status": "completed"})
        self.assertEqual(get_progress(self.progress_id), {"status": "completed"})

        clear_progress(self.progress_id)
        self.assertIsNone(get_progress(self.progress_id))

    def test_empty_progress_id_is_ignored(self):
        initialize_progress(None, {"status": "running"})
        update_progress(None, {"status": "completed"})
        clear_progress(None)
        self.assertIsNone(create_progress_callback(None))


if __name__ == "__main__":
    unittest.main()
