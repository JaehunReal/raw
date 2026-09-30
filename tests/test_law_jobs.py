from __future__ import annotations

import threading
import time
import unittest

from rulecraft.law_jobs import LawJobConflict, LawJobs


class LawJobTests(unittest.TestCase):
    def test_one_collection_at_a_time_cancellation_and_restart(self) -> None:
        started, released = threading.Event(), threading.Event()

        class SlowSync:
            def run(self, sources, page_size, progress, cancel_event):
                started.set()
                progress({"source": sources[0], "collected": 1})
                released.wait(2)
                return {"complete": not cancel_event.is_set()}

        jobs = LawJobs(None, SlowSync)
        self.addCleanup(jobs.close)
        first = jobs.start(["law"])
        self.assertTrue(started.wait(2))
        with self.assertRaises(LawJobConflict):
            jobs.start(["ordinance"])
        self.assertEqual(jobs.status()["progress"]["collected"], 1)
        self.assertEqual(jobs.cancel()["status"], "cancelling")
        released.set()
        self.await_status(jobs, "cancelled")
        second = jobs.start(["ordinance"])
        self.assertNotEqual(first["id"], second["id"])
        self.await_status(jobs, "completed")

    def test_incomplete_result_and_exception_do_not_claim_success_or_leak_credentials(self) -> None:
        class IncompleteSync:
            def run(self, **kwargs):
                return {"complete": False, "sources": {"law": {"expected": 2, "collected": 1}}}

        jobs = LawJobs(None, IncompleteSync)
        self.addCleanup(jobs.close)
        jobs.start(["law"])
        self.await_status(jobs, "incomplete")
        self.assertFalse(jobs.status()["coverage"]["complete"])

        class FailingSync:
            def run(self, **kwargs):
                raise RuntimeError("https://law.example/?OC=must-remain-private")

        jobs.synchronizer = FailingSync
        jobs.start(["law"])
        self.await_status(jobs, "failed")
        self.assertNotIn("must-remain-private", str(jobs.status()))
        self.assertNotIn("OC=", str(jobs.status()))

    def await_status(self, jobs, expected):
        deadline = time.monotonic() + 2
        while time.monotonic() < deadline:
            if jobs.status()["status"] == expected:
                return
            threading.Event().wait(0.005)
        self.fail(f"Expected {expected}, got {jobs.status()}")
