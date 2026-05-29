// allow-test-rule: source-text-is-the-product
// Enforcement scripts and workflow .md text — testing the deployed contract.
'use strict';

/**
 * Antigravity Enforcement Script Integration Tests
 *
 * Exercises enforce-subagent-spawn.sh, enforce-file-read.sh, and
 * enforce-mcp-usage.sh against synthetic transcript fixtures.
 * Also validates structural invariant: every workflow that uses Agent()
 * must have an <antigravity_runtime> block.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { execSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SCRIPTS = path.join(ROOT, 'get-shit-done', 'scripts');
const FIXTURES = path.join(__dirname, 'fixtures', 'enforcement', 'appdata');
const WORKFLOWS = path.join(ROOT, 'get-shit-done', 'workflows');

/**
 * Helper: run an enforcement script with a specific conversation fixture.
 * Returns { stdout, exitCode }.
 */
function runEnforce(scriptName, args, conversationId) {
  const cmd = `bash "${path.join(SCRIPTS, scriptName)}" ${args}`;
  const env = {
    ...process.env,
    ANTIGRAVITY_CONVERSATION_ID: conversationId,
    ANTIGRAVITY_APP_DATA: FIXTURES,
  };
  try {
    const stdout = execSync(cmd, { cwd: ROOT, env, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
    return { stdout: stdout.trim(), exitCode: 0 };
  } catch (err) {
    return { stdout: (err.stdout || '').trim(), exitCode: err.status || 1 };
  }
}

// ─── enforce-subagent-spawn.sh ──────────────────────────────────────────────

describe('enforce-subagent-spawn.sh', () => {
  test('passes when the expected agent type was invoked', () => {
    const { exitCode, stdout } = runEnforce('enforce-subagent-spawn.sh', '"gsd-executor"', 'compliant-conv');
    assert.equal(exitCode, 0, `Expected exit 0, got ${exitCode}: ${stdout}`);
    assert.ok(stdout.includes('ENFORCEMENT PASSED'), `Expected PASSED in output: ${stdout}`);
    assert.ok(!stdout.includes('integer expression'), 'grep -c bug: integer expression error');
  });

  test('passes for a second agent type in the same transcript', () => {
    const { exitCode, stdout } = runEnforce('enforce-subagent-spawn.sh', '"gsd-verifier"', 'compliant-conv');
    assert.equal(exitCode, 0, `Expected exit 0, got ${exitCode}: ${stdout}`);
    assert.ok(stdout.includes('ENFORCEMENT PASSED'), `Expected PASSED in output: ${stdout}`);
  });

  test('fails when agent inlined work instead of spawning', () => {
    const { exitCode, stdout } = runEnforce('enforce-subagent-spawn.sh', '"gsd-executor"', 'inlined-conv');
    assert.equal(exitCode, 1, `Expected exit 1 for inlined work, got ${exitCode}: ${stdout}`);
    assert.ok(stdout.includes('ENFORCEMENT FAILURE'), `Expected FAILURE in output: ${stdout}`);
  });

  test('output contains no integer expression errors on any fixture', () => {
    for (const conv of ['compliant-conv', 'inlined-conv', 'noreads-conv', 'rawcli-conv']) {
      const { stdout } = runEnforce('enforce-subagent-spawn.sh', '"gsd-executor"', conv);
      assert.ok(!stdout.includes('integer expression'), `Integer expression error in ${conv}: ${stdout}`);
    }
  });
});

// ─── enforce-file-read.sh ───────────────────────────────────────────────────

describe('enforce-file-read.sh', () => {
  test('passes when the required file was read via view_file', () => {
    const { exitCode, stdout } = runEnforce(
      'enforce-file-read.sh',
      '"antigravity-runtime.md" "compliant-conv"',
      'compliant-conv'
    );
    assert.equal(exitCode, 0, `Expected exit 0, got ${exitCode}: ${stdout}`);
    assert.ok(stdout.includes('ENFORCEMENT PASSED'), `Expected PASSED: ${stdout}`);
  });

  test('fails when the required file was never read', () => {
    const { exitCode, stdout } = runEnforce(
      'enforce-file-read.sh',
      '"antigravity-runtime.md" "noreads-conv"',
      'noreads-conv'
    );
    assert.equal(exitCode, 1, `Expected exit 1 for unread file, got ${exitCode}: ${stdout}`);
    assert.ok(stdout.includes('ENFORCEMENT FAILURE'), `Expected FAILURE: ${stdout}`);
  });

  test('soft-passes when no conversation ID is set', () => {
    const cmd = `bash "${path.join(SCRIPTS, 'enforce-file-read.sh')}" "antigravity-runtime.md"`;
    const env = { ...process.env, ANTIGRAVITY_CONVERSATION_ID: '' };
    // Remove ANTIGRAVITY_CONVERSATION_ID
    delete env.ANTIGRAVITY_CONVERSATION_ID;
    const stdout = execSync(cmd, { cwd: ROOT, env, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
    assert.ok(stdout.includes('ENFORCEMENT SKIP'), `Expected SKIP: ${stdout}`);
  });
});

// ─── enforce-mcp-usage.sh ───────────────────────────────────────────────────

describe('enforce-mcp-usage.sh', () => {
  test('passes when gsd-guardian MCP server was used', () => {
    const { exitCode, stdout } = runEnforce('enforce-mcp-usage.sh', '"init_execute_phase"', 'compliant-conv');
    assert.equal(exitCode, 0, `Expected exit 0, got ${exitCode}: ${stdout}`);
    assert.ok(stdout.includes('ENFORCEMENT PASSED'), `Expected PASSED: ${stdout}`);
    assert.ok(!stdout.includes('integer expression'), 'grep -c bug: integer expression error');
  });

  test('fails when raw gsd-tools.cjs was used via run_command', () => {
    const { exitCode, stdout } = runEnforce('enforce-mcp-usage.sh', '"init_execute_phase"', 'rawcli-conv');
    assert.equal(exitCode, 1, `Expected exit 1 for raw CLI, got ${exitCode}: ${stdout}`);
    assert.ok(stdout.includes('ENFORCEMENT FAILURE'), `Expected FAILURE: ${stdout}`);
  });

  test('partial-passes when neither MCP nor raw CLI was used', () => {
    const { exitCode, stdout } = runEnforce('enforce-mcp-usage.sh', '"init_execute_phase"', 'inlined-conv');
    assert.equal(exitCode, 0, `Expected exit 0 for partial, got ${exitCode}: ${stdout}`);
    assert.ok(stdout.includes('ENFORCEMENT PARTIAL'), `Expected PARTIAL: ${stdout}`);
  });

  test('output contains no integer expression errors on any fixture', () => {
    for (const conv of ['compliant-conv', 'inlined-conv', 'rawcli-conv']) {
      const { stdout } = runEnforce('enforce-mcp-usage.sh', '"init_execute_phase"', conv);
      assert.ok(!stdout.includes('integer expression'), `Integer expression error in ${conv}: ${stdout}`);
    }
  });
});

// ─── Structural: Agent-spawning workflows must have <antigravity_runtime> ───

describe('structural: workflows with Agent() must have <antigravity_runtime>', () => {
  const workflowFiles = fs.readdirSync(WORKFLOWS)
    .filter(f => f.endsWith('.md'))
    .map(f => ({ name: f, path: path.join(WORKFLOWS, f) }));

  // Workflows that use Agent() or subagent_type in their Claude Code form
  const agentWorkflows = workflowFiles.filter(({ path: fp }) => {
    const content = fs.readFileSync(fp, 'utf-8');
    // Match Agent( calls or subagent_type references that indicate this workflow spawns agents
    return /\bAgent\s*\(/.test(content) || /subagent_type\s*=/.test(content);
  });

  // The 8 priority workflows already have SKILL.md wrappers and don't need inline blocks
  const SKILL_COVERED = new Set([
    'discuss-phase.md', 'plan-phase.md', 'execute-phase.md', 'verify-work.md',
    'new-project.md', 'new-milestone.md', 'ship.md', 'complete-milestone.md',
  ]);

  for (const { name, path: fp } of agentWorkflows) {
    if (SKILL_COVERED.has(name)) continue;

    test(`${name} has <antigravity_runtime> block`, () => {
      const content = fs.readFileSync(fp, 'utf-8');
      assert.ok(
        content.includes('<antigravity_runtime>'),
        `${name} uses Agent() but has no <antigravity_runtime> block. ` +
        'Every agent-spawning workflow must have Antigravity translation instructions.'
      );
    });
  }
});
