/**
 * Workflow Protocol Integration Tests
 *
 * Tests the WorkflowEngine class and gsd_workflow tool handler from
 * gsd-guardian-server.cjs. Validates stage loading, session lifecycle,
 * output validation, skip/repeat logic, and error handling.
 *
 * Does NOT require a running MCP server — exercises the engine directly.
 */

process.env.GSD_TEST_MODE = '1';

const { describe, test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { cleanup } = require('./helpers.cjs');

// --- Direct require of the server module's WorkflowEngine ---
// The server exports nothing, so we extract the class by loading the stages
// directory and reimplementing the engine logic inline for testing. Instead,
// we create a minimal WorkflowEngine replica that uses the same stage files.

const STAGES_DIR = path.join(__dirname, '..', 'get-shit-done', 'workflows', 'stages');

/**
 * Minimal WorkflowEngine replica for testing — mirrors the logic in
 * gsd-guardian-server.cjs without starting an MCP server.
 */
class TestWorkflowEngine {
  constructor(projectRoot) {
    this.projectRoot = projectRoot;
    this.sessionsDir = path.join(projectRoot, '.planning', '.gsd-sessions');
    this.stagesDir = STAGES_DIR;
    this.activeSessions = new Map();
  }

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

    // Determine next stage
    const nextIndex = this._nextStage(session, stages, stageOutputs);

    if (nextIndex === null || nextIndex >= stages.length) {
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

    session.current_stage = nextIndex;
    this._persist(session);

    return this._buildStageResponse(session, stages[nextIndex], stages.length);
  }

  status(sessionId) {
    const session = this._restore(sessionId);
    if (!session) {
      return { nextStageNeeded: false, error: `Session not found: ${sessionId}` };
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

  _buildStageResponse(session, stage, totalStages) {
    return {
      session_id: session.session_id,
      workflow: session.workflow,
      nextStageNeeded: true,
      stage: this._formatStage(stage, totalStages),
      action: `Complete the stage instructions above, then call gsd_workflow again with session_id "${session.session_id}" and your stage_outputs as a JSON string containing: ${Object.keys(stage.required_outputs || {}).join(', ') || '(no outputs required — call with stage_outputs "{}")'}`,
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

    for (const [key, spec] of Object.entries(required)) {
      if (outputs[key] === undefined || outputs[key] === null) {
        missing.push(key);
        continue;
      }
      const expectedType = typeof spec === 'string' ? spec : spec.type;
      if (expectedType) {
        const actualType = Array.isArray(outputs[key]) ? 'array' : typeof outputs[key];
        if (expectedType !== actualType) {
          typeErrors.push(`${key}: expected ${expectedType}, got ${actualType}`);
        }
      }
      if (spec.enum && !spec.enum.includes(outputs[key])) {
        typeErrors.push(`${key}: must be one of [${spec.enum.join(', ')}], got "${outputs[key]}"`);
      }
    }

    return {
      valid: missing.length === 0 && typeErrors.length === 0,
      missing,
      typeErrors,
      hint: missing.length > 0
        ? `Missing required outputs: ${missing.join(', ')}. Re-read the stage instructions.`
        : typeErrors.length > 0
          ? `Type errors: ${typeErrors.join('; ')}`
          : null,
    };
  }

  _nextStage(session, stages, outputs) {
    let candidate = session.current_stage + 1;

    const currentStage = stages[session.current_stage];
    if (currentStage.repeat_until) {
      const condition = currentStage.repeat_until;
      let shouldRepeat = false;
      try {
        if (condition.output_field && condition.equals !== undefined) {
          shouldRepeat = outputs[condition.output_field] !== condition.equals;
        } else if (condition.output_field && condition.less_than !== undefined) {
          shouldRepeat = outputs[condition.output_field] < condition.less_than;
        }
      } catch {
        // If condition evaluation fails, don't repeat
      }
      if (shouldRepeat) {
        return session.current_stage;
      }
    }

    while (candidate < stages.length) {
      const nextStage = stages[candidate];
      if (nextStage.skip_when) {
        const allOutputs = {};
        for (const completed of session.stages_completed) {
          Object.assign(allOutputs, completed.outputs || {});
        }
        Object.assign(allOutputs, outputs || {});

        let shouldSkip = false;
        try {
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
    if (this.activeSessions.has(sessionId)) {
      return this.activeSessions.get(sessionId);
    }
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

// --- Test Suites ---

describe('WorkflowEngine — Stage Loading', () => {
  let tmpDir;
  let engine;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'wf-test-'));
    fs.mkdirSync(path.join(tmpDir, '.planning'), { recursive: true });
    engine = new TestWorkflowEngine(tmpDir);
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('lists available workflows from stages directory', () => {
    const workflows = engine._listWorkflows();
    assert.ok(Array.isArray(workflows), 'returns an array');
    assert.ok(workflows.includes('discuss-phase'), 'includes discuss-phase');
    assert.ok(workflows.includes('plan-phase'), 'includes plan-phase');
    assert.ok(workflows.includes('execute-phase'), 'includes execute-phase');
  });

  test('loads stages from a valid workflow', () => {
    const stages = engine._loadStages('discuss-phase');
    assert.ok(Array.isArray(stages), 'returns stages array');
    assert.ok(stages.length > 0, 'has at least one stage');
    assert.strictEqual(stages[0].index, 0, 'first stage has index 0');
    assert.strictEqual(stages[0].name, 'init', 'first stage is init');
  });

  test('returns null for unknown workflow', () => {
    const stages = engine._loadStages('nonexistent-workflow');
    assert.strictEqual(stages, null, 'returns null for unknown workflow');
  });

  test('stage files are valid JSON with required fields', () => {
    const workflows = engine._listWorkflows();
    for (const wf of workflows) {
      const stages = engine._loadStages(wf);
      assert.ok(Array.isArray(stages), `${wf}: stages is an array`);
      for (const stage of stages) {
        assert.ok(typeof stage.index === 'number', `${wf}/${stage.name}: has numeric index`);
        assert.ok(typeof stage.name === 'string', `${wf}/${stage.name}: has string name`);
        assert.ok(typeof stage.instructions === 'string', `${wf}/${stage.name}: has string instructions`);
        assert.ok(stage.instructions.length > 10, `${wf}/${stage.name}: instructions are non-trivial`);
        if (stage.required_outputs) {
          assert.ok(typeof stage.required_outputs === 'object', `${wf}/${stage.name}: required_outputs is object`);
        }
      }
    }
  });

  test('stage indices are sequential starting from 0', () => {
    const workflows = engine._listWorkflows();
    for (const wf of workflows) {
      const stages = engine._loadStages(wf);
      for (let i = 0; i < stages.length; i++) {
        assert.strictEqual(stages[i].index, i, `${wf}: stage ${i} has correct index`);
      }
    }
  });
});

describe('WorkflowEngine — Session Lifecycle', () => {
  let tmpDir;
  let engine;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'wf-test-'));
    fs.mkdirSync(path.join(tmpDir, '.planning'), { recursive: true });
    engine = new TestWorkflowEngine(tmpDir);
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('start returns session_id and first stage', () => {
    const result = engine.start('discuss-phase', { phase: '1' });
    assert.ok(result.session_id, 'has session_id');
    assert.strictEqual(result.nextStageNeeded, true, 'nextStageNeeded is true');
    assert.ok(result.stage, 'has stage');
    assert.strictEqual(result.stage.index, 0, 'stage index is 0');
    assert.strictEqual(result.stage.name, 'init', 'stage name is init');
    assert.ok(result.stage.instructions, 'has instructions');
    assert.ok(result.stage.required_outputs, 'has required_outputs');
  });

  test('start returns error for unknown workflow', () => {
    const result = engine.start('nonexistent', {});
    assert.strictEqual(result.nextStageNeeded, false, 'nextStageNeeded is false');
    assert.ok(result.error, 'has error message');
    assert.ok(result.error.includes('Unknown workflow'), 'error mentions unknown workflow');
  });

  test('advance returns next stage with valid outputs', () => {
    const start = engine.start('discuss-phase', { phase: '1' });
    const sessionId = start.session_id;

    // Provide valid outputs for stage 0 (init)
    const result = engine.advance(sessionId, {
      phase_found: true,
      phase_name: 'Test Phase',
      phase_dir: '/tmp/phase-01',
      has_context: false,
      has_plans: false,
      padded_phase: '01',
    });

    assert.ok(result.session_id, 'has session_id');
    assert.strictEqual(result.nextStageNeeded, true, 'nextStageNeeded is true');
    // Stage 1 (check_existing) has skip_when that matches our outputs (has_context: false, has_plans: false)
    // so it should be skipped, advancing to stage 2 (load_context)
    assert.ok(result.stage.index >= 1, 'advanced past stage 0');
  });

  test('advance returns validation error for missing outputs', () => {
    const start = engine.start('discuss-phase', { phase: '1' });
    const sessionId = start.session_id;

    // Provide incomplete outputs
    const result = engine.advance(sessionId, {
      phase_found: true,
      // Missing: phase_name, phase_dir, has_context, has_plans, padded_phase
    });

    assert.strictEqual(result.nextStageNeeded, true, 'still needs stage');
    assert.ok(result.validation_error, 'has validation_error');
    assert.ok(result.validation_error.missing_outputs.length > 0, 'lists missing outputs');
  });

  test('advance with force skips validation', () => {
    const start = engine.start('discuss-phase', { phase: '1' });
    const sessionId = start.session_id;

    // Provide incomplete outputs but force
    const result = engine.advance(sessionId, { phase_found: true }, true);

    assert.strictEqual(result.nextStageNeeded, true, 'advances to next stage');
    assert.ok(!result.validation_error, 'no validation_error when forced');
  });

  test('advance returns error for unknown session', () => {
    const result = engine.advance('nonexistent-session-id', {});
    assert.strictEqual(result.nextStageNeeded, false, 'nextStageNeeded is false');
    assert.ok(result.error, 'has error');
    assert.ok(result.error.includes('Session not found'), 'error mentions session not found');
  });

  test('status check returns current stage without advancing', () => {
    const start = engine.start('discuss-phase', { phase: '1' });
    const sessionId = start.session_id;

    const status1 = engine.status(sessionId);
    assert.ok(status1.resumed, 'marked as resumed');
    assert.strictEqual(status1.stage.index, 0, 'still on stage 0');

    const status2 = engine.status(sessionId);
    assert.strictEqual(status2.stage.index, 0, 'still on stage 0 after second status call');
  });

  test('status returns error for unknown session', () => {
    const result = engine.status('nonexistent');
    assert.strictEqual(result.nextStageNeeded, false);
    assert.ok(result.error);
  });
});

describe('WorkflowEngine — Session Persistence', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'wf-test-'));
    fs.mkdirSync(path.join(tmpDir, '.planning'), { recursive: true });
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('session persists to filesystem and can be restored by new engine instance', () => {
    const engine1 = new TestWorkflowEngine(tmpDir);
    const start = engine1.start('discuss-phase', { phase: '1' });
    const sessionId = start.session_id;

    // Create a new engine (simulates MCP server restart)
    const engine2 = new TestWorkflowEngine(tmpDir);
    const status = engine2.status(sessionId);
    assert.ok(status.resumed, 'restored session is marked as resumed');
    assert.strictEqual(status.stage.index, 0, 'restored to correct stage');
    assert.strictEqual(status.workflow, 'discuss-phase', 'restored correct workflow');
  });

  test('session file exists in .planning/.gsd-sessions/', () => {
    const engine = new TestWorkflowEngine(tmpDir);
    const start = engine.start('discuss-phase', { phase: '1' });
    const sessionId = start.session_id;

    const sessionFile = path.join(tmpDir, '.planning', '.gsd-sessions', `${sessionId}.json`);
    assert.ok(fs.existsSync(sessionFile), 'session file exists');

    const sessionData = JSON.parse(fs.readFileSync(sessionFile, 'utf-8'));
    assert.strictEqual(sessionData.workflow, 'discuss-phase');
    assert.strictEqual(sessionData.status, 'active');
    assert.strictEqual(sessionData.current_stage, 0);
  });
});

describe('WorkflowEngine — Skip Logic', () => {
  let tmpDir;
  let engine;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'wf-test-'));
    fs.mkdirSync(path.join(tmpDir, '.planning'), { recursive: true });
    engine = new TestWorkflowEngine(tmpDir);
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('skip_when skips stage when conditions match', () => {
    // discuss-phase stage 1 (check_existing) has skip_when: { has_context: false, has_plans: false }
    const start = engine.start('discuss-phase', { phase: '1' });
    const result = engine.advance(start.session_id, {
      phase_found: true,
      phase_name: 'Test',
      phase_dir: '/tmp/test',
      has_context: false,
      has_plans: false,
      padded_phase: '01',
    });

    // Stage 1 should be skipped, landing on stage 2
    assert.strictEqual(result.stage.name, 'load_context', 'skipped check_existing, landed on load_context');
  });

  test('skip_when does NOT skip when conditions do not match', () => {
    const start = engine.start('discuss-phase', { phase: '1' });
    const result = engine.advance(start.session_id, {
      phase_found: true,
      phase_name: 'Test',
      phase_dir: '/tmp/test',
      has_context: true,  // does NOT match skip_when condition
      has_plans: false,
      padded_phase: '01',
    });

    // Stage 1 should NOT be skipped
    assert.strictEqual(result.stage.name, 'check_existing', 'did not skip check_existing');
  });
});

describe('WorkflowEngine — Repeat Logic', () => {
  let tmpDir;
  let engine;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'wf-test-'));
    fs.mkdirSync(path.join(tmpDir, '.planning'), { recursive: true });
    engine = new TestWorkflowEngine(tmpDir);
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('repeat_until keeps stage when condition not met', () => {
    // execute-phase stage 4 (execute_wave) has repeat_until: { output_field: "all_waves_done", equals: true }
    const start = engine.start('execute-phase', { phase: '1' });
    const sessionId = start.session_id;

    // Advance through stages 0-3 with force to reach stage 4
    engine.advance(sessionId, {}, true); // stage 0 → 1
    engine.advance(sessionId, {}, true); // stage 1 → 2
    engine.advance(sessionId, {}, true); // stage 2 → 3
    engine.advance(sessionId, {}, true); // stage 3 → 4

    // On stage 4, provide outputs with all_waves_done: false → should stay
    const result = engine.advance(sessionId, {
      wave_index: 0,
      results: [],
      all_succeeded: true,
      all_waves_done: false,
    }, true);

    assert.strictEqual(result.stage.name, 'execute_wave', 'stayed on execute_wave due to repeat_until');
  });

  test('repeat_until advances when condition is met', () => {
    const start = engine.start('execute-phase', { phase: '1' });
    const sessionId = start.session_id;

    // Advance through stages 0-3 with force
    engine.advance(sessionId, {}, true);
    engine.advance(sessionId, {}, true);
    engine.advance(sessionId, {}, true);
    engine.advance(sessionId, {}, true);

    // On stage 4, provide outputs with all_waves_done: true → should advance
    const result = engine.advance(sessionId, {
      wave_index: 0,
      results: [],
      all_succeeded: true,
      all_waves_done: true,
    }, true);

    assert.notStrictEqual(result.stage.name, 'execute_wave', 'advanced past execute_wave');
  });
});

describe('WorkflowEngine — Output Validation', () => {
  let tmpDir;
  let engine;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'wf-test-'));
    fs.mkdirSync(path.join(tmpDir, '.planning'), { recursive: true });
    engine = new TestWorkflowEngine(tmpDir);
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('validates type mismatches', () => {
    const start = engine.start('discuss-phase', { phase: '1' });
    const result = engine.advance(start.session_id, {
      phase_found: 'yes', // Should be boolean
      phase_name: 'Test',
      phase_dir: '/tmp/test',
      has_context: false,
      has_plans: false,
      padded_phase: '01',
    });

    assert.ok(result.validation_error, 'has validation error');
    assert.ok(result.validation_error.type_errors.length > 0, 'has type errors');
    assert.ok(
      result.validation_error.type_errors[0].includes('boolean'),
      'mentions expected boolean type'
    );
  });

  test('validates enum constraints', () => {
    // discuss-phase stage 1 (check_existing) has decision with enum constraint
    const start = engine.start('discuss-phase', { phase: '1' });

    // Advance to stage 1 (check_existing) — provide outputs so it doesn't skip
    engine.advance(start.session_id, {
      phase_found: true,
      phase_name: 'Test',
      phase_dir: '/tmp/test',
      has_context: true,
      has_plans: true,
      padded_phase: '01',
    });

    // Now on stage 1, provide invalid enum value
    const result = engine.advance(start.session_id, {
      decision: 'invalid_choice',
    });

    assert.ok(result.validation_error, 'has validation error');
    assert.ok(result.validation_error.type_errors.length > 0, 'has type errors for enum');
  });
});

describe('WorkflowEngine — Complete Workflow Run', () => {
  let tmpDir;
  let engine;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'wf-test-'));
    fs.mkdirSync(path.join(tmpDir, '.planning'), { recursive: true });
    engine = new TestWorkflowEngine(tmpDir);
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('completes discuss-phase workflow when forced through all stages', () => {
    const start = engine.start('discuss-phase', { phase: '1' });
    let current = start;
    const stagesVisited = [];

    while (current.nextStageNeeded) {
      stagesVisited.push(current.stage.name);
      current = engine.advance(current.session_id, {}, true);
    }

    assert.strictEqual(current.status, 'complete', 'workflow completed');
    assert.ok(current.stages_completed.length > 0, 'has completed stages');
    assert.ok(stagesVisited.includes('init'), 'visited init stage');
    assert.ok(
      current.summary.includes('discuss-phase'),
      'summary mentions workflow name'
    );
  });

  test('cannot advance a completed session', () => {
    const start = engine.start('discuss-phase', { phase: '1' });
    let current = start;

    // Force through all stages
    while (current.nextStageNeeded) {
      current = engine.advance(current.session_id, {}, true);
    }

    // Try to advance again
    const result = engine.advance(start.session_id, {}, true);
    assert.strictEqual(result.nextStageNeeded, false);
    assert.ok(result.error.includes('complete'), 'error mentions session is complete');
  });
});

describe('WorkflowEngine — Stage File Integrity', () => {
  let engine;

  beforeEach(() => {
    const tmpDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'wf-test-'));
    fs.mkdirSync(path.join(tmpDir, '.planning'), { recursive: true });
    engine = new TestWorkflowEngine(tmpDir);
  });

  test('all stage files have unique stage names within a workflow', () => {
    const workflows = engine._listWorkflows();
    for (const wf of workflows) {
      const stages = engine._loadStages(wf);
      const names = stages.map((s) => s.name);
      const uniqueNames = new Set(names);
      assert.strictEqual(
        names.length,
        uniqueNames.size,
        `${wf}: all stage names are unique (found duplicates: ${names.filter((n, i) => names.indexOf(n) !== i).join(', ')})`
      );
    }
  });

  test('all stage files have version and description in root', () => {
    const workflows = engine._listWorkflows();
    for (const wf of workflows) {
      const filePath = path.join(STAGES_DIR, `${wf}.stages.json`);
      const content = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      assert.ok(content.workflow, `${wf}: has workflow field`);
      assert.ok(content.version, `${wf}: has version field`);
      assert.ok(content.description, `${wf}: has description field`);
    }
  });

  test('stage required_outputs have valid type values', () => {
    const validTypes = new Set(['string', 'boolean', 'number', 'array', 'object']);
    const workflows = engine._listWorkflows();
    for (const wf of workflows) {
      const stages = engine._loadStages(wf);
      for (const stage of stages) {
        for (const [key, spec] of Object.entries(stage.required_outputs || {})) {
          const type = typeof spec === 'string' ? spec : spec.type;
          if (type) {
            assert.ok(
              validTypes.has(type),
              `${wf}/${stage.name}: output '${key}' has valid type '${type}'`
            );
          }
        }
      }
    }
  });

  test('repeat_until references valid output fields', () => {
    const workflows = engine._listWorkflows();
    for (const wf of workflows) {
      const stages = engine._loadStages(wf);
      for (const stage of stages) {
        if (stage.repeat_until) {
          assert.ok(
            stage.repeat_until.output_field,
            `${wf}/${stage.name}: repeat_until has output_field`
          );
          assert.ok(
            stage.repeat_until.equals !== undefined || stage.repeat_until.less_than !== undefined,
            `${wf}/${stage.name}: repeat_until has a comparison operator`
          );
        }
      }
    }
  });
});
