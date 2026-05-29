# Antigravity Agent Definition Registry

> **MANDATORY:** Before spawning any GSD agent, check this registry for the correct
> `define_subagent` specification. Agent types MUST be defined before first use in a conversation.

## How to Use This Registry

### Step 1: Read the agent definition file

```
view_file(AbsolutePath: "<project_root>/agents/<agent_type>.md")
```

### Step 2: Define the agent type (once per conversation)

```
define_subagent(
  name: "<agent_type>",
  description: "<from description field below>",
  system_prompt: <full contents of agent .md file>,
  enable_write_tools: <from table below>,
  enable_mcp_tools: <from table below>,
  enable_subagent_tools: <from table below>
)
```

### Step 3: Invoke

```
invoke_subagent(
  Subagents: [{
    TypeName: "<agent_type>",
    Role: "<descriptive role for this instance>",
    Prompt: "<task-specific prompt>",
    Workspace: "<from table below>"
  }]
)
```

---

## Core Pipeline Agents

These agents are used by the 8 priority workflows.

| Agent Type | Description | write | mcp | subagent | Workspace | Used By |
|---|---|---|---|---|---|---|
| `gsd-project-researcher` | Researches domain ecosystem (stack, features, arch, pitfalls) | ✅ | ✅ | ❌ | `branch` | new-project, new-milestone |
| `gsd-research-synthesizer` | Synthesizes parallel research outputs into SUMMARY.md | ✅ | ✅ | ❌ | `inherit` | new-project, new-milestone |
| `gsd-roadmapper` | Creates phased roadmaps from requirements/research | ✅ | ✅ | ❌ | `inherit` | new-project, new-milestone |
| `gsd-phase-researcher` | Researches implementation approach before planning | ✅ | ✅ | ❌ | `branch` | plan-phase |
| `gsd-pattern-mapper` | Analyzes codebase for existing patterns (read-only) | ✅ | ✅ | ❌ | `branch` | plan-phase (optional) |
| `gsd-planner` | Creates executable plans with task breakdown | ✅ | ✅ | ❌ | `inherit` | plan-phase, verify-work |
| `gsd-plan-checker` | Verifies plans achieve phase goal | ✅ | ✅ | ❌ | `inherit` | plan-phase, verify-work |
| `gsd-executor` | Executes plans with atomic commits | ✅ | ✅ | ❌ | `branch` | execute-phase |
| `gsd-verifier` | Verifies phase goal achievement | ✅ | ✅ | ❌ | `inherit` | execute-phase, verify-work |
| `gsd-integration-checker` | Verifies cross-phase integration | ✅ | ✅ | ❌ | `inherit` | execute-phase |
| `gsd-nyquist-auditor` | Fills validation test gaps | ✅ | ✅ | ❌ | `inherit` | validate-phase |
| `gsd-code-reviewer` | Reviews code for bugs and quality | ✅ | ✅ | ❌ | `inherit` | ship (optional) |

---

## Extended Agents

These agents are used by non-priority workflows. Define them as needed.

| Agent Type | Description | Used By |
|---|---|---|
| `gsd-advisor-researcher` | Research advisor for discuss-phase | discuss-phase (advisor mode) |
| `gsd-ai-researcher` | AI framework documentation research | ai-integration-phase |
| `gsd-assumptions-analyzer` | Analyzes codebase assumptions | discuss-phase (assumptions mode) |
| `gsd-code-fixer` | Applies code review fixes | code-review --fix |
| `gsd-codebase-mapper` | Maps existing codebase architecture | map-codebase |
| `gsd-debug-session-manager` | Manages debug sessions | debug |
| `gsd-debugger` | Investigates bugs scientifically | debug |
| `gsd-doc-classifier` | Classifies planning documents | ingest-docs |
| `gsd-doc-synthesizer` | Synthesizes classified docs | ingest-docs |
| `gsd-doc-verifier` | Verifies doc claims against code | docs |
| `gsd-doc-writer` | Writes project documentation | docs |
| `gsd-domain-researcher` | Research business domain context | ai-integration-phase |
| `gsd-eval-auditor` | Audits AI evaluation coverage | eval-review |
| `gsd-eval-planner` | Designs evaluation strategy | ai-integration-phase |
| `gsd-framework-selector` | AI framework selection matrix | ai-integration-phase |
| `gsd-intel-updater` | Writes codebase intel files | intel |
| `gsd-security-auditor` | Verifies security threat mitigations | secure-phase |
| `gsd-ui-auditor` | Visual audit of frontend | ui-review |
| `gsd-ui-checker` | Validates UI design contracts | ui-phase |
| `gsd-ui-researcher` | Produces UI design specs | ui-phase |
| `gsd-user-profiler` | Analyzes developer behavior | profile |

---

## Translation Notes

### Claude Code → Antigravity Frontmatter Mapping

Claude Code agent `.md` files have YAML frontmatter with fields that don't exist in Antigravity:

| Claude Code Field | Antigravity Equivalent | Action |
|---|---|---|
| `name:` | `define_subagent(name: ...)` | Use as TypeName |
| `description:` | `define_subagent(description: ...)` | Use directly |
| `tools: Read, Write, Edit, Bash, Grep, Glob` | `enable_write_tools: true` | All write tools |
| `tools: Read, Grep, Glob` | `enable_write_tools: false` | Read-only |
| `tools: ..., mcp__context7__*` | `enable_mcp_tools: true` | Enable MCP |
| `color:` | N/A | Ignored |
| `hooks:` | N/A | Ignored (Antigravity has no PostToolUse hooks) |

### `@file` References in Agent Definitions

Many agent `.md` files contain `@~/.claude/get-shit-done/references/...` references.
In Antigravity, these are NOT auto-expanded. Instead:

1. The orchestrator reads the referenced files via `view_file`
2. The contents are included in the `system_prompt` passed to `define_subagent`
3. OR the subagent prompt instructs it to `view_file` the reference file itself

**Recommended approach:** Include critical references in `system_prompt`, and tell the subagent
to `view_file` optional/large references from disk.

### Model Mapping

Claude Code agent spawning uses `model` parameter. In Antigravity:
- `define_subagent` does not accept a model parameter
- The model is inherited from the parent or configured at the platform level
- Use `call_mcp_tool("gsd-guardian", "resolve_model", ...)` to get the configured model name
  for logging/display purposes, but actual model selection is platform-managed

---

## Batch Definition Pattern

For workflows that spawn multiple agent types, define them all at initialization:

```
// Read all needed agent definitions
view_file("agents/gsd-project-researcher.md")
view_file("agents/gsd-research-synthesizer.md")
view_file("agents/gsd-roadmapper.md")

// Define all types
define_subagent(name: "gsd-project-researcher", ...)
define_subagent(name: "gsd-research-synthesizer", ...)
define_subagent(name: "gsd-roadmapper", ...)

// Then invoke as needed throughout the workflow
invoke_subagent(Subagents: [{TypeName: "gsd-project-researcher", ...}])
```
