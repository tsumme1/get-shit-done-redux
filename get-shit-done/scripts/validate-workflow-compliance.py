#!/usr/bin/env python3
"""
validate-workflow-compliance.py — Master enforcement validator

Checks a conversation transcript against a workflow's declared requirements.
Parses the SKILL.md to extract expected behaviors, then verifies the transcript
contains evidence of compliance.

Usage:
    python3 validate-workflow-compliance.py <skill_md_path> [<transcript_path>]

If transcript_path is not provided, uses $ANTIGRAVITY_CONVERSATION_ID to find it.

Exit codes:
    0 — All checks passed
    1 — One or more enforcement failures
    2 — Usage/configuration error
"""

import json
import re
import sys
import os
from pathlib import Path
from dataclasses import dataclass, field
from typing import Optional


@dataclass
class CheckResult:
    name: str
    passed: bool
    details: str
    severity: str = "ERROR"  # ERROR, WARNING, INFO


@dataclass
class ComplianceReport:
    skill_name: str
    checks: list = field(default_factory=list)

    @property
    def passed(self) -> bool:
        return all(c.passed for c in self.checks if c.severity == "ERROR")

    @property
    def error_count(self) -> int:
        return sum(1 for c in self.checks if not c.passed and c.severity == "ERROR")

    @property
    def warning_count(self) -> int:
        return sum(1 for c in self.checks if not c.passed and c.severity == "WARNING")

    def __str__(self) -> str:
        lines = [f"\n{'='*60}", f"COMPLIANCE REPORT: {self.skill_name}", f"{'='*60}\n"]
        for check in self.checks:
            icon = "✅" if check.passed else ("❌" if check.severity == "ERROR" else "⚠️")
            lines.append(f"  {icon} [{check.severity}] {check.name}")
            if not check.passed:
                for detail_line in check.details.split("\n"):
                    lines.append(f"      {detail_line}")
        lines.append(f"\n{'─'*60}")
        status = "PASSED" if self.passed else "FAILED"
        lines.append(
            f"  Result: {status} | "
            f"{self.error_count} error(s), {self.warning_count} warning(s), "
            f"{sum(1 for c in self.checks if c.passed)} passed"
        )
        lines.append(f"{'─'*60}\n")
        return "\n".join(lines)


def load_transcript(transcript_path: str) -> list[dict]:
    """Load and parse a JSONL transcript file."""
    entries = []
    with open(transcript_path, "r") as f:
        for line in f:
            line = line.strip()
            if line:
                try:
                    entries.append(json.loads(line))
                except json.JSONDecodeError:
                    continue
    return entries


def extract_tool_calls(transcript: list[dict]) -> list[dict]:
    """Extract all tool calls from transcript entries."""
    tool_calls = []
    for entry in transcript:
        if "tool_calls" in entry and entry["tool_calls"]:
            for tc in entry["tool_calls"]:
                tool_calls.append(tc)
        # Also check content for tool call evidence
        content = entry.get("content", "")
        if isinstance(content, str):
            # Check for tool call patterns in content
            if "invoke_subagent" in content or "define_subagent" in content:
                tool_calls.append({"name": "subagent_evidence", "content": content})
    return tool_calls


def parse_skill_md(skill_path: str) -> dict:
    """Parse a SKILL.md file to extract enforcement requirements."""
    with open(skill_path, "r") as f:
        content = f.read()

    result = {
        "name": "",
        "allowed_tools": [],
        "required_reads": [],
        "required_subagents": [],
        "required_mcp_calls": [],
        "enforcement_checkpoints": [],
    }

    # Extract name from frontmatter
    name_match = re.search(r"^name:\s*(.+)$", content, re.MULTILINE)
    if name_match:
        result["name"] = name_match.group(1).strip()

    # Extract allowed-tools
    tools_match = re.search(r"^allowed-tools:\s*(.+)$", content, re.MULTILINE)
    if tools_match:
        result["allowed_tools"] = tools_match.group(1).strip().split()

    # Extract required file reads (from "view_file" instructions and required_reading)
    read_patterns = re.findall(
        r'(?:view_file|enforce-file-read\.sh)\s*[("]\s*["\']?([^"\')\s]+)', content
    )
    result["required_reads"] = list(set(read_patterns))

    # Extract required subagent spawns
    subagent_patterns = re.findall(
        r'(?:TypeName|enforce-subagent-spawn\.sh)\s*[:"]\s*["\']?([^"\')\s,]+)',
        content,
    )
    result["required_subagents"] = list(set(subagent_patterns))

    # Extract required MCP calls
    mcp_patterns = re.findall(
        r'ToolName:\s*"([^"]+)"', content
    )
    result["required_mcp_calls"] = list(set(mcp_patterns))

    # Extract enforcement checkpoints
    checkpoint_patterns = re.findall(
        r"enforce-(?:subagent-spawn|mcp-usage|file-read)\.sh\s+\"([^\"]+)\"",
        content,
    )
    result["enforcement_checkpoints"] = checkpoint_patterns

    return result


def check_subagent_spawns(
    transcript: list[dict], required_types: list[str]
) -> list[CheckResult]:
    """Check that required subagent types were spawned."""
    results = []
    tool_calls = extract_tool_calls(transcript)
    transcript_text = json.dumps(transcript)

    for agent_type in required_types:
        # Skip non-agent-type values that got picked up by regex
        if agent_type in ("enforce", "bash", "run", "get"):
            continue

        found = (
            agent_type in transcript_text
            and ("invoke_subagent" in transcript_text or "define_subagent" in transcript_text)
        )

        results.append(
            CheckResult(
                name=f"Subagent spawn: {agent_type}",
                passed=found,
                details=f"Expected invoke_subagent with TypeName '{agent_type}'"
                if not found
                else f"Found evidence of {agent_type} spawn",
                severity="ERROR",
            )
        )

    return results


def check_mcp_usage(
    transcript: list[dict], required_calls: list[str]
) -> list[CheckResult]:
    """Check that MCP tools were used instead of raw CLI calls."""
    results = []
    transcript_text = json.dumps(transcript)

    # Check for violations: raw gsd-tools.cjs usage
    has_raw_usage = "gsd-tools.cjs" in transcript_text and "run_command" in transcript_text
    if has_raw_usage:
        results.append(
            CheckResult(
                name="No raw gsd-tools.cjs usage",
                passed=False,
                details="Found raw gsd-tools.cjs invocation via run_command. Use gsd-guardian MCP server instead.",
                severity="ERROR",
            )
        )
    else:
        results.append(
            CheckResult(
                name="No raw gsd-tools.cjs usage",
                passed=True,
                details="No violations detected",
                severity="ERROR",
            )
        )

    # Check for positive evidence of MCP usage
    has_mcp = "call_mcp_tool" in transcript_text and "gsd-guardian" in transcript_text
    results.append(
        CheckResult(
            name="MCP server usage",
            passed=has_mcp,
            details="gsd-guardian MCP calls detected"
            if has_mcp
            else "No gsd-guardian MCP calls found in transcript",
            severity="WARNING",
        )
    )

    return results


def check_file_reads(
    transcript: list[dict], required_files: list[str]
) -> list[CheckResult]:
    """Check that required files were read."""
    results = []
    transcript_text = json.dumps(transcript)

    for file_ref in required_files:
        basename = os.path.basename(file_ref)
        found = basename in transcript_text and (
            "view_file" in transcript_text or "read_file" in transcript_text
        )

        results.append(
            CheckResult(
                name=f"Required read: {basename}",
                passed=found,
                details=f"File '{basename}' was read"
                if found
                else f"Expected view_file call for '{file_ref}'",
                severity="WARNING",
            )
        )

    return results


def check_no_inlining(transcript: list[dict]) -> list[CheckResult]:
    """Check for signs that subagent work was inlined."""
    results = []
    transcript_text = json.dumps(transcript)

    # Heuristic: if transcript mentions Agent() but no invoke_subagent,
    # the orchestrator may have inlined the work
    has_agent_reference = "Agent(" in transcript_text or "subagent_type" in transcript_text
    has_invoke = "invoke_subagent" in transcript_text
    has_define = "define_subagent" in transcript_text

    if has_agent_reference and not has_invoke and not has_define:
        results.append(
            CheckResult(
                name="No inlined agent work",
                passed=False,
                details="Transcript references Agent() but no invoke_subagent/define_subagent found. Work may have been inlined.",
                severity="WARNING",
            )
        )
    else:
        results.append(
            CheckResult(
                name="No inlined agent work",
                passed=True,
                details="No inlining detected",
                severity="WARNING",
            )
        )

    return results


def validate_compliance(
    skill_path: str, transcript_path: Optional[str] = None
) -> ComplianceReport:
    """Run all compliance checks."""
    skill = parse_skill_md(skill_path)
    report = ComplianceReport(skill_name=skill["name"] or os.path.basename(skill_path))

    if transcript_path and os.path.exists(transcript_path):
        transcript = load_transcript(transcript_path)

        # Run checks
        if skill["required_subagents"]:
            report.checks.extend(
                check_subagent_spawns(transcript, skill["required_subagents"])
            )

        report.checks.extend(check_mcp_usage(transcript, skill["required_mcp_calls"]))

        if skill["required_reads"]:
            report.checks.extend(
                check_file_reads(transcript, skill["required_reads"])
            )

        report.checks.extend(check_no_inlining(transcript))
    else:
        report.checks.append(
            CheckResult(
                name="Transcript availability",
                passed=False,
                details=f"Transcript not found at: {transcript_path or 'N/A'}. "
                "Set ANTIGRAVITY_CONVERSATION_ID or provide path.",
                severity="WARNING",
            )
        )

    return report


def main():
    if len(sys.argv) < 2:
        print("Usage: validate-workflow-compliance.py <skill_md_path> [<transcript_path>]", file=sys.stderr)
        sys.exit(2)

    skill_path = sys.argv[1]
    if not os.path.exists(skill_path):
        print(f"Error: SKILL.md not found at {skill_path}", file=sys.stderr)
        sys.exit(2)

    transcript_path = None
    if len(sys.argv) >= 3:
        transcript_path = sys.argv[2]
    else:
        conversation_id = os.environ.get("ANTIGRAVITY_CONVERSATION_ID", "")
        app_data = os.environ.get(
            "ANTIGRAVITY_APP_DATA",
            os.path.expanduser("~/.gemini/antigravity"),
        )
        if conversation_id:
            transcript_path = os.path.join(
                app_data, "brain", conversation_id,
                ".system_generated", "logs", "transcript.jsonl",
            )

    report = validate_compliance(skill_path, transcript_path)
    print(report)
    sys.exit(0 if report.passed else 1)


if __name__ == "__main__":
    main()
