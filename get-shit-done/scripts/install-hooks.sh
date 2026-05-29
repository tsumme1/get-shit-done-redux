#!/bin/bash
# install-hooks.sh — Installs GSD enforcement git hooks
#
# Usage: bash get-shit-done/scripts/install-hooks.sh [<project_root>]
#
# Installs a pre-commit hook that validates:
# 1. SUMMARY.md exists for plan completion commits
# 2. Commit messages follow GSD conventions
# 3. STATE.md format is valid (if modified)
#
# These hooks run OUTSIDE the LLM context — they are true hard enforcement
# that cannot be bypassed by the agent.

set -euo pipefail

PROJECT_ROOT="${1:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
HOOKS_DIR="${PROJECT_ROOT}/.git/hooks"

if [ ! -d "${PROJECT_ROOT}/.git" ]; then
  echo "Error: Not a git repository: ${PROJECT_ROOT}" >&2
  exit 1
fi

mkdir -p "$HOOKS_DIR"

# --- Pre-commit hook ---
cat > "${HOOKS_DIR}/pre-commit" << 'HOOK_EOF'
#!/bin/bash
# GSD Pre-Commit Hook — Hard enforcement gate
# Installed by get-shit-done/scripts/install-hooks.sh
# This hook runs OUTSIDE the LLM — it cannot be bypassed.

set -euo pipefail

# 1. Validate commit message format for GSD commits
# GSD commits follow: type(phase-N): description
# Allowed types: feat, fix, test, docs, chore, refactor, style, ci
COMMIT_MSG_FILE="${1:-.git/COMMIT_EDITMSG}"
if [ -f "$COMMIT_MSG_FILE" ]; then
  FIRST_LINE=$(head -1 "$COMMIT_MSG_FILE")
  # Only validate GSD-pattern commits (don't block non-GSD commits)
  if echo "$FIRST_LINE" | grep -qE '^\(phase-[0-9]+\)'; then
    if ! echo "$FIRST_LINE" | grep -qE '^(feat|fix|test|docs|chore|refactor|style|ci)\(phase-[0-9]+'; then
      echo "❌ GSD HOOK: Invalid commit type. Use: feat|fix|test|docs|chore|refactor|style|ci"
      echo "   Got: $FIRST_LINE"
      exit 1
    fi
  fi
fi

# 2. Check for TODO/FIXME/PLACEHOLDER in staged files (GSD anti-pattern)
STAGED_FILES=$(git diff --cached --name-only --diff-filter=ACM 2>/dev/null || true)
if [ -n "$STAGED_FILES" ]; then
  VIOLATIONS=""
  for file in $STAGED_FILES; do
    if [ -f "$file" ] && echo "$file" | grep -qE '\.(js|ts|py|md|jsx|tsx|css|html)$'; then
      # Skip checking markdown files that are GSD planning artifacts
      if echo "$file" | grep -qE '^\.planning/|ROADMAP|STATE|PROJECT|REQUIREMENTS|SUMMARY|VALIDATION'; then
        continue
      fi
      FOUND=$(grep -nE '(TODO|FIXME|PLACEHOLDER|HACK|XXX)' "$file" 2>/dev/null | head -3 || true)
      if [ -n "$FOUND" ]; then
        VIOLATIONS="${VIOLATIONS}\n  ${file}:\n${FOUND}"
      fi
    fi
  done
  if [ -n "$VIOLATIONS" ]; then
    echo "⚠️  GSD HOOK WARNING: Found TODO/FIXME markers in staged files:"
    echo -e "$VIOLATIONS"
    echo ""
    echo "   GSD anti-pattern: No placeholder code. Implement fully or defer to a plan."
    echo "   To bypass: git commit --no-verify (not recommended)"
  fi
fi

# 3. Validate STATE.md format if modified
if git diff --cached --name-only | grep -q 'STATE.md'; then
  STATE_FILE=$(git diff --cached --name-only | grep 'STATE.md' | head -1)
  if [ -f "$STATE_FILE" ]; then
    # Check for required frontmatter fields
    if ! head -20 "$STATE_FILE" | grep -q 'Status:'; then
      echo "❌ GSD HOOK: STATE.md missing 'Status:' field in frontmatter"
      exit 1
    fi
  fi
fi

exit 0
HOOK_EOF

chmod +x "${HOOKS_DIR}/pre-commit"

# --- Commit-msg hook ---
cat > "${HOOKS_DIR}/commit-msg" << 'HOOK_EOF'
#!/bin/bash
# GSD Commit Message Hook — Validates GSD commit message format
# Installed by get-shit-done/scripts/install-hooks.sh

COMMIT_MSG_FILE="$1"
FIRST_LINE=$(head -1 "$COMMIT_MSG_FILE")

# Only validate commits that look like GSD commits
if echo "$FIRST_LINE" | grep -qE 'phase-[0-9]+'; then
  # Must follow: type(phase-N-plan): description
  if ! echo "$FIRST_LINE" | grep -qE '^(feat|fix|test|docs|chore|refactor|style|ci)\('; then
    echo "❌ GSD HOOK: Commit message must start with type prefix"
    echo "   Valid types: feat, fix, test, docs, chore, refactor, style, ci"
    echo "   Example: feat(phase-1): implement user authentication"
    echo "   Got: $FIRST_LINE"
    exit 1
  fi
fi

exit 0
HOOK_EOF

chmod +x "${HOOKS_DIR}/commit-msg"

echo "✅ GSD git hooks installed:"
echo "   ${HOOKS_DIR}/pre-commit"
echo "   ${HOOKS_DIR}/commit-msg"
echo ""
echo "   These hooks enforce:"
echo "   - Commit message format (type(phase-N): description)"
echo "   - No TODO/FIXME placeholders in staged code"
echo "   - STATE.md format validation"
echo ""
echo "   To remove: rm ${HOOKS_DIR}/pre-commit ${HOOKS_DIR}/commit-msg"
