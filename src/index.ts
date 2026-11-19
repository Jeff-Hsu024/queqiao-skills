import { parse as parseYaml } from "yaml";
import { z } from "zod";
import type { QueqiaoExtension, WorkerExtensionContext } from "@tibame201020/queqiao/extension";

export const EXTENSION_ID = "dev.queqiao.skills";
export const EXTENSION_VERSION = "0.1.0";

/** The caller can override roots; all paths remain inside the selected Queqiao Workspace. */
const DEFAULT_ROOTS = [".agents/skills", ".codex/skills", ".claude/skills", "skills"] as const;
const MAX_SKILL_LINES = 1500;
const MAX_SCAN_PAGES = 4;
const PAGE_SIZE = 500;
const pathSchema = z.string().min(1).max(4096);
export const inputSchema = z.object({
  workspaceId: z.string().min(1).max(64),
  operation: z.enum(["list", "search", "invoke"]),
  query: z.string().min(1).max(200).optional(),
  skill: pathSchema.optional(),
  roots: z.array(pathSchema).min(1).max(12).optional(),
  limit: z.number().int().min(1).max(100).optional(),
}).strict();

export type SkillsInput = z.infer<typeof inputSchema>;
type Reader = Pick<WorkerExtensionContext["capabilities"], "listDirectory" | "readFile">;
type Context = { workspaceId: string; capabilities: Reader };
type Entry = { path: string; name: string; type: string };
type Listing = { entries: Entry[]; nextCursor?: string | null; truncated?: boolean };
type Read = { text: string; totalLines: number };
export type SkillInfo = { id: string; name: string; description: string; skillFile: string; root: string };
type Catalog = { skills: SkillInfo[]; truncated: boolean; missingRoots: string[]; errors: string[] };

function slash(p: string): string { return p.replaceAll("\\", "/").replace(/\/+$/, "") || "."; }
function isMissing(error: unknown): boolean {
  const value = error as { code?: unknown; message?: unknown } | null;
  return value?.code === "ENOENT" || (typeof value?.message === "string" && /ENOENT|not found/i.test(value.message));
}
function asListing(value: unknown): Listing {
  if (!value || typeof value !== "object" || !Array.isArray((value as Listing).entries)) {
    throw new Error("Queqiao listDirectory returned invalid entries");
  }
  return value as Listing;
}
function asRead(value: unknown): Read {
  if (!value || typeof value !== "object") throw new Error("Queqiao readFile returned invalid content");
  const v = value as Read;
  if (typeof v.text !== "string" || typeof v.totalLines !== "number") {
    throw new Error("Queqiao readFile returned invalid content");
  }
  if (v.totalLines > MAX_SKILL_LINES) throw new Error("SKILL.md exceeds the supported line limit");
  return v;
}
async function readSkill(context: Context, path: string): Promise<string> {
  const result = asRead(await context.capabilities.readFile(path, 0, MAX_SKILL_LINES));
  return result.text;
}
function metadata(source: string, fallbackName: string): { name: string; description: string } {
  if (!source.startsWith("---\n")) return { name: fallbackName, description: "" };
  const close = source.indexOf("\n---", 4);
  if (close < 0) return { name: fallbackName, description: "" };
  const data: unknown = parseYaml(source.slice(4, close));
  if (!data || typeof data !== "object") return { name: fallbackName, description: "" };
  const attributes = data as Record<string, unknown>;
  return {
    name: typeof attributes.name === "string" && attributes.name.trim() ? attributes.name.trim() : fallbackName,
    description: typeof attributes.description === "string" ? attributes.description.trim() : "",
  };
}
async function catalog(context: Context, roots: readonly string[]): Promise<Catalog> {
  const found = new Map<string, SkillInfo>();
  const missingRoots: string[] = [];
  const errors: string[] = [];
  let truncated = false;
  for (const inputRoot of roots) {
    const root = slash(inputRoot);
    const entries: Entry[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < MAX_SCAN_PAGES; page++) {
      let listing: Listing;
      try {
        listing = asListing(await context.capabilities.listDirectory(root, 2, PAGE_SIZE, cursor, true));
      } catch (error) {
        if (isMissing(error)) { missingRoots.push(root); break; }
        throw error; // Never mask permission or Workspace-containment failures.
      }
      entries.push(...listing.entries);
      cursor = listing.nextCursor || undefined;
      if (!cursor) { truncated ||= Boolean(listing.truncated); break; }
      if (page === MAX_SCAN_PAGES - 1) truncated = true;
    }
    for (const entry of entries) {
      if (entry.type !== "file" || entry.name !== "SKILL.md") continue;
      const file = slash(entry.path);
      // Only a root SKILL.md or its immediate child skill directories.
      const prefix = root === "." ? "" : root + "/";
      if (!file.startsWith(prefix)) continue;
      const relative = file.slice(prefix.length);
      if (!/^(?:[^/]+\/)?SKILL\.md$/.test(relative)) continue;
      const id = file.slice(0, -"/SKILL.md".length);
      if (found.has(id)) continue;
      try {
        const source = await readSkill(context, file);
        const fallback = relative === "SKILL.md" ? root.split("/").at(-1) || "workspace" : relative.split("/")[0]!;
        const attributes = metadata(source, fallback);
        found.set(id, { id, ...attributes, skillFile: file, root });
      } catch (error) {
        // Expose a safe per-file diagnostic so a broken skill does not hide other skills.
        errors.push(file + ": " + (error instanceof Error ? error.message : String(error)));
      }
    }
  }
  return { skills: [...found.values()].sort((a, b) => a.id.localeCompare(b.id)), truncated, missingRoots, errors };
}
export async function executeSkills(raw: unknown, context: Context): Promise<unknown> {
  const input = inputSchema.parse(raw);
  if (input.workspaceId !== context.workspaceId) throw new Error("Workspace mismatch");
  if (input.operation === "search" && !input.query) throw new Error("Search requires query");
  if (input.operation === "invoke" && !input.skill) throw new Error("Invoke requires skill");
  const roots = input.roots ?? DEFAULT_ROOTS;
  const result = await catalog(context, roots);
  if (input.operation === "invoke") {
    const matches = result.skills.filter((item) => item.id === input.skill || item.name === input.skill);
    if (matches.length === 0) throw new Error("Skill not found inside the selected Workspace: " + input.skill);
    if (matches.length !== 1) throw new Error("Ambiguous skill name; invoke by id/path: " + input.skill);
    const skill = matches[0]!;
    const content = await readSkill(context, skill.skillFile);
    return { workspaceId: context.workspaceId, operation: "invoke", skill, content, note: "Instructions loaded. No skill scripts or commands were executed." };
  }
  let skills = result.skills;
  if (input.operation === "search") {
    const terms = input.query!.toLowerCase().trim().split(/\s+/);
    skills = skills.filter((item) => terms.every((term) =>
      (item.name + " " + item.description + " " + item.id).toLowerCase().includes(term)));
  }
  const limit = input.limit ?? 50;
  return {
    workspaceId: context.workspaceId, operation: input.operation,
    skills: skills.slice(0, limit),
    total: skills.length, truncated: result.truncated || skills.length > limit,
    missingRoots: result.missingRoots, errors: result.errors,
  };
}
export const queqiaoExtension: QueqiaoExtension<WorkerExtensionContext> = {
  manifest: {
    id: EXTENSION_ID, version: EXTENSION_VERSION, displayName: "Queqiao Skills",
    supportedEnvironments: ["windows", "linux", "darwin"],
  },
  activate(api) {
    api.registerTool({
      name: "skills",
      title: "Agent Skills",
      description: "Discover, search, and load SKILL.md instructions from directories contained within the selected Workspace. Loading a skill never executes its scripts.",
      inputSchema,
      requiredCapabilities: ["workspace:read"],
      risk: "read",
      annotations: {
        readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true,
      },
      execute: executeSkills,
    });
  },
};
export default queqiaoExtension;
