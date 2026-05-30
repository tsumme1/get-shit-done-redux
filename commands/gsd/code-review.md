---
name: gsd:code-review
description: Review source files changed during a phase for bugs, security issues, and code quality problems
argument-hint: "<phase-number> [--depth=quick|standard|deep] [--files file1,file2,...] [--fix [--all] [--auto]]"
allowed-tools:
  - Read
  - Bash
  - Glob
  - Grep
  - Write
  - Agent
requires: [config, import, phase, quick, review]
---
<objective>
Review source files changed during a phase for bugs, security vulnerabilities, and code quality problems.

Spawns the gsd-code-reviewer agent to analyze code at the specified depth level. Produces REVIEW.md artifact in the phase directory with severity-classified findings.

Arguments:
- Phase number (required) — which phase's changes to review (e.g., "2" or "02")
- `--depth=quick|standard|deep` (optional) — review depth level, overrides workflow.code_review_depth config
  - quick: Pattern-matching only (~2 min)
  - standard: Per-file analysis with language-specific checks (~5-15 min, default)
  - deep: Cross-file analysis including import graphs and call chains (~15-30 min)
- `--files file1,file2,...` (optional) — explicit comma-separated file list, skips SUMMARY/git scoping (highest precedence for scoping)
- `--fix` (optional) — after review completes (or if REVIEW.md already exists), auto-apply fixes found. Spawns gsd-code-fixer agent. Accepts sub-flags:
  - `--all` — include Info findings in fix scope (default: Critical + Warning only)
  - `--auto` — enable fix + re-review iteration loop, capped at 3 iterations

Output: {padded_phase}-REVIEW.md in phase directory + inline summary of findings
</objective>

<context>
Phase: $ARGUMENTS (first positional argument is phase number)

Optional flags parsed from $ARGUMENTS:
- `--depth=VALUE` — Depth override (quick|standard|deep). If provided, overrides workflow.code_review_depth config.
- `--files=file1,file2,...` — Explicit file list override. Has highest precedence for file scoping per D-08. When provided, workflow skips SUMMARY.md extraction and git diff fallback entirely.

Context files (CLAUDE.md, SUMMARY.md, phase state) are resolved inside the workflow via `gsd-tools query init.phase-op` and delegated to agent via `<files_to_read>` blocks.
</context>

<process>
Extract the phase number from $ARGUMENTS. Then call the gsd-guardian MCP tool `gsd_workflow` with:
- workflow: "code-review"
- args: '{"phase": "<phase_number>"}'

The server returns stages one at a time. For each stage:
1. Read the stage `instructions` and execute them using the tools listed in `hints`
2. When instructions say "Call the gsd-guardian MCP tool 'X'", use `call_mcp_tool(ServerName: "gsd-guardian", ToolName: "X", ...)`
3. When instructions reference agent tools (view_file, run_command, write_to_file, invoke_subagent), use those directly
4. When instructions say to ask the user, use ask_question
5. Collect all `required_outputs` specified in the stage
6. Call `gsd_workflow` again with the `session_id` and your `stage_outputs` as a JSON string

Repeat until the server returns `nextStageNeeded: false`.

**CRITICAL:** You MUST keep calling gsd_workflow until completion. Do not stop mid-workflow. Each stage depends on the previous stage's outputs. If a stage fails, report the error in stage_outputs and let the server decide the next action.
</process>
