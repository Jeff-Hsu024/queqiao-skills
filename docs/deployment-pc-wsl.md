# Dual Worker deployment: Windows PC and WSL

Verified on 2026-11-19 against Queqiao 0.9.23 and `queqiao-skills` 0.1.0.

Queqiao uses **environment-local** Extension Hubs. Installation and attachment must be performed in **each native environment**, not once for the entire Gateway. Installing the extension does not move or synchronize user skill files between Workers.

## Verified topology

| Environment ID | Worker | Workspace ID | Workspace root | Extension source |
| --- | --- | --- | --- | --- |
| `pc-wins` | `pc-wins` | `jeff` | `C:\Users\Jeff` | `C:\Users\Jeff\orca\projects\queqiao-skills` |
| `linux` (WSL Ubuntu) | `tunnel-wsl` | `ai-stack` | `/home/user/ai-stack` | `/home/user/ai-stack/queqiao-skills` |

### Windows PC

Use a native Windows terminal. Select the Windows Queqiao CLI, not the Linux version:

```powershell
cd C:\Users\Jeff\orca\projects\queqiao-skills
npm ci
npm run check
queqiao extension install . --worker pc-wins --json
queqiao extension list --json
queqiao doctor extension --json
```

The real example skill is installed separately at:

```text
C:\Users\Jeff\.agents\skills\modern-web-guidance\SKILL.md
```

The `jeff` Workspace root includes this path, so the extension discovers it without a custom root. Do **not** copy Windows `node_modules` into WSL.

### WSL Ubuntu

Run these commands **inside WSL**; no Windows shell, WSL Orca CLI, or reverse tunnel changes are necessary:

```bash
cd /home/user/ai-stack
git clone https://github.com/Jeff-Hsu024/queqiao-skills.git
cd queqiao-skills
npm ci
npm run check
queqiao extension install . --worker tunnel-wsl --json
queqiao extension list --json
queqiao doctor extension --json
```

To provide a concrete skill for discovery in the `ai-stack` Workspace, install Modern Web Guidance **within that Workspace**:

```bash
cd /home/user/ai-stack
DISABLE_TELEMETRY=1 npx -y skills add GoogleChrome/modern-web-guidance \
  -s modern-web-guidance -a codex --copy -y --json
```

This places the skill at `/home/user/ai-stack/.agents/skills/modern-web-guidance/SKILL.md`. Global skills outside the Workspace are intentionally not scanned.

### Gateway / Client invocation

Use the stable Queqiao `extension` tool with:

```json
{
  "workspaceId": "ai-stack",
  "environmentId": "linux",
  "operation": "call",
  "extensionId": "dev.queqiao.skills",
  "capability": "skills",
  "arguments": {
    "workspaceId": "ai-stack",
    "operation": "invoke",
    "skill": "modern-web-guidance"
  }
}
```

For PC, change both `workspaceId` fields to `jeff` and `environmentId` to `pc-wins`.

Other inner `operation` values are `list` and `search` (with `query`). `invoke` loads the full `SKILL.md` instruction text and **does not run any scripts**.

## Verification evidence (2026-11-19)

- Both native Extension Hubs attached `dev.queqiao.skills@0.1.0` to their respective Workers.
- Windows `doctor extension`: `ok: true`, 2 extensions, 1 worker, zero issues.
- WSL `doctor extension`: `ok: true`, 1 extension, 1 worker, zero issues.
- Windows `jeff`: `skills.list` returned 4; `skills.invoke("modern-web-guidance")` returned 9,781 characters.
- WSL `ai-stack`: `skills.list` returned 1; `skills.search("modern web")` returned the skill; `skills.invoke("modern-web-guidance")` returned 9,781 characters.
- WSL `npm run check`: TypeScript typecheck, 8 tests, and build all passed.

If a Worker is missing from a remote Gateway inventory, distinguish **Gateway routing health** from the local native `queqiao worker status --worker <name> --json`; the inventory can be temporarily stale. Verify both before restarting a healthy Worker.

Local package source installs are not npm releases. After modifying and rebuilding an attached local extension, detach/attach it (or restart its native Worker) to reload the module.
