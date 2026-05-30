---
name: gsd:discuss-phase
description: Gather phase context through adaptive questioning before planning.
argument-hint: "<phase> [--all] [--auto] [--chain] [--batch] [--analyze] [--text] [--power] [--assumptions]"
allowed-tools:
  - Read
  - Write
  - Bash
  - Glob
  - Grep
  - AskUserQuestion
  - Agent
  - mcp__context7__resolve-library-id
  - mcp__context7__query-docs
requires: [config, phase]
---

<objective>
Extract implementation decisions that downstream agents need — researcher and planner will use CONTEXT.md to know what to investigate and what choices are locked.

**How it works:**
1. Load prior context (PROJECT.md, REQUIREMENTS.md, STATE.md, prior CONTEXT.md files)
2. Scout codebase for reusable assets and patterns
3. Analyze phase — skip gray areas already decided in prior phases
4. Present remaining gray areas — user selects which to discuss
5. Deep-dive each selected area until satisfied
6. Create CONTEXT.md with decisions that guide research and planning

**Output:** `{phase_num}-CONTEXT.md` — decisions clear enough that downstream agents can act without asking the user again
</objective>

<context>
Phase number: $ARGUMENTS (required)

Context files are resolved in-workflow using `init phase-op` and roadmap/state tool calls.
</context>

<process>
Extract the phase number from $ARGUMENTS. Then call the gsd-guardian MCP tool `gsd_workflow` with:
- workflow: "discuss-phase"
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
