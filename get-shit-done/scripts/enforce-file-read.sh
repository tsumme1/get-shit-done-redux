#!/bin/bash
# enforce-file-read.sh — Validates that required files were read before proceeding
#
# Usage: enforce-file-read.sh <required_file_path> [<conversation_id>]
#
# Checks the conversation transcript for view_file calls targeting the required file.
# Used to enforce <required_reading> blocks in workflows.
#
# Exit codes:
#   0 — File read verified
#   1 — Enforcement failure (file not read)
#   2 — Usage error

set -euo pipefail

if [ $# -lt 1 ]; then
  echo "Usage: enforce-file-read.sh <required_file_path> [<conversation_id>]" >&2
  exit 2
fi

REQUIRED_FILE="$1"
CONVERSATION_ID="${2:-${ANTIGRAVITY_CONVERSATION_ID:-}}"
TRANSCRIPT_DIR="${ANTIGRAVITY_APP_DATA:-$HOME/.gemini/antigravity}/brain"

# Extract just the filename for flexible matching
BASENAME=$(basename "$REQUIRED_FILE")

if [ -z "$CONVERSATION_ID" ]; then
  echo "⚠️  ENFORCEMENT SKIP: No conversation ID — cannot verify file read"
  exit 0
fi

LOG_FILE="${TRANSCRIPT_DIR}/${CONVERSATION_ID}/.system_generated/logs/transcript.jsonl"

if [ ! -f "$LOG_FILE" ]; then
  echo "⚠️  ENFORCEMENT SKIP: Transcript not found at ${LOG_FILE}"
  exit 0
fi

# Check for view_file calls that include the required file path or basename
if grep -q "view_file" "$LOG_FILE" 2>/dev/null && \
   grep "view_file" "$LOG_FILE" | grep -qi "${BASENAME}" 2>/dev/null; then
  echo "✅ ENFORCEMENT PASSED: File '${BASENAME}' was read (view_file verified)"
  exit 0
fi

# Also check for read_file MCP calls (filesystem server)
if grep -q "read_file\|read_text_file" "$LOG_FILE" 2>/dev/null && \
   grep "read_file\|read_text_file" "$LOG_FILE" | grep -qi "${BASENAME}" 2>/dev/null; then
  echo "✅ ENFORCEMENT PASSED: File '${BASENAME}' was read (MCP read_file verified)"
  exit 0
fi

echo "❌ ENFORCEMENT FAILURE: Required file '${REQUIRED_FILE}' was not read"
echo "   The workflow requires reading this file before proceeding."
echo ""
echo "   Use: view_file(AbsolutePath: \"${REQUIRED_FILE}\")"
echo ""
exit 1
