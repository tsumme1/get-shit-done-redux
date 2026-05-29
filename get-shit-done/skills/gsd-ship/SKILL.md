---
name: gsd-ship
description: |
  Create a pull request from completed phase/milestone work, generate a rich PR body
  from planning artifacts, optionally run code review, and prepare for merge.
  Closes the plan → execute → verify → ship loop.
  No subagents spawned. Uses gh CLI for PR creation.
allowed-tools: view_file run_command call_mcp_tool invoke_subagent define_subagent send_message ask_question grep_search list_dir write_to_file replace_file_content multi_replace_file_content schedule manage_subagents manage_task
metadata:
  author: opengsd
  version: "2.0.0-antigravity"
  runtime: antigravity
  pipeline_position: 7
  next_workflow: gsd-complete-milestone
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

## Initialization

Initialize via MCP:

```
call_mcp_tool(
  ServerName: "gsd-guardian",
  ToolName: "init_phase_op",
  Arguments: { phase: "<phase_number>" }
)
```

Parse JSON for: `phase_found`, `phase_dir`, `phase_number`, `phase_name`,
`padded_phase`, `commit_docs`.

Load state for branching strategy:
```
call_mcp_tool(
  ServerName: "gsd-guardian",
  ToolName: "state_load",
  Arguments: {}
)
```

Extract: `branching_strategy`, `branch_name`.

Detect base branch:
```
call_mcp_tool(
  ServerName: "gsd-guardian",
  ToolName: "config_get",
  Arguments: { key: "git.base_branch" }
)
```

If config returns null/empty, fallback:
```
run_command(CommandLine: "git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed 's|^refs/remotes/origin/||'", Cwd: "<project_path>")
```

Default to `main` if all detection fails.

## Process

Follow the workflow in `get-shit-done/workflows/ship.md` with these Antigravity adaptations:

### Step 1: Preflight Checks

Run all checks sequentially:

**1. Verification passed?**
```
run_command(CommandLine: "cat ${PHASE_DIR}/*-VERIFICATION.md 2>/dev/null", Cwd: "<project_path>")
```
Check for `status: pass` or `status: passed`. If not found: block with
`PHASE_VERIFICATION_INCOMPLETE`.

**2. Clean working tree?**
```
run_command(CommandLine: "git status --short", Cwd: "<project_path>")
```
If uncommitted changes: ask user to commit or stash first.

**3. On correct branch?**
```
run_command(CommandLine: "git branch --show-current", Cwd: "<project_path>")
```
If on base branch: warn — should be on a feature branch.

**4. Remote configured?**
```
run_command(CommandLine: "git remote -v | head -2", Cwd: "<project_path>")
```
If no `origin`: error — can't create PR.

**5. `gh` CLI available?**
```
run_command(CommandLine: "which gh && gh auth status 2>&1", Cwd: "<project_path>")
```
If `gh` not found or not authenticated: provide setup instructions and exit.

### Step 2: Push Branch

```
run_command(CommandLine: "git push origin ${CURRENT_BRANCH} 2>&1", Cwd: "<project_path>")
```

If push fails (no upstream):
```
run_command(CommandLine: "git push --set-upstream origin ${CURRENT_BRANCH} 2>&1", Cwd: "<project_path>")
```

Report: "Pushed `{branch}` to origin ({commit_count} commits ahead of ${BASE_BRANCH})"

### Step 3: Generate PR Body

Auto-generate a rich PR body from planning artifacts. Read these files with `view_file`:
- `ROADMAP.md` — for phase goal
- `VERIFICATION.md` — for verification status
- All `*-SUMMARY.md` files in phase directory — for changes and key files
- `REQUIREMENTS.md` — for requirement descriptions
- `STATE.md` — for decisions relevant to this phase

Generate markdown sections:
1. **Summary** — phase goal, verification status, one-paragraph synthesis
2. **Changes** — per-plan changes with key files
3. **Requirements Addressed** — REQ-IDs linked to descriptions
4. **Verification** — automated + human verification items
5. **Key Decisions** — from STATE.md

**Custom PR sections:**
```
call_mcp_tool(
  ServerName: "gsd-guardian",
  ToolName: "config_get",
  Arguments: { key: "ship.pr_body_sections" }
)
```

If configured, render append-only custom sections after Key Decisions.
Rules: cannot replace/remove/reorder core sections. Each entry needs
`heading` + at least one of `source`, `template`, `fallback`.
Omit sections whose rendered body is empty.

### Step 4: Create PR

Write PR body to temp file and create PR via `gh`:

```
run_command(
  CommandLine: "gh pr create --title \"Phase ${PHASE_NUMBER}: ${PHASE_NAME}\" --body-file \"${PR_BODY_FILE}\" --base \"${BASE_BRANCH}\"",
  Cwd: "<project_path>"
)
```

If `--draft` flag was passed, add `--draft`.

Report: "PR #{number} created: {url}"

### Step 5: Optional Review

**External code review (automated):**
```
call_mcp_tool(
  ServerName: "gsd-guardian",
  ToolName: "config_get",
  Arguments: { key: "workflow.code_review_command" }
)
```

If review command configured: generate diff, build review prompt, pipe to command,
parse JSON result, report verdict.

**Manual review options:**
```
ask_question(
  questions: [{
    question: "PR created. Run a code review before merge?",
    is_multi_select: false,
    options: [
      "Skip review — PR is ready, merge when CI passes",
      "Self-review — I'll review the diff in the PR myself",
      "Request review — request review from a teammate"
    ]
  }]
)
```

**If "Request review":**
```
run_command(CommandLine: "gh pr edit ${PR_NUMBER} --add-reviewer \"${REVIEWER}\"", Cwd: "<project_path>")
```

**If "Self-review":**
Report the PR URL: "Review the diff at {url}/files"

### Step 6: Track Shipping

Update STATE.md:
```
call_mcp_tool(
  ServerName: "gsd-guardian",
  ToolName: "state_update",
  Arguments: { key: "Last Activity", value: "<current_date>" }
)

call_mcp_tool(
  ServerName: "gsd-guardian",
  ToolName: "state_update",
  Arguments: { key: "Status", value: "Phase ${PHASE_NUMBER} shipped — PR #${PR_NUMBER}" }
)
```

If `commit_docs` is true:
```
call_mcp_tool(
  ServerName: "gsd-guardian",
  ToolName: "commit",
  Arguments: {
    message: "docs(${padded_phase}): ship phase ${PHASE_NUMBER} — PR #${PR_NUMBER}",
    files: [".planning/STATE.md"]
  }
)
```

### Step 7: Report

Display completion summary:

```
───────────────────────────────────────────────────────────────

## ✓ Phase {X}: {Name} — Shipped

PR: #{number} ({url})
Branch: {branch} → ${BASE_BRANCH}
Commits: {count}
Verification: ✓ Passed
Requirements: {N} REQ-IDs addressed

Next steps:
- Review/approve PR
- Merge when CI passes
- /gsd:complete-milestone (if last phase in milestone)
- /gsd:progress (to see what's next)

───────────────────────────────────────────────────────────────
```

## gsd_run → call_mcp_tool Mapping

| Original gsd_run command | Antigravity call_mcp_tool |
|---|---|
| `gsd_run query init.phase-op "${PHASE}"` | `call_mcp_tool("gsd-guardian", "init_phase_op", {phase: "${PHASE}"})` |
| `gsd_run query state.load` | `call_mcp_tool("gsd-guardian", "state_load", {})` |
| `gsd_run query config-get git.base_branch` | `call_mcp_tool("gsd-guardian", "config_get", {key: "git.base_branch"})` |
| `gsd_run query config-get ship.pr_body_sections` | `call_mcp_tool("gsd-guardian", "config_get", {key: "ship.pr_body_sections"})` |
| `gsd_run query config-get workflow.code_review_command` | `call_mcp_tool("gsd-guardian", "config_get", {key: "workflow.code_review_command"})` |
| `gsd_run query state.update key value` | `call_mcp_tool("gsd-guardian", "state_update", {key: "...", value: "..."})` |
| `gsd_run query commit "msg" --files ...` | `call_mcp_tool("gsd-guardian", "commit", {message: "msg", files: [...]})` |

## Enforcement Summary

| Checkpoint | What it verifies | When to run |
|---|---|---|
| `enforce-file-read.sh "antigravity-runtime.md"` | Runtime reference was read | After step 0 |
| `enforce-mcp-usage.sh "init_phase_op"` | MCP server used (not raw CLI) | After initialization |

## Success Criteria

- [ ] Runtime reference read and enforcement checkpoint passed
- [ ] Preflight checks passed (verification, clean tree, branch, remote, gh)
- [ ] Branch pushed to remote (via `run_command` with `git push`)
- [ ] PR body auto-generated from planning artifacts (ROADMAP, SUMMARY, REQUIREMENTS, VERIFICATION, STATE)
- [ ] Custom PR sections rendered if configured (append-only, after core sections)
- [ ] PR created via `gh pr create` (via `run_command`)
- [ ] External code review run if configured
- [ ] User offered review options via `ask_question`
- [ ] STATE.md updated with shipping status — **committed via MCP**
- [ ] User knows PR number and next steps
- [ ] User directed to `gsd-complete-milestone` as next step
