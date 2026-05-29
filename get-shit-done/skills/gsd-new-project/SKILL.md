---
name: gsd-new-project
description: |
  Initialize a new GSD project through questioning, research, requirements, and roadmap.
  Use when the user wants to start a new project, says "new project", or invokes /gsd:new-project.
  This is the entry point of the GSD workflow pipeline. ALWAYS spawns subagents for research
  and roadmap creation — never inlines agent work.
allowed-tools: view_file run_command call_mcp_tool invoke_subagent define_subagent send_message ask_question grep_search list_dir write_to_file replace_file_content multi_replace_file_content schedule manage_subagents manage_task
metadata:
  author: opengsd
  version: "2.0.0-antigravity"
  runtime: antigravity
  pipeline_position: 1
  next_workflow: gsd-new-milestone
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

Initialize the project state via the `gsd-guardian` MCP server:

```
call_mcp_tool(
  ServerName: "gsd-guardian",
  ToolName: "init_new_project"
)
```

Parse the response JSON for: `researcher_model`, `synthesizer_model`, `roadmapper_model`,
`commit_docs`, `project_exists`, `has_codebase_map`, `planning_exists`, `has_existing_code`,
`has_package_file`, `is_brownfield`, `needs_codebase_map`, `has_git`, `project_path`,
`agents_installed`, `missing_agents`.

**If `project_exists` is true:** Error — project already initialized. Direct user to `/gsd:progress`.

### Define agent types

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

Follow the workflow in `get-shit-done/workflows/new-project.md` with these Antigravity adaptations:

### Step 1-4: Setup, Brownfield, Questioning, PROJECT.md

Follow `new-project.md` steps 1-4, applying these translations:

- Replace all `gsd_run query` calls → `call_mcp_tool("gsd-guardian", ...)` per the runtime reference
- Replace all `AskUserQuestion` → `ask_question` per the runtime reference
- Replace `git init` → `run_command(CommandLine: "git init", Cwd: "<project_path>")`
- Replace `mkdir -p .planning` → `run_command(CommandLine: "mkdir -p .planning", Cwd: "<project_path>")`

### Step 5: Workflow Preferences

Use `ask_question` for all configuration collection:

```
ask_question(
  questions: [
    {
      question: "How do you want to work?",
      is_multi_select: false,
      options: [
        "(Recommended) YOLO — Auto-approve, just execute",
        "Interactive — Confirm at each step"
      ]
    },
    {
      question: "How finely should scope be sliced into phases?",
      is_multi_select: false,
      options: [
        "(Recommended) Coarse — Fewer, broader phases (3-5 phases, 1-3 plans each)",
        "Standard — Balanced phase size (5-8 phases, 3-5 plans each)",
        "Fine — Many focused phases (8-12 phases, 5-10 plans each)"
      ]
    },
    {
      question: "Run plans in parallel?",
      is_multi_select: false,
      options: [
        "(Recommended) Parallel — Independent plans run simultaneously",
        "Sequential — One plan at a time"
      ]
    },
    {
      question: "Commit planning docs to git?",
      is_multi_select: false,
      options: [
        "(Recommended) Yes — Planning docs tracked in version control",
        "No — Keep .planning/ local-only"
      ]
    }
  ]
)
```

Save config via MCP:
```
call_mcp_tool(
  ServerName: "gsd-guardian",
  ToolName: "config_new_project",
  Arguments: { <collected config values> }
)
```

### Step 6: Research — MUST SPAWN SUBAGENTS

> [!CAUTION]
> **ENFORCEMENT: SUBAGENT SPAWN MANDATORY**
> This step REQUIRES spawning 4 parallel `gsd-project-researcher` subagents.
> Do NOT research inline. Do NOT skip the spawn.

If user chose "Research first":

```
invoke_subagent(
  Subagents: [
    {
      TypeName: "gsd-project-researcher",
      Role: "Stack Researcher",
      Prompt: "<research_type>Stack dimension for [domain]</research_type>\n<question>What's the standard 2025 stack for [domain]?</question>\n<files_to_read>.planning/PROJECT.md</files_to_read>\n<output>Write to: .planning/research/STACK.md</output>",
      Workspace: "branch"
    },
    {
      TypeName: "gsd-project-researcher",
      Role: "Features Researcher",
      Prompt: "<research_type>Features dimension for [domain]</research_type>\n<question>What features do [domain] products have?</question>\n<files_to_read>.planning/PROJECT.md</files_to_read>\n<output>Write to: .planning/research/FEATURES.md</output>",
      Workspace: "branch"
    },
    {
      TypeName: "gsd-project-researcher",
      Role: "Architecture Researcher",
      Prompt: "<research_type>Architecture dimension for [domain]</research_type>\n<question>How are [domain] systems typically structured?</question>\n<files_to_read>.planning/PROJECT.md</files_to_read>\n<output>Write to: .planning/research/ARCHITECTURE.md</output>",
      Workspace: "branch"
    },
    {
      TypeName: "gsd-project-researcher",
      Role: "Pitfalls Researcher",
      Prompt: "<research_type>Pitfalls dimension for [domain]</research_type>\n<question>What do [domain] projects commonly get wrong?</question>\n<files_to_read>.planning/PROJECT.md</files_to_read>\n<output>Write to: .planning/research/PITFALLS.md</output>",
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

### Step 7: Requirements

Follow `new-project.md` step 7, using `ask_question` for all user interactions.
Use `call_mcp_tool("gsd-guardian", "commit", ...)` for commits.

### Step 8: Roadmap — MUST SPAWN SUBAGENT

> [!CAUTION]
> **ENFORCEMENT: SUBAGENT SPAWN MANDATORY**
> This step REQUIRES spawning a `gsd-roadmapper` subagent.
> Do NOT create the roadmap inline.

```
invoke_subagent(
  Subagents: [{
    TypeName: "gsd-roadmapper",
    Role: "Roadmap Creator",
    Prompt: "<planning_context>\n<files_to_read>.planning/PROJECT.md, .planning/REQUIREMENTS.md, .planning/research/SUMMARY.md, .planning/config.json</files_to_read>\n</planning_context>\n<instructions>Create roadmap: derive phases from requirements, map every v1 requirement to exactly one phase, derive 2-5 success criteria per phase. Write ROADMAP.md, STATE.md, update REQUIREMENTS.md traceability.</instructions>",
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

Handle roadmapper return per `new-project.md` step 8.

### Step 9: Done

Present completion summary and direct user to next workflow:
`gsd-discuss-phase 1` (the next step in the pipeline).

## Enforcement Summary

| Checkpoint | What it verifies | When to run |
|---|---|---|
| `enforce-file-read.sh "antigravity-runtime.md"` | Runtime reference was read | After step 0 |
| `enforce-subagent-spawn.sh "gsd-project-researcher"` | 4 researchers were spawned | After step 6 |
| `enforce-subagent-spawn.sh "gsd-roadmapper"` | Roadmapper was spawned | After step 8 |
| `enforce-mcp-usage.sh "init_new_project"` | MCP server used (not raw CLI) | After initialization |

## Success Criteria

- [ ] `.planning/` directory created
- [ ] Git repo initialized (if needed)
- [ ] Deep questioning completed (via `ask_question`, not improvised)
- [ ] PROJECT.md captures full context → **committed via MCP**
- [ ] config.json has workflow settings → **committed via MCP**
- [ ] 4 parallel research subagents spawned (if research selected) → **verified by enforcement script**
- [ ] Research synthesizer subagent spawned → **verified by enforcement script**
- [ ] REQUIREMENTS.md created with REQ-IDs → **committed via MCP**
- [ ] gsd-roadmapper subagent spawned → **verified by enforcement script**
- [ ] ROADMAP.md, STATE.md created → **committed via MCP**
- [ ] User directed to `gsd-discuss-phase 1`
