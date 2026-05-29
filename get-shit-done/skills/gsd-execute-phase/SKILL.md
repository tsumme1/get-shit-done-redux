---
name: gsd-execute-phase
description: |
  Execute all plans in a phase using wave-based parallel execution. Orchestrator stays lean —
  delegates plan execution to gsd-executor subagents, then verifies with gsd-verifier.
  Use when the user wants to execute a phase, says "execute phase", or invokes /gsd:execute-phase.
  This is the most enforcement-critical workflow. It MUST spawn subagents for every plan
  execution — the orchestrator coordinates, never executes plan work inline (except --interactive mode).
  Uses worktree isolation for parallel execution.
allowed-tools: view_file run_command call_mcp_tool invoke_subagent define_subagent send_message ask_question grep_search list_dir write_to_file replace_file_content multi_replace_file_content schedule manage_subagents manage_task
metadata:
  author: opengsd
  version: "2.0.0-antigravity"
  runtime: antigravity
  pipeline_position: 5
  next_workflow: gsd-verify-work
---

> [!CAUTION]
> **ANTIGRAVITY ENFORCEMENT ACTIVE — MAXIMUM STRICTNESS**
> This is the most enforcement-critical GSD workflow. The orchestrator MUST
> spawn `gsd-executor` subagents for every plan. NEVER execute plan tasks inline.
> NEVER bypass worktree isolation. NEVER use raw gsd-tools.cjs.
> Read the runtime reference FIRST, then follow this workflow EXACTLY.

## Required Reading — MANDATORY FIRST STEP

Before ANY other action, read these files using `view_file`:

1. `get-shit-done/references/antigravity-runtime.md` — Tool mapping and enforcement rules
2. `get-shit-done/references/universal-anti-patterns.md` — What to never do
3. `get-shit-done/references/context-budget.md` — Context management rules
4. `get-shit-done/references/agent-contracts.md` — Agent return contracts
5. `get-shit-done/references/gates.md` — Quality gate definitions

> [!CAUTION]
> **ENFORCEMENT CHECKPOINT:** After reading the above files, run:
> ```bash
> bash get-shit-done/scripts/enforce-file-read.sh "antigravity-runtime.md"
> ```
> Proceed ONLY if exit code is 0.

## Core Principle

> **Orchestrator coordinates, not executes.** Each subagent loads the full execute-plan
> context. Orchestrator: discover plans → analyze deps → group waves → spawn agents →
> handle checkpoints → collect results.

## Initialization

### Parse Arguments

Parse `$ARGUMENTS` before loading any context:
- First positional token → `PHASE_ARG`
- Optional `--wave N` → `WAVE_FILTER`
- Optional `--gaps-only` → filter to gap_closure plans only
- Optional `--interactive` → inline sequential mode (see below)
- Optional `--cross-ai` → force all plans through cross-AI execution
- Optional `--no-cross-ai` → disable cross-AI for this run
- Optional `--auto` → enable auto-advance chain
- Optional `--no-transition` → skip transition after completion

### Load Context via MCP

```
call_mcp_tool(
  ServerName: "gsd-guardian",
  ToolName: "init_execute_phase",
  Arguments: { "phase": "<PHASE_ARG>" }
)
```

Parse JSON for: `executor_model`, `verifier_model`, `commit_docs`, `parallelization`,
`branching_strategy`, `branch_name`, `phase_found`, `phase_dir`, `phase_number`,
`phase_name`, `phase_slug`, `plans`, `incomplete_plans`, `plan_count`, `incomplete_count`,
`state_exists`, `roadmap_exists`, `phase_req_ids`, `response_language`.

**If `phase_found` is false:** Error — phase directory not found.
**If `plan_count` is 0:** Error — no plans found in phase.

### Load Runtime Config

```
call_mcp_tool(ServerName: "gsd-guardian", ToolName: "config_get", Arguments: { "key": "runtime" })
call_mcp_tool(ServerName: "gsd-guardian", ToolName: "config_get", Arguments: { "key": "workflow.use_worktrees" })
call_mcp_tool(ServerName: "gsd-guardian", ToolName: "config_get", Arguments: { "key": "context_window" })
```

### Resolve MVP and TDD Modes

```
call_mcp_tool(
  ServerName: "gsd-guardian",
  ToolName: "phase_mvp_mode",
  Arguments: { "phase": "<PHASE_NUMBER>" }
)
call_mcp_tool(ServerName: "gsd-guardian", ToolName: "config_get", Arguments: { "key": "workflow.tdd_mode" })
```

### Sync Auto-Chain Flag

If user invoked manually (no `--auto`), clear the ephemeral chain flag:
```
call_mcp_tool(
  ServerName: "gsd-guardian",
  ToolName: "config_set",
  Arguments: { "key": "workflow._auto_chain_active", "value": "false" }
)
```

### Define Agent Types

Register all agent types needed by this workflow:

```
# Read agent definitions
view_file("agents/gsd-executor.md")
view_file("agents/gsd-verifier.md")

# Define agent types (once per conversation)
define_subagent(
  name: "gsd-executor",
  description: "Executes plan tasks, commits atomically, creates SUMMARY.md",
  system_prompt: <contents of agents/gsd-executor.md>,
  enable_write_tools: true,
  enable_mcp_tools: true
)

define_subagent(
  name: "gsd-verifier",
  description: "Verifies phase completion, checks quality gates, creates VERIFICATION.md",
  system_prompt: <contents of agents/gsd-verifier.md>,
  enable_write_tools: true,
  enable_mcp_tools: true
)
```

### Safe Resume Gate

Before dispatching any executor, verify STATE.md consistency:
```
run_command(
  CommandLine: "git log --oneline --grep='<CURRENT_PLAN_ID>' -30",
  Cwd: "<project_path>"
)
```

If production commits exist but SUMMARY.md is missing, stop and offer recovery options
(close out manually, re-execute from scratch, mark-and-skip).

### Check Blocking Anti-Patterns

```
run_command(
  CommandLine: "ls <phase_dir>/.continue-here.md 2>/dev/null || true",
  Cwd: "<project_path>"
)
```

If `.continue-here.md` exists, parse for blocking anti-patterns and address each one before proceeding.

## Interactive Mode (--interactive)

If `--interactive` flag present: execute plans sequentially **inline** (no subagent spawning)
with user checkpoints between tasks.

For each plan (sequentially):
```
ask_question(
  questions: [
    {
      question: "Plan {plan_id}: {plan_name} — {task_count} tasks. How to proceed?",
      is_multi_select: false,
      options: [
        "Execute — proceed with all tasks",
        "Review first — show task breakdown before starting",
        "Skip — move to next plan",
        "Stop — end execution, save progress"
      ]
    }
  ]
)
```

Read and follow `get-shit-done/workflows/execute-plan.md` **inline** for each executed plan.
After all plans: proceed to verification (same as normal mode).

## Normal Mode — Wave Execution

### Handle Branching

Check `branching_strategy` from init:

**"phase" or "milestone":** Use pre-computed `branch_name`:
```
run_command(
  CommandLine: "git checkout -b <BRANCH_NAME> origin/<DEFAULT_BRANCH> || git switch <BRANCH_NAME>",
  Cwd: "<project_path>"
)
```

### Validate Phase

Update STATE.md for phase start via MCP:
```
call_mcp_tool(
  ServerName: "gsd-guardian",
  ToolName: "state_begin_phase",
  Arguments: { "phase": "<PHASE_NUMBER>", "name": "<PHASE_NAME>", "plans": "<PLAN_COUNT>" }
)
```

### Discover and Group Plans

Load plan inventory with wave grouping:
```
call_mcp_tool(
  ServerName: "gsd-guardian",
  ToolName: "phase_plan_index",
  Arguments: { "phase": "<PHASE_NUMBER>" }
)
```

Parse JSON for: `plans[]` (each with `id`, `wave`, `autonomous`, `objective`, `files_modified`,
`task_count`, `has_summary`), `waves`, `incomplete`, `has_checkpoints`.

**Filtering:** Skip plans where `has_summary: true`. If `--gaps-only`: also skip non-gap_closure plans.
If `WAVE_FILTER` is set: also skip plans whose `wave` does not equal `WAVE_FILTER`.

### Execute Waves — MUST SPAWN SUBAGENTS

> [!CAUTION]
> **ENFORCEMENT: SUBAGENT SPAWN MANDATORY — NO EXCEPTIONS**
> Every plan in every wave MUST be executed by a spawned `gsd-executor` subagent.
> The orchestrator MUST NOT execute plan tasks, write implementation code, run
> tests, or create SUMMARY.md files itself. It coordinates only.
> Violation of this rule produces incorrect worktree isolation and state tracking.

**For each wave, in sequence:**

#### 1. Intra-Wave Overlap Check

Before spawning, check `files_modified` lists of all plans in the wave. If any two plans
share a file, override parallelization to sequential for that wave and warn the user.

#### 2. Describe What's Being Built

Emit checkpoint heartbeat:
```
[checkpoint] phase {PHASE_NUMBER} wave {N}/{M} starting, {wave_plan_count} plan(s), {P}/{Q} plans done
```

Read each plan's objective. Present a human-readable description of what's being built.

#### 3. Spawn Executor Agents — ONE AT A TIME

> [!CAUTION]
> **ENFORCEMENT: SEQUENTIAL DISPATCH FOR PARALLEL EXECUTION**
> Dispatch each `invoke_subagent` call ONE AT A TIME. Do NOT send multiple
> Agent calls in a single message — simultaneous `git worktree add` calls
> race on `.git/config.lock`.

**Worktree mode** (default — `USE_WORKTREES` is not `false`):

```
invoke_subagent(
  Subagents: [{
    TypeName: "gsd-executor",
    Role: "Plan {plan_number} Executor",
    Prompt: "<objective>\nExecute plan {plan_number} of phase {phase_number}-{phase_name}.\nCommit each task atomically. Create SUMMARY.md.\nDo NOT update STATE.md or ROADMAP.md — the orchestrator owns those writes after all worktree agents in the wave complete.\n</objective>\n\n<worktree_branch_check>\nFIRST ACTION: HEAD assertion MUST run before any reset/checkout. If HEAD is on a protected ref (main/master/develop/trunk/release/*) or detached, HALT.\n</worktree_branch_check>\n\n<parallel_execution>\nYou are running as a PARALLEL executor agent in a git worktree.\nIMPORTANT: Do NOT modify STATE.md or ROADMAP.md.\nREQUIRED: SUMMARY.md MUST be committed before you return.\nREQUIRED ORDER: Write SUMMARY.md → commit → only then any narration.\n</parallel_execution>\n\n<execution_context>\n@get-shit-done/workflows/execute-plan.md\n@get-shit-done/templates/summary.md\n@get-shit-done/references/checkpoints.md\n@get-shit-done/references/tdd.md\n@get-shit-done/references/worktree-path-safety.md\n</execution_context>\n\n<files_to_read>\n- {phase_dir}/{plan_file} (Plan)\n- .planning/PROJECT.md (Project context)\n- .planning/STATE.md (State)\n- .planning/config.json (Config)\n- CLAUDE.md (Project instructions, if exists)\n</files_to_read>\n\n<success_criteria>\n- [ ] All tasks executed\n- [ ] Each task committed individually\n- [ ] SUMMARY.md created in plan directory\n- [ ] No modifications to shared orchestrator artifacts\n</success_criteria>",
    Workspace: "branch"
  }]
)
```

**Sequential mode** (when `USE_WORKTREES` is `false` or plan touches submodule):

Same structure but with `Workspace: "inherit"` and success_criteria includes STATE.md/ROADMAP.md updates.

> [!CAUTION]
> **ENFORCEMENT CHECKPOINT:** After each executor returns, verify SUMMARY.md exists:
> ```bash
> bash get-shit-done/scripts/enforce-subagent-spawn.sh "gsd-executor"
> ```

#### 4. Wait for All Agents in Wave

**WAIT for all agents to complete.** Do NOT proceed to next wave until notified.

Emit checkpoint heartbeats as each executor returns:
```
[checkpoint] phase {PHASE_NUMBER} wave {N}/{M} plan {plan_id} complete ({P}/{Q} plans done)
```

**Stall detection:** If no completion signal, no SUMMARY.md, and no commits for configured
threshold (default 10 minutes), present recovery options.

#### 5. Post-Wave Hook Validation (parallel mode only)

Check if `workflow.worktree_skip_hooks` is true and run post-wave hook validation if so.

#### 5.5. Worktree Cleanup (when worktree isolation was used)

Merge worktree changes back to main branch via MCP:
```
call_mcp_tool(
  ServerName: "gsd-guardian",
  ToolName: "worktree_cleanup_wave",
  Arguments: { "manifest": "<WAVE_WORKTREE_MANIFEST>" }
)
```

#### 5.6. Post-Merge Build & Test Gate

After merging all worktrees (parallel) or after last plan completes (serial):

Read and execute `get-shit-done/workflows/execute-phase/steps/post-merge-gate.md`.

This catches cross-plan integration issues that individual worktree self-checks cannot detect.

#### 5.7. Post-Wave Shared Artifact Update

When any executor ran with worktree isolation, update shared artifacts:
```
call_mcp_tool(
  ServerName: "gsd-guardian",
  ToolName: "roadmap_update_plan_progress",
  Arguments: { "phase": "<PHASE_NUMBER>", "plan": "<plan_id>", "status": "complete" }
)
```

Only update tracking when tests passed (TEST_EXIT=0).

```
call_mcp_tool(
  ServerName: "gsd-guardian",
  ToolName: "commit",
  Arguments: {
    "message": "docs(phase-<PHASE_NUMBER>): update tracking after wave <N>",
    "files": [".planning/ROADMAP.md", ".planning/STATE.md"]
  }
)
```

#### 5.8. Handle Test Gate Failures

If post-merge tests fail, present options:
```
ask_question(
  questions: [
    {
      question: "Post-merge tests failed. How to proceed?",
      is_multi_select: false,
      options: [
        "Fix now (recommended) — resolve conflicts before next wave",
        "Continue — failures may compound in subsequent waves"
      ]
    }
  ]
)
```

#### 6. Spot-Check and Report

For each SUMMARY.md:
- Verify first 2 files from `key-files.created` exist on disk
- Check git log returns ≥1 commit for the plan
- Check for `## Self-Check: FAILED` marker

Emit wave-close heartbeat:
```
[checkpoint] phase {PHASE_NUMBER} wave {N}/{M} complete, {P}/{Q} plans done
```

#### 7. Handle Failures

Use MCP failure classifier:
```
call_mcp_tool(
  ServerName: "gsd-guardian",
  ToolName: "agent_classify_failure",
  Arguments: { "body": "<AGENT_RETURN_BODY>" }
)
```

Route by class: `quota-exceeded` → wait for reset, `classify-handoff-bug` → spot-check,
`unknown-failure` → report and ask Continue/Stop.

#### 7b. Pre-Wave Dependency Check (waves 2+)

Before wave N+1, verify prior-wave artifact links for upcoming plans.

#### 8. Handle Checkpoint Plans

Plans with `autonomous: false` require user interaction:

```
ask_question(
  questions: [
    {
      question: "[Checkpoint type]: [Details from agent return]",
      is_multi_select: false,
      options: [
        "Approved — continue execution",
        "[Decision option 1]",
        "[Decision option 2]",
        "Skip this plan",
        "Abort phase execution"
      ]
    }
  ]
)
```

Spawn continuation agent (fresh, NOT resume) with user's response.

#### 9. Proceed to Next Wave

Repeat from step 1 for next wave.

## Post-Execution Gates

### Handle Partial Wave Execution

If `WAVE_FILTER` was used and incomplete plans remain, STOP — do NOT run verification.
Present:
```
/gsd:execute-phase {phase} — Continue remaining waves
/gsd:execute-phase {phase} --wave {next} — Run the next wave explicitly
```

### Code Review Gate (Required, Advisory)

```
call_mcp_tool(
  ServerName: "gsd-guardian",
  ToolName: "config_get",
  Arguments: { "key": "workflow.code_review" }
)
```

If enabled, invoke code review. Non-blocking — never stops execution flow.

### Close Parent Artifacts (decimal/polish phases only)

For phases like `4.1`, `03.1` — resolve parent UAT and debug artifacts.

### Regression Gate

Run prior phases' test suites to catch cross-phase regressions:

```
run_command(
  CommandLine: "find .planning/phases/ -name '*-VERIFICATION.md' ! -path '*<PHASE_NUMBER>*' 2>/dev/null",
  Cwd: "<project_path>"
)
```

If regressions found:
```
ask_question(
  questions: [
    {
      question: "Cross-phase regression detected. How to proceed?",
      is_multi_select: false,
      options: [
        "Fix regressions before verification (recommended)",
        "Continue to verification anyway — regressions will compound",
        "Abort phase — roll back and re-plan"
      ]
    }
  ]
)
```

### Schema Drift Gate

```
call_mcp_tool(
  ServerName: "gsd-guardian",
  ToolName: "verify_schema_drift",
  Arguments: { "phase": "<PHASE_NUMBER>" }
)
```

If drift detected and blocking:
```
ask_question(
  questions: [
    {
      question: "Schema drift detected. How to proceed?",
      is_multi_select: false,
      options: [
        "Run push command now (recommended) — execute the push, then re-verify",
        "Skip schema check — bypass this gate",
        "Abort — stop execution and investigate"
      ]
    }
  ]
)
```

### Codebase Drift Gate

Load and follow `get-shit-done/workflows/execute-phase/steps/codebase-drift-gate.md`.
Non-blocking — any error falls through to verification.

## Phase Verification — MUST SPAWN SUBAGENT

> [!CAUTION]
> **ENFORCEMENT: SUBAGENT SPAWN MANDATORY**
> Phase verification MUST be performed by a spawned `gsd-verifier` subagent.
> Do NOT verify inline. Do NOT skip verification.

```
invoke_subagent(
  Subagents: [{
    TypeName: "gsd-verifier",
    Role: "Phase Verifier",
    Prompt: "Verify phase {phase_number} goal achievement.\nPhase directory: {phase_dir}\nPhase goal: {goal from ROADMAP.md}\nPhase requirement IDs: {phase_req_ids}\nCheck must_haves against actual codebase.\nCross-reference requirement IDs from PLAN frontmatter against REQUIREMENTS.md — every ID MUST be accounted for.\nCreate VERIFICATION.md.\n\n<files_to_read>\n- {phase_dir}/*-PLAN.md (All plans)\n- {phase_dir}/*-SUMMARY.md (All summaries)\n- .planning/REQUIREMENTS.md (Requirement traceability)\n</files_to_read>",
    Workspace: "inherit"
  }]
)
```

**WAIT for verifier to complete.**

> [!CAUTION]
> **ENFORCEMENT CHECKPOINT:** After verifier completes, run:
> ```bash
> bash get-shit-done/scripts/enforce-subagent-spawn.sh "gsd-verifier"
> ```

### Handle Verification Result

| Status | Action |
|--------|--------|
| `passed` | → update_roadmap |
| `human_needed` | Persist HUMAN-UAT.md, present human testing items |
| `gaps_found` | Present gap summary, offer `/gsd:plan-phase {phase} --gaps` |

**If `human_needed`:**
```
ask_question(
  questions: [
    {
      question: "All automated checks passed. {N} items need human testing. Continue?",
      is_multi_select: false,
      options: [
        "Approved — continue to completion",
        "Report issues — need gap closure"
      ]
    }
  ]
)
```

### TDD Review Checkpoint (if TDD mode enabled)

Check TDD gate sequence (RED/GREEN/REFACTOR) for all TDD plans. If MVP+TDD mode,
gate violations are **blocking**.

## Phase Completion

### Update Roadmap

Mark phase complete via MCP:
```
call_mcp_tool(
  ServerName: "gsd-guardian",
  ToolName: "phase_complete",
  Arguments: { "phase": "<PHASE_NUMBER>" }
)
```

Extract: `next_phase`, `next_phase_name`, `is_last_phase`, `warnings`.

Commit completion:
```
call_mcp_tool(
  ServerName: "gsd-guardian",
  ToolName: "commit",
  Arguments: {
    "message": "docs(phase-{X}): complete phase execution",
    "files": [".planning/ROADMAP.md", ".planning/STATE.md", ".planning/REQUIREMENTS.md", "<phase_dir>/*-VERIFICATION.md"]
  }
)
```

### Auto-Copy Learnings (if enabled)

```
call_mcp_tool(ServerName: "gsd-guardian", ToolName: "config_get", Arguments: { "key": "features.global_learnings" })
```

If enabled, copy LEARNINGS.md to global store. Failure must NOT block.

### Close Phase Todos

Auto-close pending todos tagged with `resolves_phase: <current-phase-number>` via `run_command`.

### Update PROJECT.md

Evolve PROJECT.md to reflect phase completion (requirements Active → Validated).
```
call_mcp_tool(
  ServerName: "gsd-guardian",
  ToolName: "commit",
  Arguments: { "message": "docs(phase-{X}): evolve PROJECT.md after phase completion", "files": [".planning/PROJECT.md"] }
)
```

### Offer Next Steps

**If `--no-transition` flag present:** Return `## PHASE COMPLETE` status and STOP.

**If `--auto` flag or `AUTO_MODE` is true:** Auto-advance to transition workflow inline.

**Otherwise:** Present options to the user:

```
## ✓ Phase {X}: {Name} Complete

/gsd:progress — see updated roadmap
/gsd:discuss-phase {next} — start here: discuss next phase before planning  ← recommended
/gsd:plan-phase {next} — plan next phase (skip discuss)
/gsd:execute-phase {next} — execute next phase (skip discuss and plan)
```

## Enforcement Summary

| Checkpoint | What it verifies | When to run |
|---|---|---|
| `enforce-file-read.sh "antigravity-runtime.md"` | Runtime reference was read | After Required Reading |
| `enforce-subagent-spawn.sh "gsd-executor"` | Executor subagent was spawned for each plan | After each wave |
| `enforce-subagent-spawn.sh "gsd-verifier"` | Verifier subagent was spawned | After verification |
| `enforce-mcp-usage.sh "init_execute_phase"` | MCP server used (not raw CLI) | After initialization |
| `enforce-mcp-usage.sh "phase_complete"` | Phase completion via MCP | After update_roadmap |

> [!CAUTION]
> **CRITICAL ENFORCEMENT RULES — ZERO TOLERANCE**
>
> 1. **NEVER execute plan tasks inline.** Every plan MUST go through a spawned `gsd-executor`.
> 2. **NEVER spawn multiple executors in one message.** One `invoke_subagent` per message to avoid `.git/config.lock` races.
> 3. **NEVER skip verification.** Phase verification MUST be performed by a spawned `gsd-verifier`.
> 4. **NEVER update STATE.md/ROADMAP.md from worktree agents.** The orchestrator owns shared artifact writes.
> 5. **ALWAYS wait for all agents in a wave before proceeding.** No speculative execution.
> 6. **ALWAYS emit checkpoint heartbeats.** Required for stream-idle-timeout prevention.

## Success Criteria

- [ ] All plans discovered and grouped into waves → **via MCP `phase_plan_index`**
- [ ] Branching strategy applied (if configured) → **via `run_command`**
- [ ] STATE.md updated for phase start → **via MCP `state_begin_phase`**
- [ ] Every plan executed by a spawned `gsd-executor` subagent → **verified by enforcement script**
- [ ] Executor agents use `Workspace: "branch"` for worktree isolation (default)
- [ ] One executor spawned per message (sequential dispatch for parallel execution)
- [ ] Each executor committed SUMMARY.md before returning
- [ ] Spot-checks verify SUMMARY.md exists and commits are present
- [ ] Worktree cleanup completed after each wave → **via MCP `worktree_cleanup_wave`**
- [ ] Post-merge build & test gate passed after each wave
- [ ] Shared artifact updates (STATE.md, ROADMAP.md) done by orchestrator after worktree merge
- [ ] All wave checkpoint heartbeats emitted
- [ ] Failure classifier used for agent failures → **via MCP `agent_classify_failure`**
- [ ] Checkpoint plans handled with user interaction (via `ask_question`)
- [ ] Code review gate invoked (advisory, non-blocking)
- [ ] Regression gate ran prior phases' tests
- [ ] Schema drift gate checked (if applicable)
- [ ] `gsd-verifier` subagent spawned for phase verification → **verified by enforcement script**
- [ ] VERIFICATION.md created and status checked
- [ ] Phase marked complete → **via MCP `phase_complete`**
- [ ] All commits via MCP `commit` → **verified by enforcement script**
- [ ] PROJECT.md evolved after phase completion
- [ ] Phase todos auto-closed
- [ ] User directed to next step (discuss-phase/plan-phase/execute-phase for next phase)
