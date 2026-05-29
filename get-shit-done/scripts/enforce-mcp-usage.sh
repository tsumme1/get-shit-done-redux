#!/bin/bash
# enforce-mcp-usage.sh — Validates that the gsd-guardian MCP server was used
#                         instead of raw run_command with gsd-tools.cjs
#
# Usage: enforce-mcp-usage.sh <expected_tool_name>
#
# Checks that a specific MCP tool was called via call_mcp_tool rather than
# falling back to node gsd-tools.cjs via run_command.
#
# Exit codes:
#   0 — MCP usage verified (or no violations detected)
#   1 — Enforcement failure (raw gsd-tools.cjs usage detected)
#   2 — Usage error

set -euo pipefail

if [ $# -lt 1 ]; then
  echo "Usage: enforce-mcp-usage.sh <expected_mcp_tool_name>" >&2
  exit 2
fi

EXPECTED_TOOL="$1"
CONVERSATION_ID="${ANTIGRAVITY_CONVERSATION_ID:-}"
TRANSCRIPT_DIR="${ANTIGRAVITY_APP_DATA:-$HOME/.gemini/antigravity}/brain"

if [ -z "$CONVERSATION_ID" ]; then
  echo "⚠️  ENFORCEMENT SKIP: No ANTIGRAVITY_CONVERSATION_ID set — cannot verify MCP usage"
  exit 0
fi

LOG_FILE="${TRANSCRIPT_DIR}/${CONVERSATION_ID}/.system_generated/logs/transcript.jsonl"

if [ ! -f "$LOG_FILE" ]; then
  echo "⚠️  ENFORCEMENT SKIP: Transcript not found at ${LOG_FILE}"
  exit 0
fi

# Check for violations: raw gsd-tools.cjs usage via run_command
VIOLATIONS=$(grep -c "gsd-tools.cjs\|gsd_run query" "$LOG_FILE" 2>/dev/null || echo "0")
if [ "$VIOLATIONS" -gt 0 ]; then
  # Check if these are in run_command calls (violation) vs MCP server internals (ok)
  RAW_CALLS=$(grep "run_command" "$LOG_FILE" 2>/dev/null | grep -c "gsd-tools.cjs\|gsd_run" 2>/dev/null || echo "0")
  if [ "$RAW_CALLS" -gt 0 ]; then
    echo "❌ ENFORCEMENT FAILURE: Detected ${RAW_CALLS} raw gsd-tools.cjs call(s) via run_command"
    echo "   The gsd-guardian MCP server is the ONLY authorized interface."
    echo ""
    echo "   Use: call_mcp_tool(ServerName: \"gsd-guardian\", ToolName: \"${EXPECTED_TOOL}\")"
    echo "   NOT:  run_command(\"node gsd-tools.cjs query ...\")"
    echo ""
    exit 1
  fi
fi

# Check for positive evidence: MCP tool was called
MCP_CALLS=$(grep "call_mcp_tool" "$LOG_FILE" 2>/dev/null | grep -ci "gsd-guardian" 2>/dev/null || echo "0")
if [ "$MCP_CALLS" -gt 0 ]; then
  echo "✅ ENFORCEMENT PASSED: gsd-guardian MCP server used (${MCP_CALLS} call(s)), no raw gsd-tools.cjs violations"
  exit 0
fi

echo "⚠️  ENFORCEMENT PARTIAL: No gsd-guardian MCP calls detected, but no violations either"
echo "   Expected call_mcp_tool(\"gsd-guardian\", \"${EXPECTED_TOOL}\") — verify manually"
exit 0
