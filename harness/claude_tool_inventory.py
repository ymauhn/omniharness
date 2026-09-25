"""Fail-closed inspection of Claude Code's effective tool inventory.

This checks one observed system/init event. It does not configure the CLI,
intercept tool calls, or prove that a tool ran inside a worker container.
"""
import json


def _unique_json(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("duplicate JSON key")
        result[key] = value
    return result


def inspect_init(stream, *, session_id, expected_tools, server_name):
    """Require an exact first-event inventory for one fresh Claude session."""
    if not isinstance(session_id, str) or not session_id:
        raise ValueError("session_id is required")
    if not isinstance(server_name, str) or not server_name:
        raise ValueError("server_name is required")
    if not isinstance(expected_tools, (set, frozenset)) or any(
        not isinstance(tool, str) or not tool for tool in expected_tools
    ):
        raise ValueError("expected_tools must be an explicit set of names")
    if not isinstance(stream, bytes):
        raise ValueError("captured stream must be bytes")
    issues = []
    try:
        first = next(line for line in stream.decode("utf-8").splitlines() if line.strip())
        event = json.loads(first, object_pairs_hook=_unique_json)
    except (UnicodeError, ValueError, StopIteration):
        event = None
    if not isinstance(event, dict) or event.get("type") != "system" or event.get("subtype") != "init":
        return {"verified": False, "issues": ["first event is not a valid system/init"]}
    if event.get("session_id") != session_id:
        issues.append("session identity differs")
    tools = event.get("tools")
    if (not isinstance(tools, list) or any(not isinstance(name, str) for name in tools)
            or len(tools) != len(set(tools)) or set(tools) != expected_tools):
        issues.append("effective tools differ from reviewed inventory")
    servers = event.get("mcp_servers")
    if (not isinstance(servers, list) or len(servers) != 1
            or not isinstance(servers[0], dict)
            or servers[0].get("name") != server_name
            or servers[0].get("status") != "connected"):
        issues.append("exact connected MCP server was not observed")
    for field in ("mcp_server_errors", "plugin_errors", "plugins"):
        if event.get(field, []) != []:
            issues.append(f"unexpected {field} in session startup")
    return {"verified": not issues, "issues": issues}
