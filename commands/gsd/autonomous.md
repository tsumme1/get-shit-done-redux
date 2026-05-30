---
name: gsd:autonomous
description: Run all remaining phases autonomously — discuss→plan→execute per phase
argument-hint: "[--from N] [--to N] [--only N] [--interactive]"
allowed-tools:
  - Read
  - Write
  - Bash
  - Glob
  - Grep
  - AskUserQuestion
  - Agent
requires: [cleanup, phase, progress]
---
<objective>
Execute all remaining milestone phases autonomously. For each phase: discuss → plan → execute. Pauses only for user decisions (grey area acceptance, blockers, validation requests).

Uses ROADMAP.md phase discovery and Skill() flat invocations for each phase command. After all phases complete: milestone audit → complete → cleanup.

**Creates/Updates:**
- `.planning/STATE.md` — updated after each phase
- `.planning/ROADMAP.md` — progress updated after each phase
- Phase artifacts — CONTEXT.md, PLANs, SUMMARYs per phase

**After:** Milestone is complete and cleaned up.
</objective>

<context>
Optional flags:
- `--from N` — start from phase N instead of the first incomplete phase.
- `--to N` — stop after phase N completes (halt instead of advancing to next phase).
- `--only N` — execute only phase N (single-phase mode).
- `--interactive` — run discuss inline with questions (not auto-answered), then dispatch plan→execute as background agents. Keeps the main context lean while preserving user input on decisions.

Project context, phase list, and state are resolved inside the workflow using init commands (`gsd-tools query init.milestone-op`, `gsd-tools query roadmap.analyze`). No upfront context loading needed.
</context>

<process>
Extract optional flags (--from, --to, --only) from $ARGUMENTS. Then call the gsd-guardian MCP tool `gsd_workflow` with:
- workflow: "autonomous"
- args: '{"from": "<from_value>", "to": "<to_value>", "only": "<only_value>"}'

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
