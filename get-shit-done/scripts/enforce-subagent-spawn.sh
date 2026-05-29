#!/bin/bash
# enforce-subagent-spawn.sh — Validates that a subagent was actually spawned
#
# Usage: enforce-subagent-spawn.sh <expected_agent_type_or_role_substring>
#
# This script checks the Antigravity conversation transcript to verify that
# invoke_subagent was called with the expected agent type. If the agent inlined
# the work instead of spawning a subagent, this script catches it.
#
# Exit codes:
#   0 — Subagent spawn verified
#   1 — Enforcement failure (no spawn detected)
#   2 — Usage error

set -euo pipefail

if [ $# -lt 1 ]; then
  echo "Usage: enforce-subagent-spawn.sh <expected_agent_type_or_role>" >&2
  exit 2
fi

EXPECTED="$1"
CONVERSATION_ID="${ANTIGRAVITY_CONVERSATION_ID:-}"
TRANSCRIPT_DIR="${ANTIGRAVITY_APP_DATA:-$HOME/.gemini/antigravity}/brain"

# Strategy 1: Check transcript log if conversation ID is available
if [ -n "$CONVERSATION_ID" ]; then
  LOG_FILE="${TRANSCRIPT_DIR}/${CONVERSATION_ID}/.system_generated/logs/transcript.jsonl"
  if [ -f "$LOG_FILE" ]; then
    # Check for invoke_subagent tool calls mentioning the expected agent type
    if grep -q "invoke_subagent" "$LOG_FILE" 2>/dev/null && \
       grep "invoke_subagent" "$LOG_FILE" | grep -qi "${EXPECTED}" 2>/dev/null; then
      echo "✅ ENFORCEMENT PASSED: Subagent '${EXPECTED}' spawn verified in transcript"
      exit 0
    fi
  fi
fi

# Strategy 2: Check for define_subagent calls in recent command history
# The define_subagent must have been called before invoke_subagent
if [ -n "$CONVERSATION_ID" ] && [ -f "${TRANSCRIPT_DIR}/${CONVERSATION_ID}/.system_generated/logs/transcript.jsonl" ]; then
  LOG_FILE="${TRANSCRIPT_DIR}/${CONVERSATION_ID}/.system_generated/logs/transcript.jsonl"
  
  # Check both define_subagent and invoke_subagent
  DEFINED=$(grep -c "define_subagent" "$LOG_FILE" 2>/dev/null || echo "0")
  INVOKED=$(grep "invoke_subagent" "$LOG_FILE" 2>/dev/null | grep -ci "${EXPECTED}" 2>/dev/null || echo "0")
  
  if [ "$INVOKED" -gt 0 ]; then
    echo "✅ ENFORCEMENT PASSED: Subagent '${EXPECTED}' was invoked (${INVOKED} time(s), ${DEFINED} agent type(s) defined)"
    exit 0
  fi
fi

# Strategy 3: If no transcript available, check for subagent artifacts
# Subagents leave traces in the brain directory
if [ -n "$CONVERSATION_ID" ]; then
  SUBAGENT_DIRS=$(find "${TRANSCRIPT_DIR}" -maxdepth 1 -type d -newer "${TRANSCRIPT_DIR}/${CONVERSATION_ID}" 2>/dev/null | wc -l | tr -d ' ')
  if [ "$SUBAGENT_DIRS" -gt 0 ]; then
    echo "⚠️  ENFORCEMENT PARTIAL: Found ${SUBAGENT_DIRS} recent subagent conversation(s) but cannot confirm type '${EXPECTED}'"
    echo "    Manual verification required — check manage_subagents output"
    exit 0  # Soft pass — artifacts exist
  fi
fi

# Failure — no evidence of subagent spawn
echo "❌ ENFORCEMENT FAILURE: Workflow required spawning subagent '${EXPECTED}'"
echo "   No invoke_subagent call detected in conversation transcript."
echo ""
echo "   The workflow REQUIRES delegating this work to a subagent."
echo "   Do NOT inline the work. Use:"
echo ""
echo "   invoke_subagent("
echo "     Subagents: [{"
echo "       TypeName: \"${EXPECTED}\","
echo "       Role: \"<descriptive role>\","
echo "       Prompt: \"<task prompt>\","
echo "       Workspace: \"branch\""
echo "     }]"
echo "   )"
echo ""
exit 1
