# Queqiao Skills

Read-only Agent Skills discovery and invocation through the Queqiao Worker Extension SDK.

**Repository owner:** [Jeff-Hsu024](https://github.com/Jeff-Hsu024) · **Extension ID:** `dev.queqiao.skills` · **License:** MIT

## Features

- Lists Agent Skills by reading `SKILL.md` files.
- Searches skill names/descriptions without executing any skill scripts.
- Invokes a skill by **returning its full instructions** to the caller; the agent decides whether and how to follow them.
- Uses Queqiao's existing Workspace-contained `listDirectory` / `readFile` capability helpers, which reject escapes and symlink traversal.
- Does **not** modify Queqiao Core, execute skill code, install third-party skills, or create an MCP server.

## Supported skill roots

Default directories relative to the selected Queqiao Workspace:

| Root | Typical purpose |
| --- | --- |
| `.agents/skills` | Universal agent skills |
| `.codex/skills` | Codex skills |
| `.claude/skills` | Claude skills |
| `skills` | Workspace/project skills |

Skill folders must be at most one level beneath a configured root: e.g. `.agents/skills/modern-web-guidance/SKILL.md`. Custom roots can be supplied per call; they must remain inside the Workspace. A user's global skills directory outside the Workspace is **not** implicitly accessible. Configure the Workspace or copy/link only within its declared containment constraints.

## Install

Requirements: Node >= 22.19, npm and Queqiao with Extension SDK v1.

```bash
npm install
npm run check
queqiao extension install . --worker pc-wins
queqiao extension show dev.queqiao.skills
queqiao doctor extension
```

The Queqiao installation command registers the **local built package** in the Extension Hub. It does not upload the repository to npm.

## Tool contract

The single public `skills` tool has the following operations:

- `list`: discover skill metadata with optional `roots` and `limit`.
- `search`: same, filtered by `query` (case-insensitive; all words must match).
- `invoke`: return a skill's `SKILL.md` instructions by exact `skill` name or ID/path. Names that collide must be disambiguated by ID.

Example invocation payloads, for use through the stable Queqiao extension proxy:

```json
{"workspaceId":"jeff","operation":"list"}
{"workspaceId":"jeff","operation":"search","query":"web guidance"}
{"workspaceId":"jeff","operation":"invoke","skill":"modern-web-guidance"}
```

The *proxy* call must also identify the `dev.queqiao.skills` extension and `skills` capability; CLI/UI clients may use their own proxy envelope.

## Design boundaries

This extension follows Queqiao's D15 Discovery Boundary: Core remains a generic Workspace primitive provider; skill discovery/interpretation belongs to an extension or client. No direct process execution is exposed by this extension.

The supported catalog scan is bounded to four 500-entry pages per root and up to 1,500 lines per skill; deep nested directories are ignored. Read errors are reported per file. Missing default roots are not errors, while containment errors are surfaced rather than suppressed.

## Development

```bash
npm run typecheck
npm test
npm run build
```

Queqiao's Extension Hub caches a local module when a Worker attaches. After rebuilding source, detach and reattach the extension (or restart the Worker) before validating live calls.

## Upstream references

- Queqiao Extension SDK v1 — integration target.
- [Modern Web Guidance](https://github.com/GoogleChrome/modern-web-guidance) — test skill, not bundled or redistributed.
