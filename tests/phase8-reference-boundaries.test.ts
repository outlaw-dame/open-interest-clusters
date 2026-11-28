import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const EXAMPLES = path.join(ROOT, "examples");

function exampleSources(): { file: string; text: string }[] {
  return readdirSync(EXAMPLES, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".ts"))
    .map((entry) => ({ file: entry.name, text: readFileSync(path.join(EXAMPLES, entry.name), "utf8") }));
}

/** Every module specifier in `import ... from "x"`, `export ... from "x"` and `import("x")`. */
function specifiers(text: string): string[] {
  const found: string[] = [];
  for (const match of text.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)["']([^"']+)["']/gu)) found.push(match[1] ?? "");
  return found;
}

test("examples import only the public entrypoint, other examples and node built-ins", () => {
  const sources = exampleSources();
  assert.ok(sources.length >= 4, "the examples are there to be checked");
  const outside: string[] = [];
  for (const { file, text } of sources) {
    for (const specifier of specifiers(text)) {
      const sibling = specifier.startsWith("./") && !specifier.slice(2).includes("/");
      if (specifier !== "../src/index.js" && !sibling && !specifier.startsWith("node:")) outside.push(`${file}: ${specifier}`);
    }
  }
  assert.deepEqual(outside, []);
});

test("examples do not reach the network or the disk, and do not add dependencies", () => {
  for (const { file, text } of exampleSources()) {
    assert.doesNotMatch(text, /\bfetch\s*\(|XMLHttpRequest|WebSocket|node:(?:http|https|net|dgram|fs|child_process)/u, file);
    assert.doesNotMatch(text, /\bdocument\.|\bwindow\.|\bindexedDB\b/u, `${file} must not touch a DOM or a browser store`);
  }
  const manifest = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8")) as { dependencies: Record<string, string> };
  assert.deepEqual(Object.keys(manifest.dependencies).sort(), ["ajv", "ajv-formats"]);
});

test("the published file list leaves out the compiled examples", () => {
  const manifest = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8")) as { files: string[] };
  assert.ok(manifest.files.includes("dist"));
  assert.ok(manifest.files.includes("!dist/examples"));
  assert.ok(manifest.files.indexOf("!dist/examples") > manifest.files.indexOf("dist"), "the exclusion comes after the pattern it trims");
});

test("pnpm pack lists the library and none of the compiled examples", (context) => {
  let listing: string;
  try {
    listing = execFileSync("pnpm", ["pack", "--dry-run"], { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 60_000 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") { context.skip("pnpm is not on the PATH here. CI runs the same check."); return; }
    throw error;
  }
  assert.match(listing, /dist\/src\/index\.js/u);
  assert.doesNotMatch(listing, /dist\/examples\//u);
});
