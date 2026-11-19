import { describe, expect, it, vi } from "vitest";
import { executeSkills, queqiaoExtension } from "../src/index.js";

const modern = [
  "---",
  "name: modern-web-guidance",
  "description: |",
  "  Search modern browser platform best practices.",
  "  Prefer native APIs.",
  "---",
  "# Modern Web Guidance",
  "Use search before changing CSS.",
].join("\n");
const secondary = "---\nname: tester\n description: invalid\n---\n# Tester"; // intentionally invalid metadata

function makeContext(options?: { duplicates?: boolean; unsafe?: boolean }) {
  const sources: Record<string, string> = {
    ".agents/skills/modern-web-guidance/SKILL.md": modern,
    "skills/tester/SKILL.md": "# Tester\nTesting requirements.",
    ...(options?.duplicates ? { "skills/duplicate/SKILL.md": "---\nname: modern-web-guidance\ndescription: duplicate\n---\n# Duplicate" } : {}),
  };
  const rootFiles: Record<string, string[]> = {
    ".agents/skills": [".agents/skills/modern-web-guidance/SKILL.md"],
    "skills": ["skills/tester/SKILL.md", ...(options?.duplicates ? ["skills/duplicate/SKILL.md"] : [])],
    ".claude/skills": [],
    ".codex/skills": [],
  };
  const readFile = vi.fn(async (path: string) => {
    if (!(path in sources)) throw new Error("ENOENT");
    const text = sources[path]!;
    return { path, text, totalLines: text.split("\n").length };
  });
  const listDirectory = vi.fn(async (path: string) => {
    if (options?.unsafe && (path === ".." || path.startsWith("../"))) throw new Error("Path escapes the Workspace");
    if (!(path in rootFiles)) throw new Error("ENOENT");
    return {
      entries: rootFiles[path]!.map((p) => ({ path: p, name: "SKILL.md", type: "file" })),
      truncated: false,
      nextCursor: null,
    };
  });
  return { context: { workspaceId: "jeff", capabilities: { readFile, listDirectory } }, readFile, listDirectory };
}

describe("Queqiao Skills", () => {
  it("registers one read-only public capability", () => {
    const registered: Array<{ name: string; risk: string; requiredCapabilities: readonly string[] }> = [];
    queqiaoExtension.activate({ registerTool: (v) => registered.push(v), extendTool: vi.fn(), replaceTool: vi.fn() });
    expect(registered).toHaveLength(1);
    expect(registered[0]).toMatchObject({ name: "skills", risk: "read", requiredCapabilities: ["workspace:read"] });
  });

  it("lists skills in Workspace-contained defaults and parses YAML descriptions", async () => {
    const { context } = makeContext();
    const result = await executeSkills({ workspaceId: "jeff", operation: "list" }, context) as any;
    expect(result.total).toBe(2);
    expect(result.skills.map((x: any) => x.name)).toContain("modern-web-guidance");
    expect(result.skills.find((x: any) => x.name === "modern-web-guidance")?.description).toContain("native APIs");
    expect(result.errors).toEqual([]);
  });

  it("searches all query terms and supports missing roots", async () => {
    const { context } = makeContext();
    const result = await executeSkills({ workspaceId: "jeff", operation: "search", query: "browser native" }, context) as any;
    expect(result.skills).toHaveLength(1);
    expect(result.skills[0].name).toBe("modern-web-guidance");
    const missing = await executeSkills({
      workspaceId: "jeff", operation: "list", roots: ["does-not-exist"]
    }, context) as any;
    expect(missing.missingRoots).toEqual(["does-not-exist"]);
  });

  it("invokes by name without executing any programs", async () => {
    const { context } = makeContext();
    const result = await executeSkills({ workspaceId: "jeff", operation: "invoke", skill: "modern-web-guidance" }, context) as any;
    expect(result.content).toContain("# Modern Web Guidance");
    expect(result.note).toContain("No skill scripts");
    expect(Object.keys(context.capabilities).sort()).toEqual(["listDirectory", "readFile"]);
  });

  it("rejects ambiguous names but permits an exact path", async () => {
    const { context } = makeContext({ duplicates: true });
    await expect(executeSkills({ workspaceId: "jeff", operation: "invoke", skill: "modern-web-guidance" }, context))
      .rejects.toThrow("Ambiguous skill name");
    const result = await executeSkills({ workspaceId: "jeff", operation: "invoke", skill: "skills/duplicate" }, context) as any;
    expect(result.content).toContain("Duplicate");
  });

  it("rejects Workspace mismatches and missing inputs", async () => {
    const { context } = makeContext();
    await expect(executeSkills({ workspaceId: "wrong", operation: "list" }, context)).rejects.toThrow("Workspace mismatch");
    await expect(executeSkills({ workspaceId: "jeff", operation: "search" }, context)).rejects.toThrow("Search requires query");
    await expect(executeSkills({ workspaceId: "jeff", operation: "invoke" }, context)).rejects.toThrow("Invoke requires skill");
  });

  it("never swallows containment errors from the Worker", async () => {
    const { context } = makeContext({ unsafe: true });
    await expect(executeSkills({
      workspaceId: "jeff", operation: "list", roots: ["../"]
    }, context)).rejects.toThrow("Path escapes the Workspace");
  });

  it("validates inputs to avoid arbitrary input shapes", async () => {
    const { context } = makeContext();
    await expect(executeSkills({
      workspaceId: "jeff", operation: "list", extra: "unexpected"
    }, context)).rejects.toThrow();
  });
});
