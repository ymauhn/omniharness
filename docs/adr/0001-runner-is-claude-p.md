# ADR 0001: the benchmark runner is headless `claude -p`, bounded by dollars

Date: 2026-09-10. Status: accepted.

## Context

Claude Code 2.1.267 ships `claude plugin eval` with graders and thresholds, but on this account the command is early-access gated: `claude plugin eval init --bare smoke` prints the notice and exits 1 creating nothing, and `claude plugin eval .` prints the notice and exits 0 having run nothing. A benchmark built on it would pass without running. `claude --help` confirms `-p` with `--output-format json|stream-json`, `--json-schema`, `--max-budget-usd`, `--permission-mode`, `--setting-sources` and `--strict-mcp-config`; `--max-turns` is absent from this build's help. `--bare` needs an API key and is unusable under subscription authentication.

## Decision

`evals/run.py` drives every paid benchmark through `claude -p` with `--output-format stream-json`, `--max-budget-usd` as the only hard bound, stdout written to a file (a hung child holds a Windows pipe open forever), a process-tree kill on timeout, and utf-8 everywhere. Empty or unparseable output is a failure, never a pass. Zero-token checks live in `tests/` and run before any paid arm.

## Consequences

Cases keep a `prompt.md` so a `graders/` directory can be added if `claude plugin eval` leaves early access. Turn counts are observed, not enforced. Re-check the command after CLI updates; the memory note `claude-plugin-eval-early-access` records the probe.
