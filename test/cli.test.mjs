import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { runCli, USAGE, VERSION } from "../src/cli.mjs";
import { MARKDOWN_GLOBS, runMarkdownCheck } from "../src/markdown-check.mjs";

function output() {
  const lines = [];
  return { lines, write: (line) => lines.push(line) };
}

async function fixture(files) {
  const root = await mkdtemp(join(tmpdir(), "writ-cli-"));
  for (const [path, contents] of Object.entries(files)) {
    const full = join(root, path);
    await mkdir(join(full, ".."), { recursive: true });
    await writeFile(full, contents);
  }
  return root;
}

test("help and version are successful and do not dispatch commands", async () => {
  for (const [argv, expected] of [["--help", USAGE], ["--version", VERSION]]) {
    const out = output();
    let called = false;
    assert.equal(await runCli({ argv: [argv], stdout: out.write, stderr: out.write, commands: { check: () => { called = true; } } }), 0);
    assert.equal(called, false);
    assert.equal(out.lines[0], expected);
  }
});

test("dispatch uses caller cwd by default and resolves --root relative to it", async () => {
  const calls = [];
  const commands = Object.fromEntries(["check", "routing", "references", "questions"].map((name) => [name, async (options) => { calls.push([name, options.root]); return name === "routing" ? 7 : 0; }]));
  assert.equal(await runCli({ argv: ["check"], cwd: "/consumer", commands }), 0);
  assert.equal(await runCli({ argv: ["routing", "--root", "repo"], cwd: "/consumer", commands }), 7);
  assert.equal(await runCli({ argv: ["questions"], cwd: "/consumer", commands }), 0);
  assert.deepEqual(calls, [["check", "/consumer"], ["routing", resolve("/consumer", "repo")], ["questions", "/consumer"]]);
});

test("missing, unknown, and malformed arguments fail with usage and no dispatch", async () => {
  for (const argv of [[], ["unknown"], ["check", "--root"], ["check", "extra"], ["questions", "--root", "."], ["check", "--version"]]) {
    const out = output();
    let called = false;
    const code = await runCli({ argv, stdout: out.write, stderr: out.write, commands: { check: async () => { called = true; return 0; } } });
    assert.equal(code, 2);
    assert.equal(called, false);
    assert.match(out.lines[0], /^ERROR /);
    assert.equal(out.lines.at(-1), USAGE);
  }
});

test("markdown check passes Writ-owned scope and configuration programmatically", async () => {
  const calls = [];
  const code = await runMarkdownCheck({ root: "/consumer", lint: async (options) => { calls.push(options); return 0; } });
  assert.equal(code, 0);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].argv, [...MARKDOWN_GLOBS]);
  assert.equal(calls[0].directory, "/consumer");
  assert.equal(calls[0].noGlobs, true);
  assert.equal(calls[0].optionsOverride.config.default, false);
  assert.equal(calls[0].optionsOverride.config.MD040, true);
  assert.equal(calls[0].optionsOverride.config["relative-links"], true);
});

test("deterministic check scans only the documented scope and ignores consumer configuration", async (t) => {
  const root = await fixture({
    ".markdownlint-cli2.mjs": "export default { config: { default: true, MD013: true } };\n",
    "AGENTS.md": "# Instructions\n\nA deliberately very long line that would violate consumer-enabled line length but is not part of Writ's fixed rules because consumer configuration is ignored.\n",
    "skills/a/SKILL.md": "---\nname: a\ndescription: A skill.\n---\n# Skill\n\n```text\nok\n```\n",
    "other/bad.md": "# Jump\n\n### Skipped\n",
  });
  t.after(() => rm(root, { recursive: true, force: true }));
  const out = output();
  assert.equal(await runMarkdownCheck({ root, stdout: out.write, stderr: out.write }), 0);

  await writeFile(join(root, "AGENTS.md"), "# Instructions\n\n(text)[missing.md]\n");
  assert.equal(await runMarkdownCheck({ root, stdout: out.write, stderr: out.write }), 1);
  assert(out.lines.some((line) => line.includes("MD011")));
});
