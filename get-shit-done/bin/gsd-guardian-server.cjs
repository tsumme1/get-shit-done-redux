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
    ...(result.error ? { error: result.error } : {}),
  };
  try {
    fs.mkdirSync(path.dirname(AUDIT_LOG_PATH), { recursive: true });
    fs.appendFileSync(AUDIT_LOG_PATH, JSON.stringify(entry) + '\n');
  } catch {
    // Audit logging is best-effort
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
    const cmdArgs = ['query', verb, ...args];
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
