#!/usr/bin/env node
/**
 * gsd-guardian MCP Server
 * 
 * MCP server that wraps gsd-tools.cjs query commands with validation,
 * audit logging, and enforcement. This is the ONLY authorized interface
 * for Antigravity agents to interact with GSD tooling.
 * 
 * Architecture:
 * - Runs as an MCP server process (stdio transport)
 * - Delegates to gsd-tools.cjs for actual operations
 * - Adds validation layer before each operation
 * - Logs all calls for enforcement audit trail
 * - Returns structured JSON responses
 * 
 * Installation:
 * Add to mcp_config.json:
 * {
 *   "mcpServers": {
 *     "gsd-guardian": {
 *       "command": "node",
 *       "args": ["<path-to>/get-shit-done/bin/gsd-guardian-server.cjs"],
 *       "env": {
 *         "GSD_PROJECT_ROOT": "<project-root>"
 *       }
 *     }
 *   }
 * }
 */

'use strict';

const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const readline = require('node:readline');

// --- Configuration ---
const PROJECT_ROOT = process.env.GSD_PROJECT_ROOT || process.cwd();
const GSD_TOOLS_PATH = findGsdTools();
const AUDIT_LOG_PATH = path.join(PROJECT_ROOT, '.planning', '.gsd-audit.jsonl');
const FORCE_MODE = process.env.GSD_FORCE === 'true';

function findGsdTools() {
  const candidates = [
    path.join(PROJECT_ROOT, 'get-shit-done', 'bin', 'gsd-tools.cjs'),
    path.join(PROJECT_ROOT, 'node_modules', '.bin', 'gsd-tools'),
    path.join(process.env.HOME || '', '.claude', 'get-shit-done', 'bin', 'gsd-tools.cjs'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

// --- Audit Logging ---
function auditLog(toolName, args, result, durationMs) {
  const entry = {
    timestamp: new Date().toISOString(),
    tool: toolName,
    args,
    success: result.success,
    duration_ms: durationMs,
    ...(FORCE_MODE ? { force_bypass: true } : {}),
    ...(result.error ? { error: result.error } : {}),
  };
  try {
    fs.mkdirSync(path.dirname(AUDIT_LOG_PATH), { recursive: true });
    fs.appendFileSync(AUDIT_LOG_PATH, JSON.stringify(entry) + '\n');
  } catch {
    // Audit logging is best-effort
  }
}

// --- Workflow Engine ---
class WorkflowEngine {
  constructor(projectRoot) {
    this.projectRoot = projectRoot;
    this.sessionsDir = path.join(projectRoot, '.planning', '.gsd-sessions');
    this.stagesDir = path.join(__dirname, '..', 'workflows', 'stages');
    this.activeSessions = new Map();
  }

  /**
   * Start a new workflow. Returns session_id + Stage 0.
   */
  start(workflowName, args, force = false) {
    const stages = this._loadStages(workflowName);
    if (!stages) {
      return {
        nextStageNeeded: false,
        error: `Unknown workflow: ${workflowName}. Available: ${this._listWorkflows().join(', ')}`,
      };
    }

    const sessionId = this._generateId();
    const session = {
      session_id: sessionId,
      workflow: workflowName,
      args,
      force,
      current_stage: 0,
      stages_completed: [],
      started_at: new Date().toISOString(),
      status: 'active',
    };

    this.activeSessions.set(sessionId, session);
    this._persist(session);

    return this._buildStageResponse(session, stages[0], stages.length);
  }

  /**
   * Advance to next stage. Validates outputs, returns next stage or completion.
   */
  advance(sessionId, stageOutputs, force = false) {
    const session = this._restore(sessionId);
    if (!session) {
      return {
        nextStageNeeded: false,
        error: `Session not found: ${sessionId}. Start a new workflow with the 'workflow' parameter.`,
      };
    }

    if (session.status !== 'active') {
      return {
        nextStageNeeded: false,
        error: `Session ${sessionId} is ${session.status}. Start a new workflow.`,
      };
    }

    const stages = this._loadStages(session.workflow);
    if (!stages) {
      return { nextStageNeeded: false, error: `Workflow ${session.workflow} stages not found.` };
    }

    const currentStage = stages[session.current_stage];
    if (!currentStage) {
      return { nextStageNeeded: false, error: 'No current stage found.' };
    }

    // Validate outputs
    const sessionForce = force || session.force;
    if (!sessionForce) {
      const validation = this._validateOutputs(currentStage, stageOutputs);
      if (!validation.valid) {
        // Return same stage with validation error
        return {
          session_id: sessionId,
          workflow: session.workflow,
          nextStageNeeded: true,
          stage: this._formatStage(currentStage, stages.length),
          validation_error: {
            missing_outputs: validation.missing,
            type_errors: validation.typeErrors,
            hint: validation.hint || 'Complete the missing outputs and call gsd_workflow again.',
          },
          action: 'Stage outputs were incomplete or invalid. Complete the missing items and call gsd_workflow again with this session_id and corrected stage_outputs.',
        };
      }
    }

    // Record stage completion
    session.stages_completed.push({
      index: session.current_stage,
      name: currentStage.name,
      completed_at: new Date().toISOString(),
      outputs: stageOutputs,
    });

    // Determine next stage (may skip conditional stages)
    const nextIndex = this._nextStage(session, stages, stageOutputs);

    if (nextIndex === null || nextIndex >= stages.length) {
      // Workflow complete
      session.status = 'complete';
      session.completed_at = new Date().toISOString();
      this._persist(session);

      return {
        session_id: sessionId,
        workflow: session.workflow,
        nextStageNeeded: false,
        status: 'complete',
        summary: `Workflow '${session.workflow}' completed. ${session.stages_completed.length} stages executed.`,
        stages_completed: session.stages_completed.map((s) => s.name),
        action: 'Workflow complete. Report the summary to the user.',
      };
    }

    // Advance to next stage
    session.current_stage = nextIndex;
    this._persist(session);

    return this._buildStageResponse(session, stages[nextIndex], stages.length);
  }

  /**
   * Get current session status (for resume after context loss).
   */
  status(sessionId) {
    const session = this._restore(sessionId);
    if (!session) {
      return {
        nextStageNeeded: false,
        error: `Session not found: ${sessionId}`,
      };
    }

    if (session.status !== 'active') {
      return {
        session_id: sessionId,
        workflow: session.workflow,
        nextStageNeeded: false,
        status: session.status,
        summary: `Workflow '${session.workflow}' is ${session.status}.`,
        stages_completed: session.stages_completed.map((s) => s.name),
      };
    }

    // Return current stage for resume
    const stages = this._loadStages(session.workflow);
    if (!stages) {
      return { nextStageNeeded: false, error: `Workflow ${session.workflow} stages not found.` };
    }

    const currentStage = stages[session.current_stage];
    return {
      ...this._buildStageResponse(session, currentStage, stages.length),
      resumed: true,
      stages_completed: session.stages_completed.map((s) => s.name),
    };
  }

  // --- Internal Methods ---

  _buildStageResponse(session, stage, totalStages) {
    return {
      session_id: session.session_id,
      workflow: session.workflow,
      nextStageNeeded: true,
      stage: this._formatStage(stage, totalStages),
      action: `Complete the stage instructions above, then call gsd_workflow again with session_id "${session.session_id}" and your stage_outputs as a JSON string containing: ${Object.keys(stage.required_outputs || {}).join(', ') || '(no outputs required — call with stage_outputs "{}")'}.`,
    };
  }

  _formatStage(stage, totalStages) {
    return {
      index: stage.index,
      name: stage.name,
      progress: `Stage ${stage.index + 1} of ${totalStages}`,
      instructions: stage.instructions,
      required_outputs: stage.required_outputs || {},
      hints: stage.hints || {},
      ...(stage.fatal_on_fail ? { fatal_on_fail: true } : {}),
    };
  }

  _validateOutputs(stage, outputs) {
    const required = stage.required_outputs || {};
    const missing = [];
    const typeErrors = [];
    const gatedSkips = [];

    for (const [key, spec] of Object.entries(required)) {
      // Config gate: if the output has a config_gate, check whether the gate
      // is disabled in the project config. When disabled, the output becomes
      // optional — the agent can omit it without failing validation.
      if (spec.config_gate) {
        const gateValue = this._readConfigGate(spec.config_gate, spec.config_gate_default);
        if (gateValue === 'false' || gateValue === false) {
          gatedSkips.push(key);
          continue; // skip validation for this output
        }
      }

      if (outputs[key] === undefined || outputs[key] === null) {
        missing.push(key);
        continue;
      }

      // Type checking
      const expectedType = typeof spec === 'string' ? spec : spec.type;
      if (expectedType) {
        const actualType = Array.isArray(outputs[key]) ? 'array' : typeof outputs[key];
        if (expectedType !== actualType) {
          typeErrors.push(`${key}: expected ${expectedType}, got ${actualType}`);
        }
      }

      // Enum checking
      if (spec.enum && !spec.enum.includes(outputs[key])) {
        typeErrors.push(`${key}: must be one of [${spec.enum.join(', ')}], got "${outputs[key]}"`);
      }
    }

    return {
      valid: missing.length === 0 && typeErrors.length === 0,
      missing,
      typeErrors,
      gatedSkips,
      hint: missing.length > 0
        ? `Missing required outputs: ${missing.join(', ')}. Re-read the stage instructions.`
        : typeErrors.length > 0
          ? `Type errors: ${typeErrors.join('; ')}`
          : null,
    };
  }

  /**
   * Read a config gate value from .planning/config.json.
   * Resolves dot-notation keys (e.g., "workflow.security_enforcement").
   * Returns the string value or the provided default if the key is not found.
   * Lightweight sync read — no subprocess spawn, no module dependency on core.cjs.
   *
   * @param {string} key - dot-notation config key
   * @param {string} [defaultValue='true'] - default when key is missing
   * @returns {string|boolean} the config value
   */
  _readConfigGate(key, defaultValue = 'true') {
    try {
      const configPath = path.join(this.projectRoot, '.planning', 'config.json');
      const raw = fs.readFileSync(configPath, 'utf-8');
      const config = JSON.parse(raw);

      // Resolve dot-notation: "workflow.security_enforcement" → config.workflow.security_enforcement
      const parts = key.split('.');
      let current = config;
      for (const part of parts) {
        if (current === null || current === undefined || typeof current !== 'object') {
          return defaultValue;
        }
        current = current[part];
      }

      if (current === undefined || current === null) return defaultValue;
      return String(current);
    } catch {
      // Config missing or unparseable — return default (gate enabled)
      return defaultValue;
    }
  }

  _nextStage(session, stages, outputs) {
    let candidate = session.current_stage + 1;

    // Check for repeating stages (e.g., wave loop)
    const currentStage = stages[session.current_stage];
    if (currentStage.repeat_until) {
      // Evaluate repeat condition
      const condition = currentStage.repeat_until;
      let shouldRepeat = false;
      try {
        // Simple condition evaluation — checks output fields
        if (condition.output_field && condition.equals !== undefined) {
          shouldRepeat = outputs[condition.output_field] !== condition.equals;
        } else if (condition.output_field && condition.less_than !== undefined) {
          shouldRepeat = outputs[condition.output_field] < condition.less_than;
        }
      } catch {
        // If condition evaluation fails, don't repeat
      }
      if (shouldRepeat) {
        return session.current_stage; // stay on same stage
      }
    }

    // Skip conditional stages
    while (candidate < stages.length) {
      const nextStage = stages[candidate];
      if (nextStage.skip_when) {
        // Evaluate skip condition against accumulated outputs
        const allOutputs = {};
        for (const completed of session.stages_completed) {
          Object.assign(allOutputs, completed.outputs || {});
        }
        Object.assign(allOutputs, outputs || {});

        let shouldSkip = false;
        try {
          // Simple field-based skip: { "field": "value" } means skip when field === value
          if (typeof nextStage.skip_when === 'object') {
            shouldSkip = Object.entries(nextStage.skip_when).every(
              ([k, v]) => allOutputs[k] === v
            );
          }
        } catch {
          // If evaluation fails, don't skip
        }

        if (shouldSkip) {
          session.stages_completed.push({
            index: candidate,
            name: nextStage.name,
            completed_at: new Date().toISOString(),
            outputs: {},
            skipped: true,
          });
          candidate++;
          continue;
        }
      }
      break;
    }

    return candidate;
  }

  _loadStages(workflowName) {
    const filePath = path.join(this.stagesDir, `${workflowName}.stages.json`);
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const parsed = JSON.parse(content);
      return parsed.stages || [];
    } catch {
      return null;
    }
  }

  _listWorkflows() {
    try {
      return fs.readdirSync(this.stagesDir)
        .filter((f) => f.endsWith('.stages.json'))
        .map((f) => f.replace('.stages.json', ''));
    } catch {
      return [];
    }
  }

  _persist(session) {
    try {
      fs.mkdirSync(this.sessionsDir, { recursive: true });
      const filePath = path.join(this.sessionsDir, `${session.session_id}.json`);
      fs.writeFileSync(filePath, JSON.stringify(session, null, 2));
    } catch {
      // Persistence is best-effort
    }
  }

  _restore(sessionId) {
    // Check in-memory cache first
    if (this.activeSessions.has(sessionId)) {
      return this.activeSessions.get(sessionId);
    }
    // Try filesystem
    const filePath = path.join(this.sessionsDir, `${sessionId}.json`);
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const session = JSON.parse(content);
      this.activeSessions.set(sessionId, session);
      return session;
    } catch {
      return null;
    }
  }

  _generateId() {
    // Simple UUID v4-like ID
    const bytes = new Array(16);
    for (let i = 0; i < 16; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = bytes.map((b) => b.toString(16).padStart(2, '0')).join('');
    return [
      hex.slice(0, 8),
      hex.slice(8, 12),
      hex.slice(12, 16),
      hex.slice(16, 20),
      hex.slice(20, 32),
    ].join('-');
  }
}

// --- GSD Tools Wrapper ---
async function runGsdQuery(verb, args = []) {
  if (!GSD_TOOLS_PATH) {
    return {
      success: false,
      error: `gsd-tools.cjs not found. Install with: npx -y @opengsd/get-shit-done-redux@latest --claude --local`,
    };
  }

  return new Promise((resolve) => {
    const cmdArgs = [...verb.split('.'), ...args];
    const child = spawn('node', [GSD_TOOLS_PATH, ...cmdArgs], {
      cwd: PROJECT_ROOT,
      env: { ...process.env, GSD_PROJECT_ROOT: PROJECT_ROOT },
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 30000,
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => { stdout += data.toString(); });
    child.stderr.on('data', (data) => { stderr += data.toString(); });

    child.on('close', (code) => {
      // Handle @file: protocol
      if (stdout.trim().startsWith('@file:')) {
        const filePath = stdout.trim().slice(6);
        try {
          stdout = fs.readFileSync(filePath, 'utf-8');
        } catch (err) {
          resolve({ success: false, error: `Failed to read @file response: ${err.message}` });
          return;
        }
      }

      if (code === 0) {
        // Try to parse as JSON
        try {
          const parsed = JSON.parse(stdout.trim());
          resolve({ success: true, data: parsed });
        } catch {
          resolve({ success: true, data: stdout.trim() });
        }
      } else {
        resolve({ success: false, error: stderr.trim() || `Exit code ${code}`, stdout: stdout.trim() });
      }
    });

    child.on('error', (err) => {
      resolve({ success: false, error: err.message });
    });
  });
}

// --- Tool Definitions ---
const TOOLS = {
  // === Init Commands ===
  init_new_project: {
    description: 'Initialize a new GSD project. Returns project state and model configuration.',
    parameters: {},
    handler: async () => runGsdQuery('init.new-project'),
  },

  init_new_milestone: {
    description: 'Initialize a new milestone. Returns milestone state and configuration.',
    parameters: {},
    handler: async () => runGsdQuery('init.new-milestone'),
  },

  init_plan_phase: {
    description: 'Initialize the plan-phase workflow for a specific phase.',
    parameters: {
      phase: { type: 'string', description: 'Phase number (e.g., "1")', required: true },
    },
    handler: async ({ phase }) => runGsdQuery('init.plan-phase', [phase]),
  },

  init_execute_phase: {
    description: 'Initialize the execute-phase workflow for a specific phase.',
    parameters: {
      phase: { type: 'string', description: 'Phase number (e.g., "1")', required: true },
    },
    handler: async ({ phase }) => runGsdQuery('init.execute-phase', [phase]),
  },

  init_phase_op: {
    description: 'Initialize a generic phase operation (used by discuss-phase, validate-phase, etc.).',
    parameters: {
      phase: { type: 'string', description: 'Phase number', required: true },
    },
    handler: async ({ phase }) => runGsdQuery('init.phase-op', [phase]),
  },

  init_verify_work: {
    description: 'Initialize the verify-work workflow for a specific phase.',
    parameters: {
      phase: { type: 'string', description: 'Phase number', required: true },
    },
    handler: async ({ phase }) => runGsdQuery('init.verify-work', [phase]),
  },

  // === Config Commands ===
  config_new_project: {
    description: 'Create project configuration with validated settings.',
    parameters: {
      config: { type: 'string', description: 'JSON string of config values', required: true },
    },
    handler: async ({ config }) => runGsdQuery('config-new-project', [config]),
  },

  config_get: {
    description: 'Get a configuration value.',
    parameters: {
      key: { type: 'string', description: 'Config key (e.g., "workflow.research")', required: true },
      default_value: { type: 'string', description: 'Default value if key not found' },
    },
    handler: async ({ key, default_value }) => {
      const args = [key];
      if (default_value !== undefined) args.push('--default', default_value);
      return runGsdQuery('config-get', args);
    },
  },

  config_set: {
    description: 'Set a configuration value.',
    parameters: {
      key: { type: 'string', description: 'Config key', required: true },
      value: { type: 'string', description: 'Config value', required: true },
    },
    handler: async ({ key, value }) => runGsdQuery('config-set', [key, value]),
  },

  // === State Commands ===
  state_load: {
    description: 'Load the current project state from STATE.md.',
    parameters: {},
    handler: async () => runGsdQuery('state', ['load']),
  },

  state_update: {
    description: 'Update a field in STATE.md.',
    parameters: {
      key: { type: 'string', description: 'State field to update', required: true },
      value: { type: 'string', description: 'New value', required: true },
    },
    handler: async ({ key, value }) => runGsdQuery('state', ['update', key, value]),
  },

  state_begin_phase: {
    description: 'Record that a phase has started in STATE.md.',
    parameters: {
      phase: { type: 'string', description: 'Phase number', required: true },
      name: { type: 'string', description: 'Phase name', required: true },
      plans: { type: 'string', description: 'Number of plans', required: true },
    },
    handler: async ({ phase, name, plans }) =>
      runGsdQuery('state', ['begin-phase', '--phase', phase, '--name', name, '--plans', plans]),
  },

  state_planned_phase: {
    description: 'Record that a phase has been planned in STATE.md.',
    parameters: {
      phase: { type: 'string', description: 'Phase number', required: true },
      name: { type: 'string', description: 'Phase name', required: true },
      plans: { type: 'string', description: 'Number of plans', required: true },
    },
    handler: async ({ phase, name, plans }) =>
      runGsdQuery('state', ['planned-phase', '--phase', phase, '--name', name, '--plans', plans]),
  },

  state_milestone_switch: {
    description: 'Switch to a new milestone in STATE.md.',
    parameters: {
      milestone: { type: 'string', description: 'Milestone version (e.g., "v2.0")', required: true },
      name: { type: 'string', description: 'Milestone name', required: true },
    },
    handler: async ({ milestone, name }) =>
      runGsdQuery('state', ['milestone-switch', '--milestone', milestone, '--name', name]),
  },

  state_record_session: {
    description: 'Record a session stop point for resume capability.',
    parameters: {
      stopped_at: { type: 'string', description: 'Description of where work stopped', required: true },
      resume_file: { type: 'string', description: 'Path to file for resuming', required: true },
    },
    handler: async ({ stopped_at, resume_file }) =>
      runGsdQuery('state', ['record-session', '--stopped-at', stopped_at, '--resume-file', resume_file]),
  },

  // === Commit Commands ===
  commit: {
    description: 'Create a git commit with the specified message and files. Validates commit format.',
    parameters: {
      message: { type: 'string', description: 'Commit message', required: true },
      files: { type: 'string', description: 'Space-separated list of files to stage', required: true },
    },
    handler: async ({ message, files }) => {
      const fileList = files.split(/\s+/).filter(Boolean);
      return runGsdQuery('commit', [message, '--files', ...fileList]);
    },
  },

  // === Agent Skills ===
  agent_skills: {
    description: 'Get the agent skill payload for a specific agent type. Returns prompt context for subagent spawning.',
    parameters: {
      agent_type: { type: 'string', description: 'Agent type (e.g., "gsd-executor")', required: true },
    },
    handler: async ({ agent_type }) => runGsdQuery('agent-skills', [agent_type]),
  },

  // === Model Resolution ===
  resolve_model: {
    description: 'Resolve the model to use for a specific agent type based on the model profile.',
    parameters: {
      agent_type: { type: 'string', description: 'Agent type', required: true },
    },
    handler: async ({ agent_type }) => runGsdQuery('resolve-model', [agent_type, '--raw']),
  },

  // === Roadmap Commands ===
  roadmap_get_phase: {
    description: 'Get the roadmap section for a specific phase.',
    parameters: {
      phase: { type: 'number', description: 'Phase number', required: true },
    },
    handler: async ({ phase }) => runGsdQuery('roadmap', ['get-phase', String(phase)]),
  },

  roadmap_annotate_dependencies: {
    description: 'Annotate plan dependencies in the roadmap for a specific phase.',
    parameters: {
      phase: { type: 'string', description: 'Phase number', required: true },
    },
    handler: async ({ phase }) => runGsdQuery('roadmap', ['annotate-dependencies', phase]),
  },

  roadmap_update_plan_progress: {
    description: 'Update plan progress in ROADMAP.md.',
    parameters: {
      phase: { type: 'string', description: 'Phase number', required: true },
      plan: { type: 'string', description: 'Plan ID', required: true },
      status: { type: 'string', description: 'New status', required: true },
    },
    handler: async ({ phase, plan, status }) =>
      runGsdQuery('roadmap', ['update-plan-progress', phase, plan, status]),
  },

  // === Phase Commands ===
  phase_plan_index: {
    description: 'Get the plan index for a phase (plans, waves, dependencies).',
    parameters: {
      phase: { type: 'string', description: 'Phase number', required: true },
    },
    handler: async ({ phase }) => runGsdQuery('phase-plan-index', [phase]),
  },

  phase_mvp_mode: {
    description: 'Check if MVP mode is active for a phase.',
    parameters: {
      phase: { type: 'string', description: 'Phase number', required: true },
    },
    handler: async ({ phase }) => runGsdQuery('phase.mvp-mode', [phase, '--pick', 'active']),
  },

  phases_list: {
    description: 'List all phases with their status.',
    parameters: {},
    handler: async () => runGsdQuery('phases.list', ['--pick', 'summaries_total']),
  },

  phases_clear: {
    description: 'Clear all phase directories (used during milestone transitions).',
    parameters: {},
    handler: async () => runGsdQuery('phases.clear', ['--confirm']),
  },

  // === Verification Commands ===
  check_auto_mode: {
    description: 'Check if auto-chain mode is active.',
    parameters: {},
    handler: async () => runGsdQuery('check', ['auto-mode', '--pick', 'auto_chain_active']),
  },

  check_decision_coverage: {
    description: 'Check decision coverage for a plan against the context document.',
    parameters: {
      phase_dir: { type: 'string', description: 'Phase directory path', required: true },
      context_path: { type: 'string', description: 'Path to CONTEXT.md', required: true },
    },
    handler: async ({ phase_dir, context_path }) =>
      runGsdQuery('check.decision-coverage-plan', [phase_dir, context_path]),
  },

  // === Todo Commands ===
  todo_match_phase: {
    description: 'Find todos that match a specific phase.',
    parameters: {
      phase: { type: 'string', description: 'Phase number', required: true },
    },
    handler: async ({ phase }) => runGsdQuery('todo.match-phase', [phase]),
  },

  // === UAT/Audit Commands ===
  audit_open: {
    description: 'Get open audit items.',
    parameters: {},
    handler: async () => runGsdQuery('audit-open', ['--json']),
  },

  uat_render_checkpoint: {
    description: 'Render a UAT checkpoint for display.',
    parameters: {
      file: { type: 'string', description: 'Path to UAT file', required: true },
    },
    handler: async ({ file }) => runGsdQuery('uat', ['render-checkpoint', '--file', file, '--raw']),
  },

  // === Generation Commands ===
  generate_instructions_md: {
    description: 'Generate the project instruction file (AGENTS.md / CLAUDE.md).',
    parameters: {
      output: { type: 'string', description: 'Output filename (default: AGENTS.md)' },
    },
    handler: async ({ output }) => {
      const args = [];
      if (output) args.push('--output', output);
      return runGsdQuery('generate-claude-md', args);
    },
  },

  // === User Story Validation ===
  user_story_validate: {
    description: 'Validate a user story / phase goal.',
    parameters: {
      story: { type: 'string', description: 'The user story text to validate', required: true },
    },
    handler: async ({ story }) => runGsdQuery('user-story.validate', ['--story', story, '--pick', 'valid']),
  },

  // === Workflow Orchestration (sequentialthinking pattern) ===
  gsd_workflow: {
    description: 'Execute a GSD workflow stage by stage. Call this tool to start a new workflow or continue an active one. Each call returns the next stage with instructions. You MUST keep calling this tool with your completed stage outputs until it returns nextStageNeeded: false.\n\nFirst call: provide \'workflow\' and \'args\' to start.\nContinuation: provide \'session_id\' and \'stage_outputs\' from the completed stage.\nStatus check: provide only \'session_id\' to get current state without advancing.\n\nAvailable workflows: execute-phase, plan-phase, discuss-phase, verify-work, ship, complete-milestone, autonomous, execute-plan, code-review.',
    parameters: {
      workflow: {
        type: 'string',
        description: 'Workflow to start (e.g., "execute-phase", "plan-phase", "discuss-phase"). Required on first call only.',
      },
      args: {
        type: 'string',
        description: 'JSON string of workflow arguments (e.g., \'{"phase": "5"}\' ). Required on first call only.',
      },
      session_id: {
        type: 'string',
        description: 'Session ID from a previous gsd_workflow call. Required for continuation and status checks.',
      },
      stage_outputs: {
        type: 'string',
        description: 'JSON string of outputs from the completed stage (e.g., \'{"phase_name": "Auth", "plan_count": 3}\' ). Required for continuation calls.',
      },
      force: {
        type: 'boolean',
        description: 'Skip stage validation gates. Bypasses are logged for audit. Default: false.',
      },
    },
    handler: async ({ workflow, args, session_id, stage_outputs, force }) => {
      const engine = new WorkflowEngine(PROJECT_ROOT);

      // Start new workflow
      if (workflow && !session_id) {
        let parsedArgs = {};
        if (args) {
          try {
            parsedArgs = JSON.parse(args);
          } catch {
            return { success: false, error: `Invalid args JSON: ${args}` };
          }
        }
        const result = engine.start(workflow, parsedArgs, force || false);
        return { success: !result.error, data: result };
      }

      // Status check (no stage_outputs)
      if (session_id && !stage_outputs) {
        const result = engine.status(session_id);
        return { success: !result.error, data: result };
      }

      // Advance workflow
      if (session_id && stage_outputs) {
        let parsedOutputs = {};
        try {
          parsedOutputs = JSON.parse(stage_outputs);
        } catch {
          return { success: false, error: `Invalid stage_outputs JSON: ${stage_outputs}` };
        }
        const result = engine.advance(session_id, parsedOutputs, force || false);
        return { success: !result.error, data: result };
      }

      return {
        success: false,
        error: 'Provide workflow+args to start a new workflow, or session_id+stage_outputs to advance an active one.',
      };
    },
  },
};

// --- MCP Protocol Implementation (stdio) ---
class McpServer {
  constructor() {
    this.rl = readline.createInterface({ input: process.stdin });
    this.rl.on('line', (line) => this.handleMessage(line));
    process.stderr.write('[gsd-guardian] MCP server started\n');
  }

  sendResponse(id, result) {
    const response = { jsonrpc: '2.0', id, result };
    process.stdout.write(JSON.stringify(response) + '\n');
  }

  sendError(id, code, message) {
    const response = { jsonrpc: '2.0', id, error: { code, message } };
    process.stdout.write(JSON.stringify(response) + '\n');
  }

  async handleMessage(line) {
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      return;
    }

    const { id, method, params } = msg;

    switch (method) {
      case 'initialize':
        this.sendResponse(id, {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: {
            name: 'gsd-guardian',
            version: '2.0.0',
          },
        });
        break;

      case 'notifications/initialized':
        // No response needed
        break;

      case 'tools/list':
        this.sendResponse(id, {
          tools: Object.entries(TOOLS).map(([name, def]) => ({
            name,
            description: def.description,
            inputSchema: {
              type: 'object',
              properties: Object.fromEntries(
                Object.entries(def.parameters).map(([pName, pDef]) => [
                  pName,
                  { type: pDef.type, description: pDef.description },
                ])
              ),
              required: Object.entries(def.parameters)
                .filter(([, pDef]) => pDef.required)
                .map(([pName]) => pName),
            },
          })),
        });
        break;

      case 'tools/call': {
        const toolName = params?.name;
        const toolArgs = params?.arguments || {};
        const toolDef = TOOLS[toolName];

        if (!toolDef) {
          this.sendError(id, -32601, `Unknown tool: ${toolName}`);
          return;
        }

        const startTime = Date.now();
        try {
          const result = await toolDef.handler(toolArgs);
          const durationMs = Date.now() - startTime;
          auditLog(toolName, toolArgs, result, durationMs);

          if (result.success) {
            this.sendResponse(id, {
              content: [
                {
                  type: 'text',
                  text: typeof result.data === 'string'
                    ? result.data
                    : JSON.stringify(result.data, null, 2),
                },
              ],
            });
          } else {
            this.sendResponse(id, {
              content: [
                { type: 'text', text: `Error: ${result.error}` },
              ],
              isError: true,
            });
          }
        } catch (err) {
          const durationMs = Date.now() - startTime;
          auditLog(toolName, toolArgs, { success: false, error: err.message }, durationMs);
          this.sendError(id, -32603, `Tool execution failed: ${err.message}`);
        }
        break;
      }

      default:
        if (id !== undefined) {
          this.sendError(id, -32601, `Method not found: ${method}`);
        }
    }
  }
}

// --- Entry Point ---
new McpServer();
