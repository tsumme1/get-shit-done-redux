---
name: gsd-discuss-phase
description: |
  Extract implementation decisions for a roadmap phase through structured discussion.
  Use when the user wants to discuss a phase, says "discuss phase", or invokes /gsd:discuss-phase.
  Captures decisions that downstream agents (researcher, planner) need.
  Does NOT spawn subagents — loads agent-skills for prompt context only.
  ALWAYS uses ask_question for gray area selection and discussion interactions.
allowed-tools: view_file run_command call_mcp_tool invoke_subagent define_subagent send_message ask_question grep_search list_dir write_to_file replace_file_content multi_replace_file_content schedule manage_subagents manage_task
metadata:
  author: opengsd
  version: "2.0.0-antigravity"
  runtime: antigravity
  pipeline_position: 3
  next_workflow: gsd-plan-phase
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
4. `get-shit-done/references/domain-probes.md` — Gray area identification patterns
5. `get-shit-done/references/gate-prompts.md` — Gate prompt patterns

> [!CAUTION]
> **ENFORCEMENT CHECKPOINT:** After reading the above files, run:
> ```bash
> bash get-shit-done/scripts/enforce-file-read.sh "antigravity-runtime.md"
> ```
> Proceed ONLY if exit code is 0.

## Initialization

Initialize the phase operation via the `gsd-guardian` MCP server:

```
call_mcp_tool(
  ServerName: "gsd-guardian",
  ToolName: "init_phase_op",
  Arguments: { phase: "<phase_number>" }
)
```

Parse the response JSON for: `commit_docs`, `phase_found`, `phase_dir`, `phase_number`,
`phase_name`, `phase_slug`, `padded_phase`, `has_research`, `has_context`, `has_plans`,
`has_verification`, `plan_count`, `roadmap_exists`, `planning_exists`, `response_language`.

Load agent-skills for downstream context (NOT for spawning — for prompt assembly only):

```
call_mcp_tool(
  ServerName: "gsd-guardian",
  ToolName: "agent_skills",
  Arguments: { agent_type: "gsd-advisor-researcher" }
)
```

**If `phase_found` is false:** Error — phase not found in roadmap. Direct user to `/gsd:progress`.

### Mode Dispatch

Read mode files **lazily** based on flags in arguments. The mode files live under
`get-shit-done/workflows/discuss-phase/modes/`. Read ONLY the file matching the active mode:

| Flag | Mode file to read |
|---|---|
| `--power` | `modes/power.md` (execute end-to-end, skip remaining steps) |
| `--all` | `modes/all.md` (overlay — auto-select all gray areas) |
| `--auto` | `modes/auto.md` + `modes/chain.md` |
| `--chain` | `modes/default.md` + `modes/chain.md` |
| `--text` | `modes/text.md` (overlay — no interactive menus) |
| `--batch` | `modes/batch.md` (overlay — group questions) |
| `--analyze` | `modes/analyze.md` (overlay — trade-off tables) |
| No flags | `modes/default.md` |

Advisor mode detection:
```
run_command(CommandLine: "test -f \"$HOME/.claude/get-shit-done/USER-PROFILE.md\" && echo true || echo false", Cwd: "<project_path>")
```

If `true`, read `modes/advisor.md` before `analyze_phase`.

**Do NOT read mode files unless the corresponding flag/condition is set.**

## Process

Follow the workflow in `get-shit-done/workflows/discuss-phase.md` with these Antigravity adaptations:

### Step 1: Check Blocking Anti-Patterns

Check for `.continue-here.md` in the phase directory:

```
run_command(CommandLine: "ls ${phase_dir}/.continue-here.md 2>/dev/null || true", Cwd: "<project_path>")
```

If found, parse for `blocking` severity anti-patterns. Demonstrate understanding of each
(what, how, structural prevention) before continuing.

### Step 2: Check SPEC.md

```
run_command(CommandLine: "ls ${phase_dir}/*-SPEC.md 2>/dev/null | grep -v AI-SPEC | head -1 || true", Cwd: "<project_path>")
```

If SPEC.md found: read it, count requirements, set `spec_loaded = true`.
If not found: continue with `spec_loaded = false`.

### Step 3: Check Existing Context

Check if CONTEXT.md already exists using `has_context` from init.

**If exists:**
```
ask_question(
  questions: [{
    question: "Phase [X] already has context. What do you want to do?",
    is_multi_select: false,
    options: [
      "Update it — load existing context and add new decisions",
      "View it — read the current CONTEXT.md",
      "Skip — move on without changes"
    ]
  }]
)
```

**If doesn't exist:** Check for interrupted discussion checkpoint:
```
run_command(CommandLine: "ls ${phase_dir}/*-DISCUSS-CHECKPOINT.json 2>/dev/null || true", Cwd: "<project_path>")
```

If checkpoint exists:
```
ask_question(
  questions: [{
    question: "Found interrupted discussion checkpoint ({N} areas completed out of {M}). Resume from where you left off?",
    is_multi_select: false,
    options: [
      "Resume — continue from last completed area",
      "Start fresh — delete checkpoint and begin again"
    ]
  }]
)
```

### Step 4: Load Prior Context

Read project-level context (use `view_file` for each):
- `.planning/PROJECT.md`
- `.planning/REQUIREMENTS.md`
- `.planning/STATE.md`

Read at most 3 prior CONTEXT.md files (most recent phases before current):
```
run_command(CommandLine: "find .planning/phases -name '*-CONTEXT.md' 2>/dev/null | sort -r | head -3", Cwd: "<project_path>")
```

If `.planning/DECISIONS-INDEX.md` exists, read that instead (bounded rolling summary).

Check for spike/sketch findings:
```
run_command(CommandLine: "ls ./.claude/skills/spike-findings-*/SKILL.md 2>/dev/null | head -1 || true", Cwd: "<project_path>")
run_command(CommandLine: "ls ./.claude/skills/sketch-findings-*/SKILL.md 2>/dev/null | head -1 || true", Cwd: "<project_path>")
```

Build internal `<prior_decisions>` from all sources.

### Step 5: Cross-Reference Todos

```
call_mcp_tool(
  ServerName: "gsd-guardian",
  ToolName: "todo_match_phase",
  Arguments: { phase: "<phase_number>" }
)
```

If matches found, use `ask_question` (multi-select) to let user pick which to fold:

```
ask_question(
  questions: [{
    question: "These TODO items match Phase [X] scope. Which should we fold into this discussion?",
    is_multi_select: true,
    options: [
      "{match_1_title} — {match_1_area}",
      "{match_2_title} — {match_2_area}",
      "None — skip all"
    ]
  }]
)
```

### Step 6: Scout Codebase

Read `get-shit-done/references/scout-codebase.md` for the phase-type→map selection table.

```
run_command(CommandLine: "ls .planning/codebase/*.md 2>/dev/null", Cwd: "<project_path>")
```

Select 2-3 maps per the reference's table; or grep fallback if none exist.
Build internal `<codebase_context>`.

### Step 7: Analyze Phase and Identify Gray Areas

1. Determine domain boundary — what capability this phase delivers.
2. Initialize canonical refs accumulator from ROADMAP.md.
3. Check prior decisions for already-decided gray areas.
4. If `spec_loaded = true`: only generate HOW gray areas (not WHAT or WHY).
5. Generate 3-4 phase-specific gray areas with code and prior-decision annotations.
6. Assess whether discussion is needed at all (skip assessment).

### Step 8: Present Gray Areas

**If `--auto` or `--all`:** Auto-select ALL gray areas. Skip `ask_question`.

**Otherwise:**
```
ask_question(
  questions: [{
    question: "Which areas do you want to discuss for [phase name]?",
    is_multi_select: true,
    options: [
      "[Gray area 1] — [concrete label with 1-2 questions and code-context annotation]",
      "[Gray area 2] — [concrete label with 1-2 questions and code-context annotation]",
      "[Gray area 3] — [concrete label with 1-2 questions and code-context annotation]",
      "[Gray area 4] — [concrete label with 1-2 questions and code-context annotation]"
    ]
  }]
)
```

**Do NOT include "skip" or "you decide" options.** User ran this to discuss — give real choices.

### Step 9: Discuss Selected Areas

Follow the active mode file for discussion behavior. All modes use `ask_question`
for each decision point:

```
ask_question(
  questions: [{
    question: "[Specific implementation question for this gray area]",
    is_multi_select: false,
    options: [
      "[Option A] — [description with code-context]",
      "[Option B] — [description with code-context]",
      "Other — I'll type what I want"
    ]
  }]
)
```

**Universal rules (apply to every mode):**
- **Canonical ref accumulation** — when user references a doc/spec/ADR, immediately
  read it with `view_file` and add to canonical refs accumulator.
- **Scope creep** — capture as deferred idea and redirect.
- **Incremental checkpoint** — after each area completes, write checkpoint JSON.
  Read template: `get-shit-done/workflows/discuss-phase/templates/checkpoint.json`.
- **Discussion log accumulation** — accumulate area name, options, selection, notes.

### Step 10: Write CONTEXT.md

Read the CONTEXT.md template (lazy-loaded):
```
view_file(AbsolutePath: "<skill_root>/get-shit-done/workflows/discuss-phase/templates/context.md")
```

Find or create phase directory:
```
run_command(CommandLine: "mkdir -p \"${expected_phase_dir}\"", Cwd: "<project_path>")
```

Write CONTEXT.md using `write_to_file`:
```
write_to_file(
  TargetFile: "${phase_dir}/${padded_phase}-CONTEXT.md",
  CodeContent: <populated template with decisions, domain, canonical_refs, specifics, deferred>
)
```

### Step 11: Write DISCUSSION-LOG.md and Git Commit

Read the DISCUSSION-LOG.md template (lazy-loaded):
```
view_file(AbsolutePath: "<skill_root>/get-shit-done/workflows/discuss-phase/templates/discussion-log.md")
```

Write the log, clean up checkpoint, and commit:

```
run_command(CommandLine: "rm -f \"${phase_dir}/${padded_phase}-DISCUSS-CHECKPOINT.json\"", Cwd: "<project_path>")
```

Commit via MCP:
```
call_mcp_tool(
  ServerName: "gsd-guardian",
  ToolName: "commit",
  Arguments: {
    message: "docs(${padded_phase}): capture phase context",
    files: ["${phase_dir}/${padded_phase}-CONTEXT.md", "${phase_dir}/${padded_phase}-DISCUSSION-LOG.md"]
  }
)
```

### Step 12: Update STATE.md

```
call_mcp_tool(
  ServerName: "gsd-guardian",
  ToolName: "state_record_session",
  Arguments: {
    stopped_at: "Phase ${PHASE} context gathered",
    resume_file: "${phase_dir}/${padded_phase}-CONTEXT.md"
  }
)

call_mcp_tool(
  ServerName: "gsd-guardian",
  ToolName: "commit",
  Arguments: {
    message: "docs(state): record phase ${PHASE} context session",
    files: [".planning/STATE.md"]
  }
)
```

### Step 13: Auto-Advance or Present Next Steps

**If `--auto`, `--chain`, or `workflow.auto_advance`:** Read
`get-shit-done/workflows/discuss-phase/modes/chain.md` and execute its auto_advance step.

**Otherwise:** Present completion summary:

```
Created: .planning/phases/${PADDED_PHASE}-${SLUG}/${PADDED_PHASE}-CONTEXT.md

## Decisions Captured
### [Category]
- [Key decision]

[If deferred ideas exist:]
## Noted for Later
- [Deferred idea] — future phase

---

## ▶ Next Up

**Phase ${PHASE}: [Name]** — [Goal from ROADMAP.md]

/gsd:plan-phase ${PHASE}
```

## gsd_run → call_mcp_tool Mapping

| Original gsd_run command | Antigravity call_mcp_tool |
|---|---|
| `gsd_run query init.phase-op "${PHASE}"` | `call_mcp_tool("gsd-guardian", "init_phase_op", {phase: "${PHASE}"})` |
| `gsd_run query agent-skills gsd-advisor-researcher` | `call_mcp_tool("gsd-guardian", "agent_skills", {agent_type: "gsd-advisor-researcher"})` |
| `gsd_run query todo.match-phase "${PHASE_NUMBER}"` | `call_mcp_tool("gsd-guardian", "todo_match_phase", {phase: "${PHASE_NUMBER}"})` |
| `gsd_run query commit "msg" --files ...` | `call_mcp_tool("gsd-guardian", "commit", {message: "msg", files: [...]})` |
| `gsd_run query state.record-session ...` | `call_mcp_tool("gsd-guardian", "state_record_session", {...})` |
| `gsd_run query config-get key` | `call_mcp_tool("gsd-guardian", "config_get", {key: "..."})` |

## Enforcement Summary

| Checkpoint | What it verifies | When to run |
|---|---|---|
| `enforce-file-read.sh "antigravity-runtime.md"` | Runtime reference was read | After step 0 |
| `enforce-mcp-usage.sh "init_phase_op"` | MCP server used (not raw CLI) | After initialization |

## Success Criteria

- [ ] Phase validated against roadmap
- [ ] Runtime reference read and enforcement checkpoint passed
- [ ] Prior context loaded (PROJECT.md, REQUIREMENTS.md, STATE.md, prior CONTEXT.md files)
- [ ] Already-decided questions not re-asked (carried forward from prior phases)
- [ ] Codebase scouted for reusable assets, patterns, and integration points
- [ ] Gray areas identified with code and prior-decision annotations
- [ ] User selected which areas to discuss (via `ask_question`, not improvised)
- [ ] Each selected area explored under the active mode's rules until satisfied
- [ ] Scope creep redirected to deferred ideas
- [ ] CONTEXT.md captures actual decisions, not vague vision
- [ ] CONTEXT.md includes canonical_refs with full file paths (MANDATORY)
- [ ] CONTEXT.md includes code_context section with reusable assets and patterns
- [ ] Deferred ideas preserved for future phases
- [ ] DISCUSSION-LOG.md created and committed via MCP
- [ ] Checkpoint file written after each area (incremental save)
- [ ] Interrupted sessions can be resumed from checkpoint
- [ ] Checkpoint file cleaned up after successful CONTEXT.md write
- [ ] STATE.md updated with session info — **committed via MCP**
- [ ] User directed to `gsd-plan-phase` as next step
