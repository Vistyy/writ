import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { MODEL, QUESTIONS, classify, discoverSkills, readSkillMetadata, runSemanticLint } from "./semantic-lint.mjs";

async function fixture(files) {
  const root = await mkdtemp(join(tmpdir(), "semantic-lint-"));
  for (const [path, contents] of Object.entries(files)) {
    const fullPath = join(root, path);
    await mkdir(join(fullPath, ".."), { recursive: true });
    await writeFile(fullPath, contents);
  }
  return root;
}

const skill = (frontmatter, body = "PRIVATE BODY") => `---\n${frontmatter}\n---\n${body}\n`;
const answer = (noul) => ({ type: "noul", noul });
const response = (probabilities = {}) => ({
  model: MODEL,
  answers: Object.fromEntries(Object.keys(QUESTIONS).map((id) => [id, answer(probabilities[id] ?? 0.9)])),
  usage: { input_tokens: 10, output_tokens: 4 },
});

function output() {
  const lines = [];
  return { lines, write: (line) => lines.push(line) };
}

test("discovers repository SKILL.md files in stable order and ignores dependencies", async (t) => {
  const root = await fixture({
    "z/SKILL.md": "",
    "a/nested/SKILL.md": "",
    "node_modules/pkg/SKILL.md": "",
    "a/OTHER.md": "",
  });
  t.after(() => rm(root, { recursive: true, force: true }));
  assert.deepEqual((await discoverSkills(root)).map((path) => path.slice(root.length + 1)), ["a/nested/SKILL.md", "z/SKILL.md"]);
});

test("robust YAML parsing handles folded descriptions and exemption before required fields", () => {
  assert.deepEqual(readSkillMetadata(skill("name: example\ndescription: >\n  A folded\n  description.")), {
    skipped: false,
    skill: { name: "example", description: "A folded description.\n" },
  });
  assert.deepEqual(readSkillMetadata(skill("disable-model-invocation: true")), { skipped: true });
});

test("one request per applicable skill sends only public routing metadata", async (t) => {
  const root = await fixture({
    "skills/public/SKILL.md": skill("name: public\ndescription: Use for public work.\nlicense: secret-license", "SECRET BODY AND PATH"),
    "user-skills/manual/SKILL.md": skill("disable-model-invocation: true\nname: manual\ndescription: never send me"),
  });
  t.after(() => rm(root, { recursive: true, force: true }));
  const requests = [];
  const out = output();
  const code = await runSemanticLint({
    root,
    client: { systemOne: async (request) => (requests.push(request), response()) },
    stdout: out.write,
    stderr: out.write,
  });

  assert.equal(code, 0);
  assert.equal(requests.length, 1);
  assert.deepEqual(requests[0], {
    model: MODEL,
    state: { skill: { name: "public", description: "Use for public work." } },
    questions: QUESTIONS,
  });
  const serializedState = JSON.stringify(requests[0].state);
  assert.doesNotMatch(serializedState, /SECRET|license|SKILL\.md|skills\//);
  assert.match(out.lines.at(-1), /model=jev-1\.13\.0 input_tokens=10 output_tokens=4 evaluated=1 skipped=1/);
});

test("classification preserves inclusive threshold boundaries", () => {
  assert.equal(classify(1 / 3), "finding");
  assert.equal(classify(1 / 3 + Number.EPSILON), "unknown");
  assert.equal(classify(2 / 3 - Number.EPSILON), "unknown");
  assert.equal(classify(2 / 3), "pass");
});

test("findings and unknowns are advisory, raw, actionable, and obey missing precedence", async (t) => {
  const root = await fixture({ "SKILL.md": skill("name: vague\ndescription: Helpful things.") });
  t.after(() => rm(root, { recursive: true, force: true }));
  const out = output();
  const code = await runSemanticLint({
    root,
    client: { systemOne: async () => response({
      capability_stated: 0.2,
      capability_specific: 0.1,
      activation_stated: 0.3333333333333333,
      activation_specific: 0.5,
    }) },
    stdout: out.write,
    stderr: out.write,
  });

  assert.equal(code, 0);
  assert(out.lines.some((line) => /FINDING .*capability_stated p=0\.2: Add/.test(line)));
  assert(out.lines.some((line) => /FINDING .*activation_stated p=0\.3333333333333333: Add/.test(line)));
  assert(!out.lines.some((line) => line.includes("capability_specific")));
  assert(!out.lines.some((line) => line.includes("activation_specific")));
  assert(out.lines.some((line) => line.includes("[advisory]")));
});

test("specificity unknowns remain visible when presence passes", async (t) => {
  const root = await fixture({ "SKILL.md": skill("name: broad\ndescription: Use this to help.") });
  t.after(() => rm(root, { recursive: true, force: true }));
  const out = output();
  const code = await runSemanticLint({
    root,
    client: { systemOne: async () => response({ capability_specific: 0.5, activation_specific: 0.4 }) },
    stdout: out.write,
    stderr: out.write,
  });
  assert.equal(code, 0);
  assert(out.lines.some((line) => /UNKNOWN .*capability_specific p=0\.5/.test(line)));
  assert(out.lines.some((line) => /UNKNOWN .*activation_specific p=0\.4/.test(line)));
});

test("malformed applicable metadata is fatal without a request", async (t) => {
  const root = await fixture({ "SKILL.md": skill("name: [broken\ndescription: nope") });
  t.after(() => rm(root, { recursive: true, force: true }));
  let called = false;
  const errors = output();
  const code = await runSemanticLint({
    root,
    client: { systemOne: async () => { called = true; } },
    stdout: () => {},
    stderr: errors.write,
  });
  assert.equal(code, 1);
  assert.equal(called, false);
  assert.match(errors.lines[0], /invalid YAML frontmatter/);
});

test("provider failures are fatal", async (t) => {
  const root = await fixture({ "SKILL.md": skill("name: valid\ndescription: Use when testing failures.") });
  t.after(() => rm(root, { recursive: true, force: true }));
  const errors = output();
  const code = await runSemanticLint({
    root,
    client: { systemOne: async () => { throw new Error("authentication rejected"); } },
    stdout: () => {},
    stderr: errors.write,
  });
  assert.equal(code, 1);
  assert.deepEqual(errors.lines, ["ERROR authentication rejected"]);
});
