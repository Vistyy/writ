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

test("questions exactly implement the calibrated name-plus-description contract", () => {
  assert.deepEqual(QUESTIONS, {
    capability_is_stated: {
      type: "noul",
      instructions: "Do `skill.name` and `skill.description` state what capability this skill provides?",
      criteria: {
        true: "They state an action the skill performs, a judgment it makes, knowledge it supplies, or an outcome it produces.",
        false: "They state only a topic, persona, aspiration, or invocation condition without saying what the skill contributes.",
      },
    },
    capability_is_specific: {
      type: "noul",
      instructions: "Do `skill.name` and `skill.description` identify a capability specific enough to distinguish this skill from a generic assistant?",
      criteria: {
        true: "They identify a bounded action, judgment, knowledge, or outcome.",
        false: "They provide only generic help, guidance, expertise, quality improvement, a topic, persona, aspiration, or invocation condition.",
      },
    },
    activation_is_stated: {
      type: "noul",
      instructions: "Do `skill.name` and `skill.description` identify at least one task, input, artifact, event, or condition in which this skill is relevant?",
      criteria: {
        true: "They name a recognizable task, input, artifact, event, or condition for using the skill.",
        false: "They provide no activation information, or only circular wording such as 'when needed', 'when appropriate', or 'when using this skill'.",
      },
    },
    activation_is_specific: {
      type: "noul",
      instructions: "Do `skill.name` and `skill.description` identify an activation condition specific enough for an agent to decide whether a user request should invoke this skill?",
      criteria: {
        true: "They identify a recognizable user intent, task, input, artifact, event, or condition that makes the skill relevant.",
        false: "They name only a broad domain or category, or use vague or circular activation wording.",
      },
    },
    routing_metadata_is_focused: {
      type: "noul",
      instructions: "Do `skill.name` and `skill.description` stay focused on identifying the skill's capability and deciding whether it is relevant?",
      criteria: {
        true: "They contain capability, activation conditions, meaningful non-matches, or brief domain context needed to distinguish the skill.",
        false: "They tell the invoked agent how to do the work, such as directing it to read documentation, run commands, follow steps, or apply an implementation method, or include extended examples or rationale not needed for routing.",
      },
    },
  });
});

test("discovers nested skills only in repository-owned instruction roots", async (t) => {
  const root = await fixture({
    "skills/z/SKILL.md": "",
    "skills/a/nested/SKILL.md": "",
    "user-skills/local/SKILL.md": "",
    "workgraph/skills/leaked/SKILL.md": "",
    "node_modules/pkg/SKILL.md": "",
    "other/SKILL.md": "",
  });
  t.after(() => rm(root, { recursive: true, force: true }));
  assert.deepEqual((await discoverSkills(root)).map((path) => path.slice(root.length + 1)), [
    "skills/a/nested/SKILL.md",
    "skills/z/SKILL.md",
    "user-skills/local/SKILL.md",
  ]);
});

test("discovery tolerates either or both instruction roots being absent", async (t) => {
  const oneRoot = await fixture({ "skills/only/SKILL.md": "" });
  const noRoots = await fixture({ "elsewhere/SKILL.md": "" });
  t.after(() => Promise.all([rm(oneRoot, { recursive: true, force: true }), rm(noRoots, { recursive: true, force: true })]));
  assert.deepEqual((await discoverSkills(oneRoot)).map((path) => path.slice(oneRoot.length + 1)), ["skills/only/SKILL.md"]);
  assert.deepEqual(await discoverSkills(noRoots), []);
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
  const root = await fixture({ "skills/vague/SKILL.md": skill("name: vague\ndescription: Helpful things.") });
  t.after(() => rm(root, { recursive: true, force: true }));
  const out = output();
  const code = await runSemanticLint({
    root,
    client: { systemOne: async () => response({
      capability_is_stated: 0.2,
      capability_is_specific: 0.1,
      activation_is_stated: 0.3333333333333333,
      activation_is_specific: 0.5,
    }) },
    stdout: out.write,
    stderr: out.write,
  });

  assert.equal(code, 0);
  assert(out.lines.some((line) => /FINDING .*capability_is_stated p=0\.2: State/.test(line)));
  assert(out.lines.some((line) => /FINDING .*activation_is_stated p=0\.3333333333333333: Name a concrete task, input, artifact, event, or condition/.test(line)));
  assert(!out.lines.some((line) => line.includes("capability_is_specific")));
  assert(!out.lines.some((line) => line.includes("activation_is_specific")));
  assert(out.lines.some((line) => line.includes("[advisory]")));
  assert.doesNotMatch(out.lines.join("\n"), /Use when|when not to use|exclusion/i);
});

test("routing focus findings are advisory and actionable", async (t) => {
  const root = await fixture({
    "skills/procedural/SKILL.md": skill("name: procedural\ndescription: Reviews APIs. Use for API work. First read every document, then run all commands."),
  });
  t.after(() => rm(root, { recursive: true, force: true }));
  const out = output();
  const code = await runSemanticLint({
    root,
    client: { systemOne: async () => response({ routing_metadata_is_focused: 0.2 }) },
    stdout: out.write,
    stderr: out.write,
  });
  assert.equal(code, 0);
  assert(out.lines.some((line) => /FINDING .*routing_metadata_is_focused p=0\.2: Keep the description to capability and routing; move post-invocation procedure into the skill body\. \[advisory\]/.test(line)));
});

test("specificity unknowns remain visible when presence passes", async (t) => {
  const root = await fixture({ "skills/broad/SKILL.md": skill("name: broad\ndescription: Use this to help.") });
  t.after(() => rm(root, { recursive: true, force: true }));
  const out = output();
  const code = await runSemanticLint({
    root,
    client: { systemOne: async () => response({ capability_is_specific: 0.5, activation_is_specific: 0.4 }) },
    stdout: out.write,
    stderr: out.write,
  });
  assert.equal(code, 0);
  assert(out.lines.some((line) => /UNKNOWN .*capability_is_specific p=0\.5/.test(line)));
  assert(out.lines.some((line) => /UNKNOWN .*activation_is_specific p=0\.4/.test(line)));
});

test("all applicable metadata is validated before any request", async (t) => {
  const root = await fixture({
    "skills/a-valid/SKILL.md": skill("name: valid\ndescription: Valid routing metadata."),
    "skills/z-broken/SKILL.md": skill("name: [broken\ndescription: nope"),
  });
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

test("a returned model identity other than the exact pinned model is fatal", async (t) => {
  const root = await fixture({ "skills/valid/SKILL.md": skill("name: valid\ndescription: Run semantic routing checks.") });
  t.after(() => rm(root, { recursive: true, force: true }));
  const errors = output();
  const code = await runSemanticLint({
    root,
    client: { systemOne: async () => ({ ...response(), model: "jev-1.13.1" }) },
    stdout: () => {},
    stderr: errors.write,
  });
  assert.equal(code, 1);
  assert.deepEqual(errors.lines, ["ERROR response model identity must be exactly jev-1.13.0; received jev-1.13.1"]);
});

test("provider failures are fatal", async (t) => {
  const root = await fixture({ "skills/valid/SKILL.md": skill("name: valid\ndescription: Use when testing failures.") });
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
