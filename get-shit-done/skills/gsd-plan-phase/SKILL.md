---
name: gsd-plan-phase
description: |
  Create executable phase prompts (PLAN.md files) for a roadmap phase with integrated
  research and verification. Default flow: Research → Plan → Verify → Done.
  Orchestrates gsd-phase-researcher, gsd-pattern-mapper (optional), gsd-planner, and
  gsd-plan-checker agents with a revision loop (max 3 iterations).
  ALWAYS spawns subagents for research, planning, and verification — never inlines agent work.
allowed-tools: view_file run_command call_mcp_tool invoke_subagent define_subagent send_message ask_question grep_search list_dir write_to_file replace_file_content multi_replace_file_content schedule manage_subagents manage_task
metadata:
  author: opengsd
  version: "2.0.0-antigravity"
  runtime: antigravity
  pipeline_position: 4
  next_workflow: gsd-execute-phase
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
4. `get-shit-done/references/revision-loop.md` — Revision loop rules
5. `get-shit-done/references/agent-contracts.md` — Agent contracts
6. `get-shit-done/references/gates.md` — Gate definitions

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
  ToolName: "init_plan_phase",
  Arguments: { phase: "<phase_number>" }
)
```

Parse JSON for: `researcher_model`, `planner_model`, `checker_model`, `research_enabled`,
`plan_checker_enabled`, `nyquist_validation_enabled`, `commit_docs`, `text_mode`,
`phase_found`, `phase_dir`, `phase_number`, `phase_name`, `phase_slug`, `padded_phase`,
`has_research`, `has_context`, `has_reviews`, `has_plans`, `plan_count`, `phase_status`,
`planning_exists`, `roadmap_exists`, `phase_req_ids`, `response_language`,
`state_path`, `roadmap_path`, `requirements_path`, `context_path`, `research_path`,
`verification_path`, `uat_path`, `reviews_path`, `patterns_path`,
`auto_chain_active`, `auto_advance`.

Load agent skills for all agents:

```
call_mcp_tool("gsd-guardian", "agent_skills", {agent_type: "gsd-phase-researcher"})
call_mcp_tool("gsd-guardian", "agent_skills", {agent_type: "gsd-planner"})
call_mcp_tool("gsd-guardian", "agent_skills", {agent_type: "gsd-plan-checker"})
```

Load additional config:

```
call_mcp_tool("gsd-guardian", "config_get", {key: "context_window"})
call_mcp_tool("gsd-guardian", "config_get", {key: "workflow.tdd_mode"})
call_mcp_tool("gsd-guardian", "config_get", {key: "workflow.mvp_mode"})
```

**If `planning_exists` is false:** Error — run `/gsd:new-project` first.

### Define Agent Types

Register all agent types needed by this workflow. Read agent definition files
and pass contents as system prompts:

```
# Read agent definitions
view_file("agents/gsd-phase-researcher.md")
view_file("agents/gsd-planner.md")
view_file("agents/gsd-plan-checker.md")
view_file("agents/gsd-pattern-mapper.md")

# Define agent types (once per conversation)
define_subagent(
  name: "gsd-phase-researcher",
  description: "Researches technical approaches for a phase",
  system_prompt: <contents of agents/gsd-phase-researcher.md>,
  enable_write_tools: true,
  enable_mcp_tools: true
)

define_subagent(
  name: "gsd-pattern-mapper",
  description: "Analyzes codebase for existing patterns, produces PATTERNS.md",
  system_prompt: <contents of agents/gsd-pattern-mapper.md>,
  enable_write_tools: true,
  enable_mcp_tools: true
)

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

Follow the workflow in `get-shit-done/workflows/plan-phase.md` with these Antigravity adaptations:

### Step 1: Closed-Phase Gate

If `phase_status` is `Complete`, block unless `--force` flag is present.
Error: "Phase is CLOSED. Re-run with `--force` to override."

### Step 2: Parse Arguments

Extract from arguments: phase number, flags (`--research`, `--skip-research`,
`--research-phase <N>`, `--gaps`, `--skip-verify`, `--skip-ui`, `--prd <filepath>`,
`--ingest <path>`, `--reviews`, `--bounce`, `--skip-bounce`, `--chunked`, `--mvp`, `--force`).

Resolve MVP mode:
```
call_mcp_tool(
  ServerName: "gsd-guardian",
  ToolName: "phase_mvp_mode",
  Arguments: { phase: "<PHASE>", cli_flag: <true if --mvp> }
)
```

Resolve chunked mode:
```
call_mcp_tool("gsd-guardian", "config_get", {key: "workflow.plan_chunked"})
```

### Step 3: Validate Phase

```
call_mcp_tool(
  ServerName: "gsd-guardian",
  ToolName: "roadmap_get_phase",
  Arguments: { phase: "<PHASE>" }
)
```

If `found` is false: error with available phases.
If `found` is true: extract `phase_number`, `phase_name`, `goal`.

### Step 3.5: Handle PRD Express Path (if `--prd`)

Read PRD file, generate CONTEXT.md from requirements, commit via MCP:
```
call_mcp_tool(
  ServerName: "gsd-guardian",
  ToolName: "commit",
  Arguments: {
    message: "docs(${padded_phase}): generate context from PRD",
    files: ["${phase_dir}/${padded_phase}-CONTEXT.md"]
  }
)
```

Skip to step 5.

### Step 4: Load CONTEXT.md

If `context_path` is null (no CONTEXT.md):

```
ask_question(
  questions: [{
    question: "No CONTEXT.md found for Phase {X}. Plans will use research and requirements only — your design preferences won't be included. Continue or capture context first?",
    is_multi_select: false,
    options: [
      "Continue without context — Plan using research + requirements only",
      "Run discuss-phase first — Capture design decisions before planning"
    ]
  }]
)
```

If "Run discuss-phase first": display command and EXIT workflow.

### Step 4.5: Check AI-SPEC

```
call_mcp_tool("gsd-guardian", "config_get", {key: "workflow.ai_integration_phase"})
```

```
run_command(CommandLine: "ls \"${PHASE_DIR}\"/*-AI-SPEC.md 2>/dev/null | head -1", Cwd: "<project_path>")
```

If AI keywords in phase goal AND no AI-SPEC.md:
```
ask_question(
  questions: [{
    question: "This phase appears to involve AI system development. Run /gsd:ai-integration-phase first?",
    is_multi_select: false,
    options: [
      "Continue — plan without AI-SPEC",
      "Stop — I'll run /gsd:ai-integration-phase first"
    ]
  }]
)
```

### Step 5: Handle Research — MUST SPAWN SUBAGENT

> [!CAUTION]
> **ENFORCEMENT: SUBAGENT SPAWN MANDATORY**
> When research is needed, you MUST spawn a `gsd-phase-researcher` subagent.
> Do NOT research inline. Do NOT skip the spawn.

**If `has_research` is true AND no `--research` flag:** Use existing, skip to step 6.

**If research needed and no explicit flag:**
```
ask_question(
  questions: [{
    question: "Research before planning Phase {X}: {phase_name}?",
    is_multi_select: false,
    options: [
      "(Recommended) Research first — Investigate domain, patterns, and dependencies",
      "Skip research — Plan directly from context and requirements"
    ]
  }]
)
```

**Spawn gsd-phase-researcher:**

Get phase description:
```
call_mcp_tool("gsd-guardian", "roadmap_get_phase", {phase: "${PHASE}", pick: "section"})
```

```
invoke_subagent(
  Subagents: [{
    TypeName: "gsd-phase-researcher",
    Role: "Phase {X} Researcher",
    Prompt: "<objective>\nResearch how to implement Phase {phase_number}: {phase_name}\nAnswer: 'What do I need to know to PLAN this phase well?'\n</objective>\n\n<files_to_read>\n- {context_path}\n- {requirements_path}\n- {state_path}\n</files_to_read>\n\n{AGENT_SKILLS_RESEARCHER}\n\n<additional_context>\n**Phase description:** {phase_description}\n**Phase requirement IDs (MUST address):** {phase_req_ids}\n</additional_context>\n\n<output>\nWrite to: {phase_dir}/{padded_phase}-RESEARCH.md\n</output>",
    Workspace: "inherit"
  }]
)
```

**WAIT for researcher to complete.** Do NOT proceed until notified.

> [!CAUTION]
> **ENFORCEMENT CHECKPOINT:** After researcher completes, run:
> ```bash
> bash get-shit-done/scripts/enforce-subagent-spawn.sh "gsd-phase-researcher"
> ```
> Proceed ONLY if exit code is 0.

### Step 5.5: Create Validation Strategy

Skip if `nyquist_validation_enabled` is false.

```
run_command(CommandLine: "grep -l '## Validation Architecture' \"${PHASE_DIR}\"/*-RESEARCH.md 2>/dev/null || true", Cwd: "<project_path>")
```

If found: read template, write VALIDATION.md, verify, commit via MCP.

### Step 5.6: UI Design Contract Gate

```
call_mcp_tool("gsd-guardian", "config_get", {key: "workflow.ui_phase"})
call_mcp_tool("gsd-guardian", "config_get", {key: "workflow.ui_safety_gate"})
```

Check phase for frontend indicators. If UI-SPEC missing and gate enabled:
```
ask_question(
  questions: [{
    question: "UI-SPEC.md missing for Phase {N}. Generate UI design contract before planning?",
    is_multi_select: false,
    options: [
      "Generate UI-SPEC first (recommended for frontend phases)",
      "Skip — plan without UI-SPEC"
    ]
  }]
)
```

### Step 5.7: Schema Push Detection Gate

Scan phase artifacts for ORM file patterns. If schema files detected,
set `SCHEMA_PUSH_REQUIRED=true` and inject constraint into planner prompt.

### Step 6: Check Existing Plans

```
run_command(CommandLine: "ls \"${PHASE_DIR}\"/*-PLAN.md 2>/dev/null || true", Cwd: "<project_path>")
```

If plans exist AND no `--reviews`:
```
ask_question(
  questions: [{
    question: "Phase {X} already has {N} plan(s). What would you like to do?",
    is_multi_select: false,
    options: [
      "Add more plans — keep existing, generate additional",
      "View existing — read current plans",
      "Replan from scratch — delete existing and regenerate"
    ]
  }]
)
```

### Step 7: Use Context Paths from Init

All paths already parsed from init JSON. Also detect spike/sketch findings:
```
run_command(CommandLine: "ls ./.claude/skills/spike-findings-*/SKILL.md 2>/dev/null | head -1 || true", Cwd: "<project_path>")
run_command(CommandLine: "ls ./.claude/skills/sketch-findings-*/SKILL.md 2>/dev/null | head -1 || true", Cwd: "<project_path>")
```

### Step 7.5: Verify Nyquist Artifacts

If nyquist enabled and VALIDATION.md missing:
```
ask_question(
  questions: [{
    question: "VALIDATION.md missing. Nyquist validation cannot run without it.",
    is_multi_select: false,
    options: [
      "Re-run with --research to generate validation strategy",
      "Disable Nyquist validation",
      "Continue anyway (plans fail Dimension 8)"
    ]
  }]
)
```

### Step 7.8: Spawn gsd-pattern-mapper (Optional)

Skip if `workflow.pattern_mapper` is `false` or PATTERNS.md already exists.

```
call_mcp_tool("gsd-guardian", "config_get", {key: "workflow.pattern_mapper"})
```

> [!CAUTION]
> **ENFORCEMENT: SUBAGENT SPAWN MANDATORY**
> Pattern mapping REQUIRES spawning a `gsd-pattern-mapper` subagent.

```
invoke_subagent(
  Subagents: [{
    TypeName: "gsd-pattern-mapper",
    Role: "Pattern Mapper Phase {X}",
    Prompt: "<pattern_mapping_context>\n**Phase:** {phase_number} - {phase_name}\n**Phase directory:** {phase_dir}\n**Padded phase:** {padded_phase}\n\n<files_to_read>\n- {context_path}\n- {research_path}\n</files_to_read>\n\n**Output file:** {phase_dir}/{padded_phase}-PATTERNS.md\n</pattern_mapping_context>",
    Workspace: "inherit"
  }]
)
```

**WAIT for pattern mapper to complete.**

### Step 8: Spawn gsd-planner — MUST SPAWN SUBAGENT

> [!CAUTION]
> **ENFORCEMENT: SUBAGENT SPAWN MANDATORY**
> This step REQUIRES spawning a `gsd-planner` subagent.
> Do NOT create plans inline. Do NOT skip the spawn.

```
invoke_subagent(
  Subagents: [{
    TypeName: "gsd-planner",
    Role: "Phase {X} Planner",
    Prompt: "<planning_context>\n**Phase:** {phase_number}\n**Mode:** {standard | gap_closure | reviews}\n\n<files_to_read>\n- {state_path}\n- {roadmap_path}\n- {requirements_path}\n- {context_path}\n- {research_path}\n- {PATTERNS_PATH}\n- {verification_path} (if --gaps)\n- {uat_path} (if --gaps)\n- {reviews_path} (if --reviews)\n- {UI_SPEC_PATH} (if exists)\n</files_to_read>\n\n{AGENT_SKILLS_PLANNER}\n\n**Phase requirement IDs (every ID MUST appear in a plan):** {phase_req_ids}\n</planning_context>\n\n<downstream_consumer>\nOutput consumed by /gsd:execute-phase. Plans need:\n- Frontmatter (wave, depends_on, files_modified, autonomous)\n- Tasks in XML format with read_first and acceptance_criteria (MANDATORY)\n- Verification criteria\n- must_haves for goal-backward verification\n</downstream_consumer>",
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
> Proceed ONLY if exit code is 0.

### Step 9: Handle Planner Return

- **`## PLANNING COMPLETE`:** Display plan count. If `--skip-verify` or `plan_checker_enabled`
  is false: skip to step 13. Otherwise: step 10.
- **`## PHASE SPLIT RECOMMENDED`:** Present split options via `ask_question`.
- **`## ⚠ Source Audit: Unplanned Items Found`:** Present each gap via `ask_question`.
- **`## CHECKPOINT REACHED`:** Present to user, spawn continuation.
- **`## PLANNING INCONCLUSIVE`:** Show attempts, offer retry/manual.
- **Empty/truncated:** Filesystem fallback — check disk for `*-PLAN.md` files.

For phase split:
```
ask_question(
  questions: [{
    question: "Phase {X} exceeds context budget. How to proceed?",
    is_multi_select: false,
    options: [
      "Split into sub-phases (recommended)",
      "Proceed anyway — quality may degrade",
      "Prioritize — I'll choose which items to implement now"
    ]
  }]
)
```

### Step 10: Spawn gsd-plan-checker — MUST SPAWN SUBAGENT

> [!CAUTION]
> **ENFORCEMENT: SUBAGENT SPAWN MANDATORY**
> This step REQUIRES spawning a `gsd-plan-checker` subagent.
> Do NOT verify plans inline.

```
invoke_subagent(
  Subagents: [{
    TypeName: "gsd-plan-checker",
    Role: "Phase {X} Plan Checker",
    Prompt: "<verification_context>\n**Phase:** {phase_number}\n**Phase Goal:** {goal}\n\n<files_to_read>\n- {PHASE_DIR}/*-PLAN.md\n- {roadmap_path}\n- {requirements_path}\n- {context_path}\n- {research_path}\n</files_to_read>\n\n{AGENT_SKILLS_CHECKER}\n\n**Phase requirement IDs (MUST ALL be covered):** {phase_req_ids}\n</verification_context>\n\n<expected_output>\n- ## VERIFICATION PASSED — all checks pass\n- ## ISSUES FOUND — structured issue list\n</expected_output>",
    Workspace: "inherit"
  }]
)
```

**WAIT for plan checker to complete.**

> [!CAUTION]
> **ENFORCEMENT CHECKPOINT:** After plan checker completes, run:
> ```bash
> bash get-shit-done/scripts/enforce-subagent-spawn.sh "gsd-plan-checker"
> ```

### Step 11: Handle Checker Return

- **`## VERIFICATION PASSED`:** Proceed to step 13.
- **`## ISSUES FOUND`:** Display issues, proceed to step 12.
- **Empty/truncated:** Filesystem fallback — offer accept/retry/stop.

### Step 12: Revision Loop (Max 3 Iterations)

Track `iteration_count` (starts at 1).

**If iteration_count < 3:**

Spawn planner with revision context:
```
invoke_subagent(
  Subagents: [{
    TypeName: "gsd-planner",
    Role: "Phase {X} Planner (revision {N}/3)",
    Prompt: "<revision_context>\n**Phase:** {phase_number}\n**Mode:** revision\n\n<files_to_read>\n- {PHASE_DIR}/*-PLAN.md\n- {context_path}\n</files_to_read>\n\n{AGENT_SKILLS_PLANNER}\n\n**Checker issues:** {structured_issues}\n</revision_context>\n\n<instructions>\nMake targeted updates to address checker issues.\nDo NOT replan from scratch unless issues are fundamental.\n</instructions>",
    Workspace: "inherit"
  }]
)
```

After planner returns → spawn checker again (step 10), increment `iteration_count`.

**If iteration_count >= 3:**
```
ask_question(
  questions: [{
    question: "Max iterations reached. {N} issues remain. How to proceed?",
    is_multi_select: false,
    options: [
      "Force proceed — execute despite remaining issues",
      "Provide guidance — I'll give direction, then retry",
      "Abandon — exit, I'll run /gsd:plan-phase manually"
    ]
  }]
)
```

### Step 13: Requirements Coverage Gate

Verify all `phase_req_ids` are covered by at least one plan.

If gaps found:
```
ask_question(
  questions: [{
    question: "{M} of {N} phase requirements are not assigned to any plan. How to proceed?",
    is_multi_select: false,
    options: [
      "Re-plan to include missing requirements (recommended)",
      "Move uncovered requirements to next phase",
      "Proceed anyway — accept coverage gaps"
    ]
  }]
)
```

### Step 13a: Decision Coverage Gate

```
call_mcp_tool(
  ServerName: "gsd-guardian",
  ToolName: "check_decision_coverage_plan",
  Arguments: { phase_dir: "${PHASE_DIR}", context_path: "${CONTEXT_PATH}" }
)
```

If `passed` is false:
```
ask_question(
  questions: [{
    question: "Decision coverage gate failed. Some CONTEXT.md decisions are not in any plan.",
    is_multi_select: false,
    options: [
      "Re-plan to cover missing decisions (recommended)",
      "Edit CONTEXT.md to mark dropped decisions as [informational]",
      "Proceed anyway — accept the coverage gap"
    ]
  }]
)
```

### Step 13b: Record Planning Completion

```
call_mcp_tool(
  ServerName: "gsd-guardian",
  ToolName: "state_planned_phase",
  Arguments: { phase: "${PHASE_NUMBER}", name: "${PHASE_NAME}", plans: "${PLAN_COUNT}" }
)
```

### Step 13c: Annotate ROADMAP

```
call_mcp_tool(
  ServerName: "gsd-guardian",
  ToolName: "roadmap_annotate_dependencies",
  Arguments: { phase: "${PHASE_NUMBER}" }
)
```

### Step 13d: Commit Plans

If `commit_docs` is true:
```
call_mcp_tool(
  ServerName: "gsd-guardian",
  ToolName: "commit",
  Arguments: {
    message: "docs(${PADDED_PHASE}): create phase plan",
    files: ["${PHASE_DIR}/*-PLAN.md", ".planning/STATE.md", ".planning/ROADMAP.md"]
  }
)
```

### Step 14: Present Final Status

Display plan summary table with waves, plan IDs, and objectives.

### Step 15: Auto-Advance Check

Use `auto_chain_active` and `auto_advance` from INIT JSON (do NOT issue
additional config-get calls for these values).

**If `--auto` or `--chain` or auto-advance enabled:**
Display auto-advance banner and direct to `gsd-execute-phase`.

**Otherwise:** Present `offer_next` with next steps.

## gsd_run → call_mcp_tool Mapping

| Original gsd_run command | Antigravity call_mcp_tool |
|---|---|
| `gsd_run query init.plan-phase "$PHASE"` | `call_mcp_tool("gsd-guardian", "init_plan_phase", {phase: "$PHASE"})` |
| `gsd_run query agent-skills gsd-phase-researcher` | `call_mcp_tool("gsd-guardian", "agent_skills", {agent_type: "gsd-phase-researcher"})` |
| `gsd_run query agent-skills gsd-planner` | `call_mcp_tool("gsd-guardian", "agent_skills", {agent_type: "gsd-planner"})` |
| `gsd_run query agent-skills gsd-plan-checker` | `call_mcp_tool("gsd-guardian", "agent_skills", {agent_type: "gsd-plan-checker"})` |
| `gsd_run query config-get context_window` | `call_mcp_tool("gsd-guardian", "config_get", {key: "context_window"})` |
| `gsd_run query config-get workflow.tdd_mode` | `call_mcp_tool("gsd-guardian", "config_get", {key: "workflow.tdd_mode"})` |
| `gsd_run query config-get workflow.mvp_mode` | `call_mcp_tool("gsd-guardian", "config_get", {key: "workflow.mvp_mode"})` |
| `gsd_run query config-get workflow.pattern_mapper` | `call_mcp_tool("gsd-guardian", "config_get", {key: "workflow.pattern_mapper"})` |
| `gsd_run query config-get workflow.ui_phase` | `call_mcp_tool("gsd-guardian", "config_get", {key: "workflow.ui_phase"})` |
| `gsd_run query config-get workflow.ui_safety_gate` | `call_mcp_tool("gsd-guardian", "config_get", {key: "workflow.ui_safety_gate"})` |
| `gsd_run query config-get workflow.plan_chunked` | `call_mcp_tool("gsd-guardian", "config_get", {key: "workflow.plan_chunked"})` |
| `gsd_run query config-get workflow.security_enforcement` | `call_mcp_tool("gsd-guardian", "config_get", {key: "workflow.security_enforcement"})` |
| `gsd_run query config-get workflow.security_asvs_level` | `call_mcp_tool("gsd-guardian", "config_get", {key: "workflow.security_asvs_level"})` |
| `gsd_run query config-get workflow.security_block_on` | `call_mcp_tool("gsd-guardian", "config_get", {key: "workflow.security_block_on"})` |
| `gsd_run query config-get workflow.context_coverage_gate` | `call_mcp_tool("gsd-guardian", "config_get", {key: "workflow.context_coverage_gate"})` |
| `gsd_run query config-get workflow.post_planning_gaps` | `call_mcp_tool("gsd-guardian", "config_get", {key: "workflow.post_planning_gaps"})` |
| `gsd_run query config-get workflow.plan_bounce` | `call_mcp_tool("gsd-guardian", "config_get", {key: "workflow.plan_bounce"})` |
| `gsd_run query config-get workflow.plan_bounce_script` | `call_mcp_tool("gsd-guardian", "config_get", {key: "workflow.plan_bounce_script"})` |
| `gsd_run query config-get workflow.plan_bounce_passes` | `call_mcp_tool("gsd-guardian", "config_get", {key: "workflow.plan_bounce_passes"})` |
| `gsd_run query config-get workflow.code_review_command` | `call_mcp_tool("gsd-guardian", "config_get", {key: "workflow.code_review_command"})` |
| `gsd_run query config-set key value` | `call_mcp_tool("gsd-guardian", "config_set", {key: "...", value: "..."})` |
| `gsd_run query roadmap.get-phase "${PHASE}"` | `call_mcp_tool("gsd-guardian", "roadmap_get_phase", {phase: "${PHASE}"})` |
| `gsd_run query roadmap.get-phase "${PHASE}" --pick section` | `call_mcp_tool("gsd-guardian", "roadmap_get_phase", {phase: "${PHASE}", pick: "section"})` |
| `gsd_run query phase.mvp-mode "${PHASE}" --cli-flag` | `call_mcp_tool("gsd-guardian", "phase_mvp_mode", {phase: "${PHASE}", cli_flag: true})` |
| `gsd_run query phases.list --pick summaries_total` | `call_mcp_tool("gsd-guardian", "phases_list", {pick: "summaries_total"})` |
| `gsd_run query check.decision-coverage-plan ...` | `call_mcp_tool("gsd-guardian", "check_decision_coverage_plan", {...})` |
| `gsd_run query check auto-mode --pick auto_chain_active` | `call_mcp_tool("gsd-guardian", "check_auto_mode", {pick: "auto_chain_active"})` |
| `gsd_run query state.planned-phase ...` | `call_mcp_tool("gsd-guardian", "state_planned_phase", {...})` |
| `gsd_run query roadmap.annotate-dependencies "${PHASE}"` | `call_mcp_tool("gsd-guardian", "roadmap_annotate_dependencies", {phase: "${PHASE}"})` |
| `gsd_run query commit "msg" --files ...` | `call_mcp_tool("gsd-guardian", "commit", {message: "msg", files: [...]})` |

## Enforcement Summary

| Checkpoint | What it verifies | When to run |
|---|---|---|
| `enforce-file-read.sh "antigravity-runtime.md"` | Runtime reference was read | After step 0 |
| `enforce-subagent-spawn.sh "gsd-phase-researcher"` | Researcher was spawned | After step 5 |
| `enforce-subagent-spawn.sh "gsd-planner"` | Planner was spawned | After step 8 |
| `enforce-subagent-spawn.sh "gsd-plan-checker"` | Plan checker was spawned | After step 10 |
| `enforce-mcp-usage.sh "init_plan_phase"` | MCP server used (not raw CLI) | After initialization |

## Success Criteria

- [ ] `.planning/` directory validated
- [ ] Phase validated against roadmap
- [ ] Phase directory created if needed
- [ ] CONTEXT.md loaded early and passed to ALL agents
- [ ] Research completed (via spawned `gsd-phase-researcher` subagent) — **verified by enforcement**
- [ ] Pattern mapping completed (via spawned `gsd-pattern-mapper`) if enabled
- [ ] Existing plans checked
- [ ] `gsd-planner` spawned with CONTEXT.md + RESEARCH.md — **verified by enforcement**
- [ ] Plans created (PLANNING COMPLETE or CHECKPOINT handled)
- [ ] `gsd-plan-checker` spawned with CONTEXT.md — **verified by enforcement**
- [ ] Verification passed OR user override OR max iterations with user decision
- [ ] Requirements coverage gate passed
- [ ] Decision coverage gate passed
- [ ] Planning completion recorded in STATE.md — **committed via MCP**
- [ ] ROADMAP annotated with wave dependencies — **committed via MCP**
- [ ] Plans committed via MCP (if `commit_docs` is true)
- [ ] User sees status between agent spawns
- [ ] User directed to `gsd-execute-phase` as next step
