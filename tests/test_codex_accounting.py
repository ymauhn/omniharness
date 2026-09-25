"""Offline contract checks for Codex App Server usage notifications."""
import hashlib
import json
import unittest

from harness.codex_accounting import usage_from_app_server_events


def event(method, params):
    return {"jsonrpc": "2.0", "method": method, "params": params}


def started(thread="thread-1", turn="turn-1"):
    return event("turn/started", {"threadId": thread,
                                  "turn": {"id": turn, "status": "inProgress", "items": []}})


def completed(status="completed", thread="thread-1", turn="turn-1"):
    return event("turn/completed", {"threadId": thread,
                                    "turn": {"id": turn, "status": status, "items": []}})


def breakdown(inputs, outputs, cached, reasoning, *, cache_write=None):
    result = {"inputTokens": inputs, "outputTokens": outputs,
              "cachedInputTokens": cached, "reasoningOutputTokens": reasoning,
              "totalTokens": inputs + outputs}
    if cache_write is not None:
        result["cacheWriteInputTokens"] = cache_write
    return result


def usage(total, last, thread="thread-1", turn="turn-1"):
    return event("thread/tokenUsage/updated", {"threadId": thread, "turnId": turn,
                                                "tokenUsage": {"total": total, "last": last}})


def stream(*events):
    return ("\n".join(json.dumps(value) for value in events) + "\n").encode()


class CodexAppServerUsage(unittest.TestCase):
    def parse(self, *events, exit_code=0):
        return usage_from_app_server_events(stream(*events), thread_id="thread-1",
                                            turn_id="turn-1", exit_code=exit_code)

    def test_cumulative_snapshots_and_subsets_are_never_summed(self):
        first = usage(breakdown(60, 20, 25, 4), breakdown(10, 3, 5, 1))
        final = usage(breakdown(90, 30, 40, 7, cache_write=6),
                      breakdown(20, 8, 10, 2))
        data = stream(started(), first, first, final, completed())
        receipt = usage_from_app_server_events(data, thread_id="thread-1",
                                               turn_id="turn-1", exit_code=0)
        self.assertEqual(receipt["schema_version"], 1)
        self.assertEqual(receipt["provider"], "codex")
        self.assertEqual(receipt["protocol"], "app-server-json-rpc-v2")
        self.assertEqual(receipt["usage_scope"], "thread")
        self.assertEqual(receipt["counter_scope"], "thread-cumulative")
        self.assertEqual(receipt["source_sha256"], hashlib.sha256(data).hexdigest())
        self.assertEqual(receipt["terminal_status"], "completed")
        self.assertTrue(receipt["process_ok"])
        self.assertTrue(receipt["usage_observed"])
        self.assertEqual(receipt["observed_thread_total"]["total_tokens"], 120)
        self.assertEqual(receipt["observed_thread_total"]["cached_input_tokens"], 40)
        self.assertEqual(receipt["observed_thread_total"]["cache_write_input_tokens"], 6)
        self.assertEqual(receipt["observed_last"]["total_tokens"], 28)
        self.assertIsNone(receipt["observed_last"]["cache_write_input_tokens"])
        self.assertIsNone(receipt["total_tokens"])
        self.assertFalse(receipt["usage_complete"])
        self.assertIsNone(receipt["estimated_usd"])
        self.assertIsNone(receipt["billed_usd"])

    def test_foreign_turn_and_thread_cannot_supply_missing_usage_or_terminal(self):
        foreign = usage(breakdown(40, 5, 20, 1), breakdown(40, 5, 20, 1),
                        thread="thread-2", turn="turn-2")
        rec = self.parse(started(), foreign, completed())
        self.assertTrue(rec["process_ok"])
        self.assertFalse(rec["usage_observed"])
        self.assertIsNone(rec["observed_thread_total"])
        self.assertTrue(any("usage" in issue for issue in rec["issues"]))
        rec = self.parse(started(), usage(breakdown(40, 5, 20, 1),
                                          breakdown(40, 5, 20, 1)),
                         completed(thread="thread-2", turn="turn-2"))
        self.assertFalse(rec["process_ok"])
        self.assertIsNone(rec["terminal_status"])

    def test_optional_jsonrpc_envelope_preserves_usage_and_unknown_coverage(self):
        events = [{"jsonrpc": "2.0", "id": 1, "result": {}}, started(),
                  usage(breakdown(40, 5, 20, 1), breakdown(40, 5, 20, 1)), completed()]
        expected = self.parse(*events)
        expected.pop("source_sha256")
        for omitted in (range(len(events)), (0, 2)):
            with self.subTest(omitted=list(omitted)):
                wire = [{key: value for key, value in item.items()
                         if key != "jsonrpc" or index not in omitted}
                        for index, item in enumerate(events)]
                data = stream(*wire)
                receipt = self.parse(*wire)
                self.assertEqual(receipt.pop("source_sha256"), hashlib.sha256(data).hexdigest())
                self.assertEqual(receipt, expected)
                self.assertFalse(receipt["usage_complete"])
                self.assertIsNone(receipt["total_tokens"])
                self.assertIsNone(receipt["billed_usd"])
                self.assertTrue(any("baseline" in issue for issue in receipt["issues"]))
                self.assertTrue(any("descendant" in issue for issue in receipt["issues"]))

    def test_explicit_invalid_jsonrpc_and_duplicate_keys_remain_rejected(self):
        for version in (None, "1.0", 2.0, True, [], {}):
            with self.subTest(version=version):
                with self.assertRaises(ValueError):
                    self.parse({**started(), "jsonrpc": version})
                with self.assertRaises(ValueError):
                    self.parse({"jsonrpc": version, "id": 1, "result": {}})
        with self.assertRaisesRegex(ValueError, "duplicate JSON key: method"):
            usage_from_app_server_events(
                b'{"method":"ignored","method":"turn/started","params":{}}\n',
                thread_id="thread-1", turn_id="turn-1", exit_code=0)

    def test_missing_terminal_or_usage_is_unresolved(self):
        measured = usage(breakdown(40, 5, 20, 1), breakdown(40, 5, 20, 1))
        missing_terminal = self.parse(started(), measured)
        self.assertFalse(missing_terminal["process_ok"])
        self.assertIsNone(missing_terminal["terminal_status"])
        self.assertEqual(missing_terminal["observed_thread_total"]["total_tokens"], 45)
        no_usage = self.parse(started(), completed())
        self.assertTrue(no_usage["process_ok"])
        self.assertFalse(no_usage["usage_observed"])
        self.assertIsNone(no_usage["total_tokens"])

    def test_interrupted_or_failed_turn_retains_observed_snapshot_as_partial(self):
        measured = usage(breakdown(40, 5, 20, 1), breakdown(40, 5, 20, 1))
        for status in ("interrupted", "failed"):
            with self.subTest(status=status):
                rec = self.parse(started(), measured, completed(status))
                self.assertEqual(rec["terminal_status"], status)
                self.assertFalse(rec["process_ok"])
                self.assertTrue(rec["usage_observed"])
                self.assertFalse(rec["usage_complete"])
                self.assertIsNone(rec["total_tokens"])
                self.assertTrue(any("terminal" in issue for issue in rec["issues"]))
        nonzero = self.parse(started(), measured, completed(), exit_code=7)
        self.assertFalse(nonzero["process_ok"])

    def test_malformed_wire_or_invalid_counters_are_rejected(self):
        with self.assertRaises(ValueError):
            usage_from_app_server_events(b'{"jsonrpc":"2.0",\n', thread_id="thread-1",
                                         turn_id="turn-1", exit_code=0)
        with self.assertRaises(ValueError):
            self.parse({"jsonrpc": "2.0", "method": {}, "params": {}})
        with self.assertRaises(ValueError):
            self.parse(started(), {"jsonrpc": "2.0", "method": "turn/completed",
                                   "params": {"threadId": "thread-1",
                                              "turn": {"id": "turn-1", "status": {}}}})
        invalid = [
            {**breakdown(4, 2, 1, 1), "inputTokens": True},
            {**breakdown(4, 2, 1, 1), "cachedInputTokens": 5},
            {**breakdown(4, 2, 1, 1), "reasoningOutputTokens": 3},
            {**breakdown(4, 2, 1, 1), "totalTokens": 7},
            {**breakdown(4, 2, 1, 1), "cacheWriteInputTokens": -1},
        ]
        for counter in invalid:
            with self.subTest(counter=counter):
                with self.assertRaises(ValueError):
                    self.parse(started(), usage(counter, breakdown(1, 1, 0, 0)),
                               completed())

    def test_duplicate_terminal_or_late_usage_cannot_approve_capture(self):
        measured = usage(breakdown(40, 5, 20, 1), breakdown(40, 5, 20, 1))
        for events in ((started(), measured, completed(), completed()),
                       (started(), measured, completed(), measured)):
            with self.subTest(events=events):
                with self.assertRaises(ValueError):
                    self.parse(*events)

    def test_decreasing_thread_counter_cannot_be_used_after_recovery(self):
        before = usage(breakdown(80, 20, 30, 3), breakdown(15, 5, 5, 1))
        after = usage(breakdown(79, 20, 30, 3), breakdown(15, 5, 5, 1))
        with self.assertRaisesRegex(ValueError, "cumulative usage decreased"):
            self.parse(started(), before, after, completed())

    def test_optional_cache_write_counters_remain_consistent_when_present(self):
        with self.assertRaisesRegex(ValueError, "last cache-write usage exceeds"):
            self.parse(started(), usage(breakdown(30, 5, 2, 1, cache_write=4),
                                        breakdown(15, 2, 1, 0, cache_write=5)), completed())
        before = usage(breakdown(30, 5, 2, 1, cache_write=4),
                       breakdown(15, 2, 1, 0, cache_write=2))
        after = usage(breakdown(40, 8, 4, 2, cache_write=3),
                      breakdown(20, 3, 2, 1, cache_write=2))
        with self.assertRaisesRegex(ValueError, "cumulative cache-write usage decreased"):
            self.parse(started(), before, after, completed())


if __name__ == "__main__":
    unittest.main()
