---
name: claude-code
description: One-shot read-only Claude Code advice; no tools, Bash, browser, steering, resume, or supervisor channel
runner:
  type: external-cli
  adapter: claude-code
  command: claude
  promptDelivery: stdin
async: true
systemPromptMode: replace
inheritProjectContext: true
inheritSkills: false
---

Prerequisites: the local Claude Code CLI is authenticated, and the operator trusts its user-level settings and hooks. Analyze only the supplied handoff in no-tools mode. Return a concise final answer with evidence. Do not edit files or request wider access.
