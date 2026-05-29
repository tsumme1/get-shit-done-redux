---
name: gsd-complete-milestone
description: |
  Mark a shipped milestone as complete. Runs pre-close artifact audit, creates historical
  record in MILESTONES.md, performs full PROJECT.md evolution review, archives roadmap and
  requirements, reorganizes ROADMAP.md with milestone groupings, writes retrospective,
  handles branch merging, and tags the release in git.
  Use when the user wants to complete/ship a milestone, says "complete milestone", or invokes /gsd:complete-milestone.
  This is the final step in a milestone cycle. No subagent spawning — orchestrator handles all steps inline.
allowed-tools: view_file run_command call_mcp_tool invoke_subagent define_subagent send_message ask_question grep_search list_dir write_to_file replace_file_content multi_replace_file_content schedule manage_subagents manage_task
metadata:
  author: opengsd
  version: "2.0.0-antigravity"
  runtime: antigravity
  pipeline_position: 8
  next_workflow: gsd-new-milestone
---

> [!CAUTION]
> **ANTIGRAVITY ENFORCEMENT ACTIVE**
> This skill runs under hard enforcement rules. Read the runtime reference
> FIRST, then follow this workflow EXACTLY. Do not improvise, do not use raw gsd-tools.cjs.

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

## Process

Follow the workflow in `get-shit-done/workflows/complete-milestone.md` with these Antigravity adaptations:

### Step 1: Pre-Close Artifact Audit

Run the audit via MCP:
```
call_mcp_tool(
  ServerName: "gsd-guardian",
  ToolName: "audit_open"
)
```

If open items found, present the full audit report to the user, then:

```
ask_question(
  questions: [
    {
      question: "These items are open. Choose an action:",
      is_multi_select: false,
      options: [
        "Resolve — stop and fix items, then re-run /gsd:complete-milestone",
        "Acknowledge all — document as deferred and proceed with close",
        "Cancel — exit without closing"
      ]
    }
  ]
)
```

If user chooses "Acknowledge all":
1. Re-run audit via MCP with `--json` to get structured data
2. Write acknowledged items to STATE.md under `## Deferred Items` section
3. Record in MILESTONES.md entry: `Known deferred items at close: {count}`

### Step 2: Verify Readiness

Analyze the roadmap via MCP:
```
call_mcp_tool(
  ServerName: "gsd-guardian",
  ToolName: "roadmap_analyze"
)
```

Parse REQUIREMENTS.md traceability table. Count total v1 requirements vs checked-off.

**If requirements incomplete:**

```
ask_question(
  questions: [
    {
      question: "Unchecked requirements found. How to proceed?",
      is_multi_select: false,
      options: [
        "Proceed anyway — mark milestone complete with known gaps",
        "Run audit first — /gsd:audit-milestone to assess gap severity",
        "Abort — return to development"
      ]
    }
  ]
)
```

**If YOLO mode (from config):** Auto-approve scope verification, proceed to stats.

**If interactive mode:**
```
ask_question(
  questions: [
    {
      question: "Ready to mark this milestone as shipped?",
      is_multi_select: false,
      options: [
        "Yes — mark as shipped",
        "Wait — I'll come back when ready",
        "Adjust scope — change which phases to include"
      ]
    }
  ]
)
```

### Step 3: Gather Stats

Calculate milestone statistics via `run_command`:
```
run_command(CommandLine: "git log --oneline --grep='feat(' | head -20", Cwd: "<project_path>")
run_command(CommandLine: "git log --format='%ai' <FIRST_COMMIT> | tail -1", Cwd: "<project_path>")
```

### Step 4: Extract Accomplishments

Extract one-liners from SUMMARY.md files via MCP:
```
call_mcp_tool(
  ServerName: "gsd-guardian",
  ToolName: "summary_extract",
  Arguments: { "file": "<summary_path>", "fields": "one_liner", "pick": "one_liner" }
)
```

### Step 5: Evolve PROJECT.md — Full Review

Read all phase summaries:
```
run_command(CommandLine: "cat .planning/phases/*-*/*-SUMMARY.md", Cwd: "<project_path>")
```

Perform the full review checklist per `complete-milestone.md`:
1. "What This Is" accuracy
2. Core Value check
3. Requirements audit (Active → Validated)
4. Context update
5. Key Decisions audit
6. Constraints check

Update PROJECT.md inline. Update "Last updated" footer.

### Step 6: Reorganize ROADMAP.md

**CRITICAL: Extract Backlog section FIRST:**
```
run_command(
  CommandLine: "awk '/^## Backlog/{found=1} found{print}' .planning/ROADMAP.md",
  Cwd: "<project_path>"
)
```

Reorganize ROADMAP.md with milestone groupings per the template in `complete-milestone.md`.
Re-append Backlog section after rewrite (only if non-empty).

### Step 7: Archive Milestone

Delegate archival to MCP:
```
call_mcp_tool(
  ServerName: "gsd-guardian",
  ToolName: "milestone_complete",
  Arguments: { "version": "v[X.Y]", "name": "[Milestone Name]" }
)
```

Extract from result: `version`, `date`, `phases`, `plans`, `tasks`, `accomplishments`, `archived`.

**Phase archival:**
```
ask_question(
  questions: [
    {
      question: "Archive phase directories to milestones/?",
      is_multi_select: false,
      options: [
        "Yes — move to milestones/v[X.Y]-phases/",
        "Skip — keep phases in place"
      ]
    }
  ]
)
```

If "Yes":
```
run_command(
  CommandLine: "mkdir -p .planning/milestones/v[X.Y]-phases && for d in .planning/phases/*/; do mv \"$d\" .planning/milestones/v[X.Y]-phases/; done",
  Cwd: "<project_path>"
)
```

### Step 8: Safety Commit and Remove REQUIREMENTS.md

**Safety commit — commit archive files BEFORE deleting originals:**
```
call_mcp_tool(
  ServerName: "gsd-guardian",
  ToolName: "commit",
  Arguments: {
    "message": "chore: archive v[X.Y] milestone files",
    "files": [
      ".planning/milestones/v[X.Y]-ROADMAP.md",
      ".planning/milestones/v[X.Y]-REQUIREMENTS.md",
      ".planning/milestones/v[X.Y]-MILESTONE-AUDIT.md",
      ".planning/MILESTONES.md",
      ".planning/PROJECT.md",
      ".planning/STATE.md",
      ".planning/ROADMAP.md"
    ]
  }
)
```

**Remove REQUIREMENTS.md via git rm:**
```
run_command(CommandLine: "git rm .planning/REQUIREMENTS.md", Cwd: "<project_path>")
```

### Step 9: Write Retrospective

Check for existing retrospective:
```
run_command(CommandLine: "ls .planning/RETROSPECTIVE.md 2>/dev/null || true", Cwd: "<project_path>")
```

Gather retrospective data from SUMMARY.md, VERIFICATION.md, UAT.md files and git log.
Write/update RETROSPECTIVE.md per `complete-milestone.md` template.

**Commit retrospective via MCP:**
```
call_mcp_tool(
  ServerName: "gsd-guardian",
  ToolName: "commit",
  Arguments: { "message": "docs: update retrospective for v[X.Y]", "files": [".planning/RETROSPECTIVE.md"] }
)
```

### Step 10: Update STATE.md

Verify remaining STATE.md fields:
- Project Reference section updated
- Accumulated Context: clear decisions/resolved blockers, keep open blockers

### Step 11: Handle Branches

Load branching config via MCP:
```
call_mcp_tool(
  ServerName: "gsd-guardian",
  ToolName: "init_execute_phase",
  Arguments: { "phase": "1" }
)
```

Extract `branching_strategy`, `phase_branch_template`, `milestone_branch_template`, `commit_docs`.

**If branches exist:**
```
ask_question(
  questions: [
    {
      question: "How should milestone branches be handled?",
      is_multi_select: false,
      options: [
        "Squash merge (Recommended) — clean single-commit merge to main",
        "Merge with history — preserve all commits",
        "Delete without merging — already merged or not needed",
        "Keep branches — leave for manual handling"
      ]
    }
  ]
)
```

Execute chosen merge strategy via `run_command`.

### Step 12: Git Tag

Check tag config:
```
call_mcp_tool(
  ServerName: "gsd-guardian",
  ToolName: "config_get",
  Arguments: { "key": "git.create_tag" }
)
```

If enabled:
```
run_command(
  CommandLine: "git tag -a v[X.Y] -m 'v[X.Y] [Name]\n\nDelivered: [One sentence]\n\nKey accomplishments:\n- [Item 1]\n- [Item 2]\n- [Item 3]'",
  Cwd: "<project_path>"
)
```

**Push tag:**
```
ask_question(
  questions: [
    {
      question: "Push tag to remote?",
      is_multi_select: false,
      options: [
        "Yes — push v[X.Y] to origin",
        "No — keep tag local"
      ]
    }
  ]
)
```

### Step 13: Commit Milestone

```
run_command(
  CommandLine: "git commit -m 'chore: remove REQUIREMENTS.md for v[X.Y] milestone'",
  Cwd: "<project_path>"
)
```

### Step 14: Done

Present completion summary and direct user to next workflow:
`gsd-new-milestone` (the cycle continues).

```
✅ Milestone v[X.Y] [Name] complete

Shipped:
- [N] phases ([M] plans, [P] tasks)
- [One sentence of what shipped]

Archived:
- milestones/v[X.Y]-ROADMAP.md
- milestones/v[X.Y]-REQUIREMENTS.md

Summary: .planning/MILESTONES.md
Tag: v[X.Y]

---

## ▶ Next Up

**Start Next Milestone** — questioning → research → requirements → roadmap

`/clear` then:

`/gsd:new-milestone`
```

## Enforcement Summary

| Checkpoint | What it verifies | When to run |
|---|---|---|
| `enforce-file-read.sh "antigravity-runtime.md"` | Runtime reference was read | After Required Reading |
| `enforce-mcp-usage.sh "audit_open"` | Pre-close audit used MCP | After Step 1 |
| `enforce-mcp-usage.sh "milestone_complete"` | Archive used MCP | After Step 7 |
| `enforce-mcp-usage.sh "commit"` | All commits via MCP | After each commit |

## Success Criteria

- [ ] Pre-close artifact audit run and output shown to user → **via MCP `audit_open`**
- [ ] Deferred items recorded in STATE.md if user acknowledged (via `ask_question`)
- [ ] Known deferred items count noted in MILESTONES.md entry
- [ ] Requirements completion checked — incomplete requirements surfaced with options (via `ask_question`)
- [ ] Known gaps recorded in MILESTONES.md if user proceeded with incomplete requirements
- [ ] MILESTONES.md entry created with stats and accomplishments
- [ ] PROJECT.md full evolution review completed (all 6 checklist items)
- [ ] All shipped requirements moved to Validated in PROJECT.md
- [ ] Key Decisions updated with outcomes
- [ ] ROADMAP.md Backlog section extracted before rewrite, re-appended after
- [ ] ROADMAP.md reorganized with milestone grouping (overwritten in place)
- [ ] Roadmap archive created (milestones/v[X.Y]-ROADMAP.md) → **via MCP `milestone_complete`**
- [ ] Requirements archive created (milestones/v[X.Y]-REQUIREMENTS.md) → **via MCP `milestone_complete`**
- [ ] Safety commit made BEFORE deleting REQUIREMENTS.md → **via MCP `commit`**
- [ ] REQUIREMENTS.md removed via `git rm` (fresh for next milestone)
- [ ] RETROSPECTIVE.md updated with milestone section → **committed via MCP**
- [ ] Cross-milestone trends updated
- [ ] STATE.md updated with fresh project reference
- [ ] Git tag created (v[X.Y]) if `git.create_tag` enabled → **via `run_command`**
- [ ] Branch handling completed (merge/delete/keep) via `ask_question`
- [ ] Milestone commit made → **via `run_command`**
- [ ] User directed to `/gsd:new-milestone`
