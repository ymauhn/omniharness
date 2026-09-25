"""Read-only Codex App Server v2 receipt from coordinator-captured JSONL lines.

The installed CLI's generated schemas define the notification shapes:
https://github.com/openai/codex/blob/main/codex-rs/app-server-protocol/schema/json/v2/ThreadTokenUsageUpdatedNotification.json
https://github.com/openai/codex/blob/main/codex-rs/app-server-protocol/schema/json/v2/TurnCompletedNotification.json

``last`` is the latest active context; ``total`` is a thread cumulative counter.
Neither is a turn/whole-tree total without a verified baseline and child coverage.
"""
import hashlib
import json


RECEIPT_CONTRACT = {
    "schema_version": 1, "provider": "codex", "protocol": "app-server-json-rpc-v2",
    "usage_scope": "thread", "counter_scope": "thread-cumulative",
    "token_basis": "codex-app-server-overlapping-subsets", "cost_basis": "unavailable",
}
_COUNTERS = {
    "inputTokens": "input_tokens", "outputTokens": "output_tokens",
    "cachedInputTokens": "cached_input_tokens",
    "reasoningOutputTokens": "reasoning_output_tokens",
    "totalTokens": "total_tokens",
}
_METHODS = {"turn/started", "thread/tokenUsage/updated", "turn/completed"}
_TERMINAL = {"completed", "interrupted", "failed"}


def _no_duplicates(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError(f"duplicate JSON key: {key}")
        result[key] = value
    return result


def _breakdown(value):
    if not isinstance(value, dict):
        raise ValueError("token usage breakdown must be an object")
    result = {}
    for wire_name, name in _COUNTERS.items():
        count = value.get(wire_name)
        if type(count) is not int or count < 0:
            raise ValueError(f"missing or invalid token counter: {wire_name}")
        result[name] = count
    write = value.get("cacheWriteInputTokens")
    if write is not None and (type(write) is not int or write < 0):
        raise ValueError("invalid token counter: cacheWriteInputTokens")
    result["cache_write_input_tokens"] = write
    if result["total_tokens"] != result["input_tokens"] + result["output_tokens"]:
        raise ValueError("totalTokens disagrees with inputTokens + outputTokens")
    if (result["cached_input_tokens"] > result["input_tokens"]
            or result["reasoning_output_tokens"] > result["output_tokens"]
            or write is not None and write > result["input_tokens"]):
        raise ValueError("cached/reasoning/write tokens exceed their containing category")
    return result


def _notification(event):
    # Current App Server envelopes omit jsonrpc; an explicit version must be 2.0.
    if not isinstance(event, dict) or event.get("jsonrpc", "2.0") != "2.0":
        raise ValueError("expected an App Server JSONL object")
    method = event.get("method")
    if method is not None and not isinstance(method, str):
        raise ValueError("invalid JSON-RPC method")
    if method not in _METHODS:
        return None
    if "id" in event or not isinstance(event.get("params"), dict):
        raise ValueError(f"invalid {method} notification")
    params = event["params"]
    if not isinstance(params.get("threadId"), str) or not params["threadId"]:
        raise ValueError(f"missing thread identity in {method}")
    if method == "thread/tokenUsage/updated":
        turn = params.get("turnId")
    else:
        turn_data = params.get("turn")
        turn = turn_data.get("id") if isinstance(turn_data, dict) else None
    if not isinstance(turn, str) or not turn:
        raise ValueError(f"missing turn identity in {method}")
    return method, params, turn


def usage_from_app_server_events(data: bytes, *, thread_id: str, turn_id: str,
                                 exit_code: int) -> dict:
    """Preserve bound observations; never promote thread counters into turn spending.

    Capture must begin before ``turn/start`` and include the terminal notification.
    The caller owns process launch, provenance and any later pre-turn baseline proof.
    """
    if not isinstance(data, bytes) or not isinstance(thread_id, str) or not thread_id or not isinstance(turn_id, str) or not turn_id or type(exit_code) is not int:
        raise ValueError("bytes, thread ID, turn ID and integer exit code required")
    try:
        events = [json.loads(line, object_pairs_hook=_no_duplicates)
                  for line in data.decode("utf-8").splitlines() if line.strip()]
    except UnicodeError as error:
        raise ValueError("invalid UTF-8 App Server stream") from error
    started = False
    terminal = None
    last = total = None
    for event in events:
        notification = _notification(event)
        if notification is None:
            continue
        method, params, turn = notification
        if params["threadId"] != thread_id or turn != turn_id:
            continue
        if terminal is not None:
            raise ValueError("target turn activity after terminal notification")
        if method == "turn/started":
            if started or params["turn"].get("status") != "inProgress":
                raise ValueError("duplicate or invalid turn start")
            started = True
        elif method == "thread/tokenUsage/updated":
            if not started:
                raise ValueError("target usage before turn start")
            token_usage = params.get("tokenUsage")
            if not isinstance(token_usage, dict):
                raise ValueError("missing tokenUsage object")
            next_last = _breakdown(token_usage.get("last"))
            next_total = _breakdown(token_usage.get("total"))
            for name in _COUNTERS.values():
                if next_last[name] > next_total[name]:
                    raise ValueError("last usage exceeds thread total")
                if total is not None and next_total[name] < total[name]:
                    raise ValueError("thread cumulative usage decreased")
            write_last = next_last["cache_write_input_tokens"]
            write_total = next_total["cache_write_input_tokens"]
            if write_last is not None and write_total is not None and write_last > write_total:
                raise ValueError("last cache-write usage exceeds thread total")
            if (total is not None and write_total is not None
                    and total["cache_write_input_tokens"] is not None
                    and write_total < total["cache_write_input_tokens"]):
                raise ValueError("thread cumulative cache-write usage decreased")
            last, total = next_last, next_total
        else:
            if not started:
                raise ValueError("target terminal before turn start")
            status = params["turn"].get("status")
            if not isinstance(status, str) or status not in _TERMINAL:
                raise ValueError("invalid terminal turn status")
            terminal = status
    issues = []
    if not started:
        issues.append("target turn start was not observed")
    if terminal is None:
        issues.append("terminal turn notification is missing")
    if total is None:
        issues.append("usage notification bound to requested thread and turn is missing")
    if terminal in ("interrupted", "failed") and total is not None:
        issues.append("terminal usage is unconfirmed for interrupted or failed turn")
    if total is not None:
        issues.append("per-turn usage requires a verified pre-turn thread baseline")
        issues.append("thread telemetry does not establish descendant usage")
    if exit_code != 0:
        issues.append("App Server process exited unsuccessfully")
    return {**RECEIPT_CONTRACT, "thread_id": thread_id, "turn_id": turn_id,
            "source_sha256": hashlib.sha256(data).hexdigest(), "exit_code": exit_code,
            "terminal_status": terminal,
            "process_ok": bool(started and terminal == "completed" and exit_code == 0),
            "observed_last": last, "observed_thread_total": total,
            "usage_observed": total is not None,
            "token_categories": None, "total_tokens": None,
            "estimated_usd": None, "billed_usd": None,
            "usage_complete": False, "issues": issues}
