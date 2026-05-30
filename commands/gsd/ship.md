---
name: gsd:ship
description: Create PR, run review, and prepare for merge after verification passes
argument-hint: "[phase number or milestone, e.g., '4' or 'v1.0']"
allowed-tools:
  - Read
  - Bash
  - Grep
  - Glob
  - Write
  - AskUserQuestion
requires: [review, verify-work]
---
<objective>
Bridge local completion → merged PR. After /gsd:verify-work passes, ship the work: push branch, create PR with auto-generated body, optionally trigger review, and track the merge.

Closes the plan → execute → verify → ship loop.
</objective>

<context>
Phase/milestone: $ARGUMENTS (optional)
</context>

<process>
Call the gsd-guardian MCP tool `gsd_workflow` with:
- workflow: "ship"
- args: '{}'

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
