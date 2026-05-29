---
name: gsd-verify-work
description: |
  Validate built features through conversational testing with persistent state.
  Creates UAT.md that tracks test progress, survives context resets, and feeds gaps
  into /gsd:plan-phase --gaps. User tests, Claude records. One test at a time.
  Spawns gsd-planner and gsd-plan-checker subagents for gap closure when issues are found.
allowed-tools: view_file run_command call_mcp_tool invoke_subagent define_subagent send_message ask_question grep_search list_dir write_to_file replace_file_content multi_replace_file_content schedule manage_subagents manage_task
metadata:
  author: opengsd
  version: "2.0.0-antigravity"
  runtime: antigravity
  pipeline_position: 6
  next_workflow: gsd-ship
---

> [!CAUTION]
> **ANTIGRAVITY ENFORCEMENT ACTIVE**
> This skill runs under hard enforcement rules. Read the runtime reference
> FIRST, then follow this workflow EXACTLY. Do not improvise, do not inline
> subagent work, do not use raw gsd-tools.cjs.

## Required Reading — MANDATORY FIRST STEP

Before ANY other action, read these files using `view_file`:

1. `get-shit-done/references/antigravity-runtime.md` — Tool mapping and enforcement rules
2. `get-shit-done/references/universal-anti-patterns.md` — What to never do
3. `get-shit-done/references/context-budget.md` — Context management rules

> [!CAUTION]
> **ENFORCEMENT CHECKPOINT:** After reading the above files, run:
> ```bash
> bash get-shit-done/scripts/enforce-file-read.sh "antigravity-runtime.md"
> ```
> Proceed ONLY if exit code is 0.

## Initialization

Initialize via MCP:

```
call_mcp_tool(
  ServerName: "gsd-guardian",
  ToolName: "init_verify_work",
  Arguments: { phase: "<phase_number>" }
)
```

Parse JSON for: `planner_model`, `checker_model`, `commit_docs`, `phase_found`,
`phase_dir`, `phase_number`, `phase_name`, `has_verification`, `uat_path`.

Load agent skills:

```
call_mcp_tool("gsd-guardian", "agent_skills", {agent_type: "gsd-planner"})
call_mcp_tool("gsd-guardian", "agent_skills", {agent_type: "gsd-plan-checker"})
```

Resolve MVP mode:
```
call_mcp_tool(
  ServerName: "gsd-guardian",
  ToolName: "phase_mvp_mode",
  Arguments: { phase: "${phase_number}" }
)
```

### Define Agent Types

Register agent types needed for gap closure. Read agent definition files
and pass contents as system prompts:

```
# Read agent definitions
view_file("agents/gsd-planner.md")
view_file("agents/gsd-plan-checker.md")

# Define agent types (once per conversation)
define_subagent(
  name: "gsd-planner",
  description: "Creates detailed plans from phase scope",
  system_prompt: <contents of agents/gsd-planner.md>,
  enable_write_tools: true,
  enable_mcp_tools: true
)

define_subagent(
  name: "gsd-plan-checker",
  description: "Reviews plan quality before execution",
  system_prompt: <contents of agents/gsd-plan-checker.md>,
  enable_write_tools: true,
  enable_mcp_tools: true
)
```

## Process

Follow the workflow in `get-shit-done/workflows/verify-work.md` with these Antigravity adaptations:

### Step 1: Check Active Sessions

```
run_command(CommandLine: "find .planning/phases -name '*-UAT.md' -type f 2>/dev/null || true", Cwd: "<project_path>")
```

**If active sessions exist AND no phase argument provided:**

Display table of active sessions. Wait for user to type a number (resume) or phase number (new).

**If active sessions exist AND phase argument provided:**

Check if session exists for that phase. If yes:
```
ask_question(
  questions: [{
    question: "Phase {X} already has a UAT session. Resume or restart?",
    is_multi_select: false,
    options: [
      "Resume — continue from last checkpoint",
      "Restart — delete existing and start fresh"
    ]
  }]
)
```

### Step 2: Automated UI Verification (Conditional)

Check for Playwright-MCP tools availability and UI-SPEC:

```
call_mcp_tool("gsd-guardian", "config_get", {key: "workflow.ui_phase"})
```

```
run_command(CommandLine: "ls \"${PHASE_DIR}\"/*-UI-SPEC.md 2>/dev/null | head -1", Cwd: "<project_path>")
```

If Playwright-MCP available and UI phase: auto-verify UI checkpoints,
flag subjective items for manual review.

### Step 3: Find Summaries

```
run_command(CommandLine: "ls \"$phase_dir\"/*-SUMMARY.md 2>/dev/null || true", Cwd: "<project_path>")
```

Read each SUMMARY.md with `view_file` to extract testable deliverables.

### Step 4: Extract Tests

**If MVP_MODE is true:** Follow MVP UAT framing rules:
- User-flow steps first (one user action each)
- Technical checks deferred until user flow passes
- If user-flow fails, verdict is FAIL

Validate user-story format:
```
call_mcp_tool(
  ServerName: "gsd-guardian",
  ToolName: "user_story_validate",
  Arguments: { story: "${PHASE_GOAL}" }
)
```

Parse SUMMARY.md for testable deliverables:
1. **Accomplishments** — features/functionality added
2. **User-facing changes** — UI, workflows, interactions

Focus on USER-OBSERVABLE outcomes, not implementation details.

**Cold-start smoke test injection:** If SUMMARY files reference server/DB/startup files,
prepend "Cold Start Smoke Test" to test list.

### Step 5: Create UAT File

```
run_command(CommandLine: "mkdir -p \"$PHASE_DIR\"", Cwd: "<project_path>")
```

Write UAT.md using `write_to_file`:
```
write_to_file(
  TargetFile: "${phase_dir}/${padded_phase}-UAT.md",
  CodeContent: <UAT template with all tests>
)
```

### Step 6: Present Test

Render checkpoint:
```
call_mcp_tool(
  ServerName: "gsd-guardian",
  ToolName: "uat_render_checkpoint",
  Arguments: { file: "${uat_path}" }
)
```

Display the checkpoint EXACTLY as returned. Do NOT add commentary.

Wait for user response (plain text, no `ask_question` for test responses).

### Step 7: Process Response

**Pass indicators:** empty, "yes", "y", "ok", "pass", "next", "approved", "✓"
**Skip indicators:** "skip", "can't test", "n/a"
**Blocked indicators:** "blocked", "server", "not running", "physical device"
**Anything else:** Treat as issue description. Infer severity:
- crash/error/exception/fails/broken → blocker
- doesn't work/wrong/missing/can't → major
- slow/weird/off/minor → minor
- color/font/spacing/alignment → cosmetic
- Default: major

Update UAT.md via `replace_file_content`. Update Summary counts and timestamp.

If more tests remain → present next test.
If no more tests → go to completion.

### Step 8: Complete Session

Determine final status: `complete` (all tests resolved) or `partial` (pending/blocked remain).

Commit UAT file:
```
call_mcp_tool(
  ServerName: "gsd-guardian",
  ToolName: "commit",
  Arguments: {
    message: "test(${padded_phase}): complete UAT - {passed} passed, {issues} issues",
    files: ["${phase_dir}/${padded_phase}-UAT.md"]
  }
)
```

**If issues > 0:** Proceed to diagnosis and gap closure.

**If issues == 0:** Check security enforcement:
```
call_mcp_tool("gsd-guardian", "config_get", {key: "workflow.security_enforcement"})
```

```
run_command(CommandLine: "ls \"${PHASE_DIR}\"/*-SECURITY.md 2>/dev/null | head -1", Cwd: "<project_path>")
```

If all tests passed and security cleared:
- Auto-transition: read and follow `get-shit-done/workflows/transition.md`
- Present next-step options

### Step 9: Scan Phase Artifacts

```
call_mcp_tool(
  ServerName: "gsd-guardian",
  ToolName: "audit_open",
  Arguments: {}
)
```

For current phase only, surface open items (UAT incomplete, VERIFICATION gaps, open questions).

### Step 10: Diagnose Issues

Follow `get-shit-done/workflows/diagnose-issues.md`:
- Spawn parallel debug agents for each issue
- Collect root causes
- Update UAT.md with root causes

### Step 11: Plan Gap Closure — MUST SPAWN SUBAGENT

> [!CAUTION]
> **ENFORCEMENT: SUBAGENT SPAWN MANDATORY**
> Gap closure REQUIRES spawning a `gsd-planner` subagent.
> Do NOT create fix plans inline.

```
invoke_subagent(
  Subagents: [{
    TypeName: "gsd-planner",
    Role: "Gap Closure Planner Phase {X}",
    Prompt: "<planning_context>\n\n**Phase:** {phase_number}\n**Mode:** gap_closure\n\n<files_to_read>\n- {phase_dir}/{padded_phase}-UAT.md (UAT with diagnoses)\n- .planning/STATE.md\n- .planning/ROADMAP.md\n</files_to_read>\n\n{AGENT_SKILLS_PLANNER}\n\n</planning_context>\n\n<downstream_consumer>\nOutput consumed by /gsd:execute-phase\nPlans must be executable prompts.\n</downstream_consumer>",
    Workspace: "inherit"
  }]
)
```

**WAIT for planner to complete.** Do NOT proceed until notified.

> [!CAUTION]
> **ENFORCEMENT CHECKPOINT:** After planner completes, run:
> ```bash
> bash get-shit-done/scripts/enforce-subagent-spawn.sh "gsd-planner"
> ```

### Step 12: Verify Gap Plans — MUST SPAWN SUBAGENT

> [!CAUTION]
> **ENFORCEMENT: SUBAGENT SPAWN MANDATORY**
> Plan verification REQUIRES spawning a `gsd-plan-checker` subagent.

Initialize `iteration_count = 1`.

```
invoke_subagent(
  Subagents: [{
    TypeName: "gsd-plan-checker",
    Role: "Gap Plan Checker Phase {X}",
    Prompt: "<verification_context>\n\n**Phase:** {phase_number}\n**Phase Goal:** Close diagnosed gaps from UAT\n\n<files_to_read>\n- {phase_dir}/*-PLAN.md\n</files_to_read>\n\n{AGENT_SKILLS_CHECKER}\n\n</verification_context>\n\n<expected_output>\n- ## VERIFICATION PASSED — all checks pass\n- ## ISSUES FOUND — structured issue list\n</expected_output>",
    Workspace: "inherit"
  }]
)
```

**WAIT for checker to complete.**

> [!CAUTION]
> **ENFORCEMENT CHECKPOINT:** After plan checker completes, run:
> ```bash
> bash get-shit-done/scripts/enforce-subagent-spawn.sh "gsd-plan-checker"
> ```

### Step 13: Revision Loop (Max 3 Iterations)

**If VERIFICATION PASSED:** Proceed to present ready.

**If ISSUES FOUND and iteration_count < 3:**

Spawn planner with revision context:
```
invoke_subagent(
  Subagents: [{
    TypeName: "gsd-planner",
    Role: "Gap Plan Reviser Phase {X} (iteration {N}/3)",
    Prompt: "<revision_context>\n**Phase:** {phase_number}\n**Mode:** revision\n\n<files_to_read>\n- {phase_dir}/*-PLAN.md\n</files_to_read>\n\n{AGENT_SKILLS_PLANNER}\n\n**Checker issues:** {structured_issues}\n</revision_context>\n\n<instructions>\nMake targeted updates. Do NOT replan from scratch unless fundamental.\n</instructions>",
    Workspace: "inherit"
  }]
)
```

After planner returns → spawn checker again, increment `iteration_count`.

**If iteration_count >= 3:**
```
ask_question(
  questions: [{
    question: "Max iterations reached. {N} issues remain.",
    is_multi_select: false,
    options: [
      "Force proceed — execute despite issues",
      "Provide guidance — give direction, retry",
      "Abandon — exit, run /gsd:plan-phase manually"
    ]
  }]
)
```

### Step 14: Present Ready

Display gap closure summary table and direct user to:
`/gsd:execute-phase {phase} --gaps-only`

## gsd_run → call_mcp_tool Mapping

| Original gsd_run command | Antigravity call_mcp_tool |
|---|---|
| `gsd_run query init.verify-work "${PHASE}"` | `call_mcp_tool("gsd-guardian", "init_verify_work", {phase: "${PHASE}"})` |
| `gsd_run query agent-skills gsd-planner` | `call_mcp_tool("gsd-guardian", "agent_skills", {agent_type: "gsd-planner"})` |
| `gsd_run query agent-skills gsd-plan-checker` | `call_mcp_tool("gsd-guardian", "agent_skills", {agent_type: "gsd-plan-checker"})` |
| `gsd_run query phase.mvp-mode "${phase}" --pick active` | `call_mcp_tool("gsd-guardian", "phase_mvp_mode", {phase: "${phase}"})` |
| `gsd_run query roadmap.get-phase "${phase}" --pick goal` | `call_mcp_tool("gsd-guardian", "roadmap_get_phase", {phase: "${phase}", pick: "goal"})` |
| `gsd_run query user-story.validate --story "..." --pick valid` | `call_mcp_tool("gsd-guardian", "user_story_validate", {story: "..."})` |
| `gsd_run query uat.render-checkpoint --file "$uat_path"` | `call_mcp_tool("gsd-guardian", "uat_render_checkpoint", {file: "$uat_path"})` |
| `gsd_run query config-get workflow.ui_phase` | `call_mcp_tool("gsd-guardian", "config_get", {key: "workflow.ui_phase"})` |
| `gsd_run query config-get workflow.security_enforcement` | `call_mcp_tool("gsd-guardian", "config_get", {key: "workflow.security_enforcement"})` |
| `gsd_run query audit-open --json` | `call_mcp_tool("gsd-guardian", "audit_open", {})` |
| `gsd_run query commit "msg" --files ...` | `call_mcp_tool("gsd-guardian", "commit", {message: "msg", files: [...]})` |
| `gsd_run query state.update key value` | `call_mcp_tool("gsd-guardian", "state_update", {key: "...", value: "..."})` |

## Enforcement Summary

| Checkpoint | What it verifies | When to run |
|---|---|---|
| `enforce-file-read.sh "antigravity-runtime.md"` | Runtime reference was read | After step 0 |
| `enforce-subagent-spawn.sh "gsd-planner"` | Planner was spawned for gap closure | After step 11 |
| `enforce-subagent-spawn.sh "gsd-plan-checker"` | Plan checker was spawned | After step 12 |
| `enforce-mcp-usage.sh "init_verify_work"` | MCP server used (not raw CLI) | After initialization |

## Success Criteria

- [ ] UAT file created with all tests from SUMMARY.md
- [ ] Tests presented one at a time with expected behavior
- [ ] User responses processed as pass/issue/skip (via plain text, not `ask_question`)
- [ ] Severity inferred from description (never asked)
- [ ] Batched writes: on issue, every 5 passes, or completion
- [ ] Committed on completion — **via MCP**
- [ ] If issues: parallel debug agents diagnose root causes
- [ ] If issues: `gsd-planner` spawned for gap closure — **verified by enforcement**
- [ ] If issues: `gsd-plan-checker` spawned to verify fix plans — **verified by enforcement**
- [ ] If issues: revision loop until plans pass (max 3 iterations)
- [ ] Ready for `/gsd:execute-phase --gaps-only` when complete
- [ ] Phase auto-transitions to complete if all tests pass and security cleared
- [ ] User directed to `gsd-ship` as next step
