/**
 * Antigravity 2.0 Skill Adapter tests.
 *
 * Ensures Antigravity skill conversion prepends the correct adapter header,
 * maps subagent isolation correctly, and applies path/command transformations.
 */

process.env.GSD_TEST_MODE = '1';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');

const {
  convertClaudeCommandToAntigravitySkill,
  convertClaudeAgentToAntigravityAgent,
} = require('../bin/install.js');

describe('convertClaudeCommandToAntigravitySkill', () => {
  test('prepends the correct Antigravity skill adapter header', () => {
    const input = `---
name: quick
description: Execute a quick task
---

<objective>
Test body
</objective>
`;

    const result = convertClaudeCommandToAntigravitySkill(input, 'gsd-quick');
    
    // Check frontmatter
    const nameMatch = result.match(/^name:\s*(.+)$/m);
    assert.ok(nameMatch, 'frontmatter contains name field');
    assert.strictEqual(nameMatch[1], 'gsd-quick', 'skill name matches');
    
    // Check adapter header
    assert.ok(result.includes('<antigravity_skill_adapter>'), 'contains <antigravity_skill_adapter>');
    assert.ok(result.includes('## A. Skill Invocation'), 'contains A. Skill Invocation');
    assert.ok(result.includes('## B. User Prompting'), 'contains B. User Prompting');
    assert.ok(result.includes('## C. Tool Usage'), 'contains C. Tool Usage');
    assert.ok(result.includes('## D. Subagent Spawning'), 'contains D. Subagent Spawning');
    
    // Check tool usage details
    assert.ok(result.includes('run_command'), 'mentions run_command');
    assert.ok(result.includes('replace_file_content'), 'mentions replace_file_content');
    assert.ok(result.includes('invoke_subagent'), 'mentions invoke_subagent');
    assert.ok(result.includes('Workspace="share"'), 'mentions share workspace');
    assert.ok(result.includes('Workspace="inherit"'), 'mentions inherit workspace');
  });

  test('applies path replacements and brand/command normalization to body', () => {
    const input = `---
name: plan-phase
description: Plan a phase
---

Read plan from ~/.claude/get-shit-done/workflows/plan-phase.md
Call /gsd:execute-phase
`;

    const result = convertClaudeCommandToAntigravitySkill(input, 'gsd-plan-phase', false);
    
    assert.ok(result.includes('.agent/get-shit-done/workflows/plan-phase.md'), 'relative path replaced');
    assert.ok(result.includes('/gsd-execute-phase'), 'gsd: namespace normalized to hyphen');
    assert.ok(!result.includes('.claude'), 'no .claude reference remaining');
  });
});
