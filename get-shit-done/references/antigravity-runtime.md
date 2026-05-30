# Antigravity 2.0 Runtime Reference

> **MANDATORY:** Read this reference before executing ANY GSD workflow on the Antigravity runtime.
> Every tool call and agent spawn in this runtime has an exact equivalent — do NOT improvise.

## Tool Name Mapping

These are 1:1 translations. Use the EXACT Antigravity tool name — never the Claude Code name.

| Claude Code | Antigravity 2.0 | Notes |
|---|---|---|
| `Agent(subagent_type="gsd-X", prompt=..., model=...)` | `define_subagent` + `invoke_subagent` | See §Agent Spawning below |
| `Agent(..., isolation="worktree")` | `invoke_subagent(..., Workspace: "branch")` | Creates isolated workspace |
| `Agent(..., run_in_background: true)` | Multiple entries in `invoke_subagent` `Subagents` array | Parallel launch |
| `AskUserQuestion(question, options)` | `ask_question` | See §User Interaction below |
| `Read tool` / `cat file` | `view_file` | Must use `AbsolutePath` |
| `Write tool` | `write_to_file` (new) or `replace_file_content` (edit) | |
| `Bash tool` / `bash -c "..."` | `run_command` | Must specify `Cwd` |
| `Grep` | `grep_search` | |
| `Glob` / `find` | `list_dir` or `run_command` with `find` | |
| `@file` references in prompts | Explicit `view_file` calls | See §File References below |
| `SlashCommand("/gsd:X")` | Direct instruction text (no slash commands) | |

## Agent Spawning — MANDATORY PROTOCOL

> [!CAUTION]
> When a workflow says "spawn an agent" or shows an `Agent()` call, you MUST use
> `define_subagent` + `invoke_subagent`. You MUST NOT inline the agent's work.
> This is the #1 enforcement rule. Inlining defeats GSD's architecture.

### Step 1: Define the agent type (once per conversation)

Read the agent definition file and use its contents as the system prompt:

```
define_subagent(
  name: "gsd-executor",
  description: "Executes plan tasks, commits atomically, creates SUMMARY.md",
  system_prompt: <contents of agents/gsd-executor.md>,
  enable_write_tools: true,
  enable_mcp_tools: true
)
```

### Step 2: Invoke for each use

```
invoke_subagent(
  Subagents: [{
    TypeName: "gsd-executor",
    Role: "Phase 1 Plan 01 Executor",
    Prompt: "<constructed from workflow>",
    Workspace: "branch"    // ← equivalent to isolation="worktree"
  }]
)
```

### Parallel spawning

To spawn multiple agents in parallel (equivalent to `run_in_background: true`),
include multiple entries in the `Subagents` array:

```
invoke_subagent(
  Subagents: [
    { TypeName: "gsd-project-researcher", Role: "Stack Researcher", Prompt: "...", Workspace: "branch" },
    { TypeName: "gsd-project-researcher", Role: "Features Researcher", Prompt: "...", Workspace: "branch" },
    { TypeName: "gsd-project-researcher", Role: "Architecture Researcher", Prompt: "...", Workspace: "branch" },
    { TypeName: "gsd-project-researcher", Role: "Pitfalls Researcher", Prompt: "...", Workspace: "branch" }
  ]
)
```

### Waiting for completion

After `invoke_subagent`, the system automatically notifies you when each subagent completes.
You do NOT need to poll. Stop calling tools and wait for the message.

### Checking on subagents

```
manage_subagents(Action: "list")     // List active subagents
send_message(Recipient: "<conversationId>", Message: "...")  // Send instructions
```

### Agent type registry

These GSD agent types must be defined via `define_subagent` before first use:

| Agent Type | Definition File | enable_write_tools | enable_mcp_tools |
|---|---|---|---|
| `gsd-executor` | `agents/gsd-executor.md` | true | true |
| `gsd-verifier` | `agents/gsd-verifier.md` | true | true |
| `gsd-planner` | `agents/gsd-planner.md` | true | true |
| `gsd-phase-researcher` | `agents/gsd-phase-researcher.md` | true | true |
| `gsd-plan-checker` | `agents/gsd-plan-checker.md` | true | true |
| `gsd-project-researcher` | `agents/gsd-project-researcher.md` | true | true |
| `gsd-research-synthesizer` | `agents/gsd-research-synthesizer.md` | true | true |
| `gsd-roadmapper` | `agents/gsd-roadmapper.md` | true | true |
| `gsd-debugger` | `agents/gsd-debugger.md` | true | true |
| `gsd-codebase-mapper` | `agents/gsd-codebase-mapper.md` | true | true |
| `gsd-code-reviewer` | `agents/gsd-code-reviewer.md` | true | true |
| `gsd-code-fixer` | `agents/gsd-code-fixer.md` | true | true |
| `gsd-integration-checker` | `agents/gsd-integration-checker.md` | true | true |
| `gsd-nyquist-auditor` | `agents/gsd-nyquist-auditor.md` | true | true |
| `gsd-doc-writer` | `agents/gsd-doc-writer.md` | true | true |
| `gsd-ui-researcher` | `agents/gsd-ui-researcher.md` | true | true |
| `gsd-ui-checker` | `agents/gsd-ui-checker.md` | true | true |
| `gsd-ui-auditor` | `agents/gsd-ui-auditor.md` | true | true |

## User Interaction — `ask_question`

Replace every `AskUserQuestion` call with `ask_question`. The mapping is direct:

### Single question with options

Claude Code:
```
AskUserQuestion([{
  header: "Mode",
  question: "How do you want to work?",
  multiSelect: false,
  options: [
    { label: "YOLO (Recommended)", description: "Auto-approve, just execute" },
    { label: "Interactive", description: "Confirm at each step" }
  ]
}])
```

Antigravity:
```
ask_question(
  questions: [{
    question: "How do you want to work?",
    is_multi_select: false,
    options: [
      "(Recommended) YOLO — Auto-approve, just execute",
      "Interactive — Confirm at each step"
    ]
  }]
)
```

### Multiple questions

Claude Code batches multiple questions in one `AskUserQuestion` call.
Antigravity batches them in the `questions` array of `ask_question`.

### Text mode

When `TEXT_MODE=true` (non-interactive runtimes), `ask_question` still works in Antigravity —
it renders as an interactive modal. There is no need for a text-mode fallback.
Remove all `TEXT_MODE` branching when porting workflows.

## File References — `@file` → `view_file`

Claude Code workflows use `@~/.claude/get-shit-done/references/X.md` to auto-inject file content.
Antigravity has no `@file` expansion. You MUST read each referenced file explicitly:

```
view_file(AbsolutePath: "/path/to/get-shit-done/references/X.md")
```

### Path resolution

In Claude Code, `~/.claude/get-shit-done/` is the skill root.
In Antigravity, resolve the skill root from the project or user skill installation:

- **Project-level:** `<project>/.agents/skills/gsd/` or `<project>/.gemini/skills/gsd/`
- **User-level:** `~/.gemini/config/skills/gsd/`

Use `run_command` with `find` to locate the skill root if uncertain:
```bash
find . -path "*/get-shit-done/bin/gsd-tools.cjs" -o -path "*/.agents/skills/gsd" 2>/dev/null | head -1
```

## gsd_run / gsd-tools.cjs — MCP Server

The `gsd_run query` command-line interface is replaced by the `gsd-guardian` MCP server.
Every `gsd_run query <verb>` becomes `call_mcp_tool(ServerName: "gsd-guardian", ToolName: "<verb>")`.

| gsd_run command | MCP tool |
|---|---|
| `gsd_run query init.new-project` | `call_mcp_tool("gsd-guardian", "init_new_project")` |
| `gsd_run query init.execute-phase "N"` | `call_mcp_tool("gsd-guardian", "init_execute_phase", {phase: "N"})` |
| `gsd_run query agent-skills gsd-X` | `call_mcp_tool("gsd-guardian", "agent_skills", {agent_type: "gsd-X"})` |
| `gsd_run query resolve-model gsd-X` | `call_mcp_tool("gsd-guardian", "resolve_model", {agent_type: "gsd-X"})` |
| `gsd_run query commit "msg" --files ...` | `call_mcp_tool("gsd-guardian", "commit", {message: "msg", files: [...]})` |
| `gsd_run query config-set key value` | `call_mcp_tool("gsd-guardian", "config_set", {key: "...", value: "..."})` |
| `gsd_run query config-get key` | `call_mcp_tool("gsd-guardian", "config_get", {key: "..."})` |
| `gsd_run query config-new-project '{...}'` | `call_mcp_tool("gsd-guardian", "config_new_project", {...})` |
| `gsd_run query state.begin-phase ...` | `call_mcp_tool("gsd-guardian", "state_begin_phase", {...})` |
| `gsd_run query state.update key value` | `call_mcp_tool("gsd-guardian", "state_update", {key: "...", value: "..."})` |
| `gsd_run query phase-plan-index "N"` | `call_mcp_tool("gsd-guardian", "phase_plan_index", {phase: "N"})` |
| `gsd_run query roadmap.get-phase N` | `call_mcp_tool("gsd-guardian", "roadmap_get_phase", {phase: N})` |
| `gsd_run query generate-claude-md` | `call_mcp_tool("gsd-guardian", "generate_instructions_md")` |

> [!CAUTION]
> Do NOT fall back to `run_command` with `node gsd-tools.cjs query ...`.
> The MCP server is the ONLY authorized interface. Using `run_command` bypasses
> validation and audit logging built into the MCP server.

## Workflow Orchestration — `gsd_workflow` MCP Tool

> [!IMPORTANT]
> For multi-step workflows, use the `gsd_workflow` tool instead of reading SKILL.md files.
> The server gates progress — you call the tool in a loop and it returns one stage at a time.

### Starting a workflow

```
call_mcp_tool(
  ServerName: "gsd-guardian",
  ToolName: "gsd_workflow",
  Arguments: { workflow: "discuss-phase", args: '{"phase": "3"}' }
)
```

Returns `session_id` + first stage instructions.

### Continuing a workflow

```
call_mcp_tool(
  ServerName: "gsd-guardian",
  ToolName: "gsd_workflow",
  Arguments: { session_id: "<id>", stage_outputs: '{"phase_found": true, ...}' }
)
```

Returns next stage or `nextStageNeeded: false` when complete.

### Checking status (resume after context loss)

```
call_mcp_tool(
  ServerName: "gsd-guardian",
  ToolName: "gsd_workflow",
  Arguments: { session_id: "<id>" }
)
```

### Available workflows

| Workflow | Gates | Description |
|---|---|---|
| `discuss-phase` | 6 | Gather context through adaptive questioning |
| `plan-phase` | 10 | Create detailed phase plan with verification |
| `execute-phase` | 10 | Wave-based parallel execution with subagents |
| `execute-plan` | 8 | Single plan execution (consumed by executor subagents) |
| `verify-work` | 6 | Conversational UAT and gap closure |
| `ship` | 5 | Push, PR creation, optional review |
| `complete-milestone` | 7 | Archive, retrospective, cleanup |
| `autonomous` | 4 | Meta-workflow chaining discuss→plan→execute per phase |
| `code-review` | 7 | Scope files, spawn reviewer agent, commit REVIEW.md |

### Stage definition format

Stage files live in `get-shit-done/workflows/stages/<workflow>.stages.json`.
Each stage has:
- `index` — sequential position
- `name` — machine-readable identifier
- `instructions` — prose instructions for the agent
- `required_outputs` — typed outputs the agent must produce
- `hints` — suggested MCP tools, files to read, agents to spawn
- `fatal_on_fail` — if true, stops the workflow on failure
- `skip_when` — conditional skip based on accumulated outputs
- `repeat_until` — loop condition for wave-based execution

## Enforcement Checkpoints

After critical operations, the workflow MUST verify compliance:

### After subagent spawn
```bash
# Verify subagent was actually spawned (not inlined)
bash get-shit-done/scripts/enforce-subagent-spawn.sh "<agent_type>"
```

### After required file reads
```bash
# Verify file was actually read before proceeding
bash get-shit-done/scripts/enforce-file-read.sh "<file_path>"
```

### After script/tool execution
```bash
# Verify the MCP tool was called (not a raw run_command fallback)
bash get-shit-done/scripts/enforce-mcp-usage.sh "<tool_name>"
```

## Runtime Detection

Antigravity is identified by:
- Path contains `/.gemini/` in execution context
- Environment variable `GEMINI_CONFIG_DIR` is set
- SKILL.md loaded from `.gemini/config/skills/` or `.agents/skills/`

Set `RUNTIME=antigravity` and `INSTRUCTION_FILE=AGENTS.md` for Antigravity.

## Anti-Patterns — HARD BLOCKS

> [!CAUTION]
> These are enforcement violations. If you catch yourself doing any of these, STOP and correct.

1. **NEVER inline work that a workflow assigns to a subagent.** If the workflow says `Agent()`, use `invoke_subagent`. Period.
2. **NEVER use `run_command` to call `gsd-tools.cjs` directly.** Use the `gsd-guardian` MCP server.
3. **NEVER use generic agent types.** Use the exact `gsd-*` agent types from the registry above.
4. **NEVER read agent definition files into the orchestrator.** They auto-load into subagent system prompts via `define_subagent`.
5. **NEVER inline large files into subagent prompts.** Tell subagents to `view_file` from disk.
6. **NEVER skip enforcement checkpoints.** They exist to verify you followed the rules.
7. **NEVER use `@file` syntax.** It doesn't exist in Antigravity. Use `view_file` explicitly.
