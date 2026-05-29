---
name: gsd-new-milestone
description: |
  Start a new milestone cycle for an existing GSD project. Loads project context, gathers
  milestone goals, updates PROJECT.md and STATE.md, optionally runs parallel research,
  defines scoped requirements with REQ-IDs, spawns the roadmapper to create a phased
  execution plan, and commits all artifacts.
  Use when the user wants to start a new milestone, says "new milestone", or invokes /gsd:new-milestone.
  ALWAYS spawns subagents for research and roadmap creation — never inlines agent work.
allowed-tools: view_file run_command call_mcp_tool invoke_subagent define_subagent send_message ask_question grep_search list_dir write_to_file replace_file_content multi_replace_file_content schedule manage_subagents manage_task
metadata:
  author: opengsd
  version: "2.0.0-antigravity"
  runtime: antigravity
  pipeline_position: 2
  next_workflow: gsd-discuss-phase
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

Initialize the milestone state via the `gsd-guardian` MCP server:

```
call_mcp_tool(
  ServerName: "gsd-guardian",
  ToolName: "init_new_milestone"
)
```

Parse the response JSON for: `researcher_model`, `synthesizer_model`, `roadmapper_model`,
`commit_docs`, `research_enabled`, `current_milestone`, `project_exists`, `roadmap_exists`,
`latest_completed_milestone`, `phase_dir_count`, `phase_archive_path`, `agents_installed`,
`missing_agents`.

**If `project_exists` is false:** Error — no project found. Direct user to `/gsd:new-project`.

### Parse Arguments

Parse `$ARGUMENTS` before doing anything else:
- `--reset-phase-numbers` flag → opt into restarting roadmap phase numbering at `1`
- remaining text → use as milestone name if present

### Define Agent Types

Register all agent types needed by this workflow. Read the agent definition file
for each and pass its contents as the system prompt:

```
# Read agent definitions
view_file("agents/gsd-project-researcher.md")
view_file("agents/gsd-research-synthesizer.md")
view_file("agents/gsd-roadmapper.md")

# Define agent types (once per conversation)
define_subagent(
  name: "gsd-project-researcher",
  description: "Researches project-level technical decisions across stack, features, architecture, and pitfalls",
  system_prompt: <contents of agents/gsd-project-researcher.md>,
  enable_write_tools: true,
  enable_mcp_tools: true
)

define_subagent(
  name: "gsd-research-synthesizer",
  description: "Synthesizes findings from parallel research agents into a unified summary",
  system_prompt: <contents of agents/gsd-research-synthesizer.md>,
  enable_write_tools: true,
  enable_mcp_tools: true
)

define_subagent(
  name: "gsd-roadmapper",
  description: "Creates phased execution roadmaps from requirements and research",
  system_prompt: <contents of agents/gsd-roadmapper.md>,
  enable_write_tools: true,
  enable_mcp_tools: true
)
```

## Process

Follow the workflow in `get-shit-done/workflows/new-milestone.md` with these Antigravity adaptations:

### Steps 1-3.5: Load Context, Gather Goals, Version, Verify Understanding

Follow `new-milestone.md` steps 1-3.5, applying these translations:

- Replace all `gsd_run query` calls → `call_mcp_tool("gsd-guardian", ...)` per the runtime reference
- Replace all `AskUserQuestion` → `ask_question` per the runtime reference
- Replace `git init` → `run_command(CommandLine: "git init", Cwd: "<project_path>")`

**Seed scanning (Step 2.5):** Use `run_command` to check `.planning/seeds/`:
```
run_command(CommandLine: "ls .planning/seeds/SEED-*.md 2>/dev/null", Cwd: "<project_path>")
```

If matching seeds found, use `ask_question` to present them:
```
ask_question(
  questions: [
    {
      question: "These planted seeds match your milestone goals. Include any in this milestone's scope?",
      is_multi_select: true,
      options: [
        "SEED-001: <idea> (trigger: <trigger_when>)",
        "SEED-003: <idea> (trigger: <trigger_when>)",
        "None — skip seeds for this milestone"
      ]
    }
  ]
)
```

**Milestone understanding confirmation (Step 3.5):**
```
ask_question(
  questions: [
    {
      question: "Does this capture what you want to build in this milestone?",
      is_multi_select: false,
      options: [
        "Looks good",
        "Adjust — let me correct or add details"
      ]
    }
  ]
)
```

### Steps 4-6: Update PROJECT.md, STATE.md, Cleanup and Commit

Follow `new-milestone.md` steps 4-6.

**STATE.md update via MCP (Step 5):**
```
call_mcp_tool(
  ServerName: "gsd-guardian",
  ToolName: "state_milestone_switch",
  Arguments: { "milestone": "v[X.Y]", "name": "[Name]" }
)
```

**Phase cleanup via MCP (Step 6):**
```
call_mcp_tool(
  ServerName: "gsd-guardian",
  ToolName: "phases_clear",
  Arguments: { "confirm": true }
)
```

**Commit via MCP (Step 6):**
```
call_mcp_tool(
  ServerName: "gsd-guardian",
  ToolName: "commit",
  Arguments: { "message": "docs: start milestone v[X.Y] [Name]", "files": [".planning/PROJECT.md", ".planning/STATE.md"] }
)
```

### Step 7: Load Context and Resolve Models

```
call_mcp_tool(
  ServerName: "gsd-guardian",
  ToolName: "init_new_milestone"
)
```

Extract from init JSON: `researcher_model`, `synthesizer_model`, `roadmapper_model`,
`commit_docs`, `research_enabled`, `current_milestone`.

### Step 7.5: Reset-Phase Safety (only when `--reset-phase-numbers`)

If `--reset-phase-numbers` is active and `phase_dir_count > 0`:
```
run_command(
  CommandLine: "mkdir -p <phase_archive_path> && find .planning/phases -mindepth 1 -maxdepth 1 -type d -exec mv {} <phase_archive_path>/ \\;",
  Cwd: "<project_path>"
)
```

### Step 8: Research Decision — USE ask_question

```
ask_question(
  questions: [
    {
      question: "Research the domain ecosystem for new features before defining requirements?",
      is_multi_select: false,
      options: [
        "Research first (Recommended) — Discover patterns, features, architecture for NEW capabilities",
        "Skip research for this milestone — Go straight to requirements"
      ]
    }
  ]
)
```

### Step 8 (continued): Research — MUST SPAWN SUBAGENTS

> [!CAUTION]
> **ENFORCEMENT: SUBAGENT SPAWN MANDATORY**
> This step REQUIRES spawning 4 parallel `gsd-project-researcher` subagents.
> Do NOT research inline. Do NOT skip the spawn.

If user chose "Research first":

```
run_command(CommandLine: "mkdir -p .planning/research", Cwd: "<project_path>")
```

```
invoke_subagent(
  Subagents: [
    {
      TypeName: "gsd-project-researcher",
      Role: "Stack Researcher",
      Prompt: "<research_type>Project Research — Stack for [new features].</research_type>\n<milestone_context>\nSUBSEQUENT MILESTONE — Adding [target features] to existing app.\n[EXISTING_CONTEXT]\nFocus ONLY on what's needed for the NEW features.\n</milestone_context>\n<question>What stack additions/changes are needed for [new features]?</question>\n<files_to_read>.planning/PROJECT.md</files_to_read>\n<output>Write to: .planning/research/STACK.md</output>",
      Workspace: "branch"
    },
    {
      TypeName: "gsd-project-researcher",
      Role: "Features Researcher",
      Prompt: "<research_type>Project Research — Features for [new features].</research_type>\n<milestone_context>\nSUBSEQUENT MILESTONE — Adding [target features] to existing app.\n[EXISTING_CONTEXT]\nFocus ONLY on what's needed for the NEW features.\n</milestone_context>\n<question>How do [target features] typically work? Expected behavior?</question>\n<files_to_read>.planning/PROJECT.md</files_to_read>\n<output>Write to: .planning/research/FEATURES.md</output>",
      Workspace: "branch"
    },
    {
      TypeName: "gsd-project-researcher",
      Role: "Architecture Researcher",
      Prompt: "<research_type>Project Research — Architecture for [new features].</research_type>\n<milestone_context>\nSUBSEQUENT MILESTONE — Adding [target features] to existing app.\n[EXISTING_CONTEXT]\nFocus ONLY on what's needed for the NEW features.\n</milestone_context>\n<question>How do [target features] integrate with existing architecture?</question>\n<files_to_read>.planning/PROJECT.md</files_to_read>\n<output>Write to: .planning/research/ARCHITECTURE.md</output>",
      Workspace: "branch"
    },
    {
      TypeName: "gsd-project-researcher",
      Role: "Pitfalls Researcher",
      Prompt: "<research_type>Project Research — Pitfalls for [new features].</research_type>\n<milestone_context>\nSUBSEQUENT MILESTONE — Adding [target features] to existing app.\nFocus on common mistakes when ADDING these features to existing system.\n</milestone_context>\n<question>Common mistakes when adding [target features] to [domain]?</question>\n<files_to_read>.planning/PROJECT.md</files_to_read>\n<output>Write to: .planning/research/PITFALLS.md</output>",
      Workspace: "branch"
    }
  ]
)
```

**WAIT for all 4 researchers to complete.** Do NOT proceed until notified.

> [!CAUTION]
> **ENFORCEMENT CHECKPOINT:** After all researchers complete, run:
> ```bash
> bash get-shit-done/scripts/enforce-subagent-spawn.sh "gsd-project-researcher"
> ```
> Proceed ONLY if exit code is 0.

Then spawn synthesizer:

```
invoke_subagent(
  Subagents: [{
    TypeName: "gsd-research-synthesizer",
    Role: "Research Synthesizer",
    Prompt: "<task>Synthesize research outputs into SUMMARY.md</task>\n<files_to_read>.planning/research/STACK.md, .planning/research/FEATURES.md, .planning/research/ARCHITECTURE.md, .planning/research/PITFALLS.md</files_to_read>\n<output>Write to: .planning/research/SUMMARY.md</output>",
    Workspace: "inherit"
  }]
)
```

**WAIT for synthesizer to complete.**

### Step 9: Define Requirements

Follow `new-milestone.md` step 9, using `ask_question` for all user interactions.

**Category scoping via ask_question (multiSelect):**
```
ask_question(
  questions: [
    {
      question: "[Category 1] — Select features for this milestone",
      is_multi_select: true,
      options: [
        "[Feature 1] — [brief description]",
        "[Feature 2] — [brief description]",
        "None for this milestone — Defer entire category"
      ]
    }
  ]
)
```

**Gap identification:**
```
ask_question(
  questions: [
    {
      question: "Any requirements missing from research findings?",
      is_multi_select: false,
      options: [
        "No, research covered it",
        "Yes, let me add some"
      ]
    }
  ]
)
```

**Commit requirements via MCP:**
```
call_mcp_tool(
  ServerName: "gsd-guardian",
  ToolName: "commit",
  Arguments: { "message": "docs: define milestone v[X.Y] requirements", "files": [".planning/REQUIREMENTS.md"] }
)
```

### Step 10: Roadmap — MUST SPAWN SUBAGENT

> [!CAUTION]
> **ENFORCEMENT: SUBAGENT SPAWN MANDATORY**
> This step REQUIRES spawning a `gsd-roadmapper` subagent.
> Do NOT create the roadmap inline.

```
invoke_subagent(
  Subagents: [{
    TypeName: "gsd-roadmapper",
    Role: "Roadmap Creator",
    Prompt: "<planning_context>\n<files_to_read>.planning/PROJECT.md, .planning/REQUIREMENTS.md, .planning/research/SUMMARY.md, .planning/config.json, .planning/MILESTONES.md</files_to_read>\n</planning_context>\n<instructions>\nCreate roadmap for milestone v[X.Y]:\n1. Respect the selected numbering mode:\n   - --reset-phase-numbers → start at Phase 1\n   - default → continue from previous milestone's last phase number\n2. Derive phases from THIS MILESTONE's requirements only\n3. Map every requirement to exactly one phase\n4. Derive 2-5 success criteria per phase (observable user behaviors)\n5. Validate 100% coverage\n6. Write files immediately (ROADMAP.md, STATE.md, update REQUIREMENTS.md traceability)\n7. Return ROADMAP CREATED with summary\n</instructions>",
    Workspace: "inherit"
  }]
)
```

**WAIT for roadmapper to complete.**

> [!CAUTION]
> **ENFORCEMENT CHECKPOINT:** After roadmapper completes, run:
> ```bash
> bash get-shit-done/scripts/enforce-subagent-spawn.sh "gsd-roadmapper"
> ```

Handle roadmapper return per `new-milestone.md` step 10:

**If `## ROADMAP BLOCKED`:** Present blocker, work with user, re-spawn.

**If `## ROADMAP CREATED`:** Present inline, then ask for approval:

```
ask_question(
  questions: [
    {
      question: "Approve the proposed roadmap?",
      is_multi_select: false,
      options: [
        "Approve — Commit and continue",
        "Adjust phases — Tell me what to change",
        "Review full file — Show raw ROADMAP.md"
      ]
    }
  ]
)
```

**Commit roadmap via MCP (after approval):**
```
call_mcp_tool(
  ServerName: "gsd-guardian",
  ToolName: "commit",
  Arguments: {
    "message": "docs: create milestone v[X.Y] roadmap ([N] phases)",
    "files": [".planning/ROADMAP.md", ".planning/STATE.md", ".planning/REQUIREMENTS.md"]
  }
)
```

### Step 10.5: Link Pending Todos to Roadmap Phases

After roadmap approval, scan pending todos:
```
run_command(CommandLine: "ls .planning/todos/pending/*.md 2>/dev/null | head -50", Cwd: "<project_path>")
```

If matching todos found, update their YAML frontmatter with `resolves_phase: N` and commit via MCP.

### Step 11: Done

Present completion summary and direct user to next workflow:
`gsd-discuss-phase [N]` (the next step in the pipeline).

## Enforcement Summary

| Checkpoint | What it verifies | When to run |
|---|---|---|
| `enforce-file-read.sh "antigravity-runtime.md"` | Runtime reference was read | After Required Reading |
| `enforce-subagent-spawn.sh "gsd-project-researcher"` | 4 researchers were spawned | After step 8 research |
| `enforce-subagent-spawn.sh "gsd-roadmapper"` | Roadmapper was spawned | After step 10 |
| `enforce-mcp-usage.sh "init_new_milestone"` | MCP server used (not raw CLI) | After initialization |

## Success Criteria

- [ ] PROJECT.md updated with Current Milestone section → **committed via MCP**
- [ ] STATE.md reset for new milestone via `state_milestone_switch` → **committed via MCP**
- [ ] MILESTONE-CONTEXT.md consumed and deleted (if existed)
- [ ] Seeds scanned and matching seeds presented to user (if any exist)
- [ ] Milestone version determined and confirmed with user (via `ask_question`)
- [ ] Milestone understanding verified with user before writing files (via `ask_question`)
- [ ] 4 parallel research subagents spawned (if research selected) → **verified by enforcement script**
- [ ] Research synthesizer subagent spawned → **verified by enforcement script**
- [ ] Requirements gathered and scoped per category (via `ask_question`, not improvised)
- [ ] REQUIREMENTS.md created with REQ-IDs → **committed via MCP**
- [ ] gsd-roadmapper subagent spawned → **verified by enforcement script**
- [ ] ROADMAP.md, STATE.md created → **committed via MCP**
- [ ] Phase numbering mode respected (continued or reset)
- [ ] Pending todos scanned for phase matches; matched todos tagged with `resolves_phase: N`
- [ ] User directed to `gsd-discuss-phase [N]`
