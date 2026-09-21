import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { REFERENCE_MODEL, discoverInstructionMarkdown, extractReferenceOccurrences, main, resolveOccurrenceTarget, runReferenceLint } from "../src/reference-lint.mjs";
import { REFERENCE_CONTRACTS, REFERENCE_DEPENDENCIES, consultationQuestion, expectedExistingQuestion, triggerQuestion, validateReferenceContracts } from "../src/reference-contracts.mjs";

async function fixture(files) {
  const root = await mkdtemp(join(tmpdir(), "reference-lint-"));
  for (const [path, contents] of Object.entries(files)) {
    const full = join(root, path); await mkdir(join(full, ".."), { recursive: true }); await writeFile(full, contents);
  }
  return root;
}
const answer = (noul) => ({ type: "noul", noul });
function response(request, values = {}, override = {}) {
  return { model: REFERENCE_MODEL, answers: Object.fromEntries(Object.keys(request.questions).map((id) => [id, answer(values[id] ?? (id.endsWith("_expected") ? 0.1 : 0.9))])), usage: { input_tokens: 12, output_tokens: 4 }, ...override };
}
function output() { const lines = []; return { lines, write: (line) => lines.push(line) }; }

test("discovers exactly owned Markdown scope deterministically and tolerates absent roots", async (t) => {
  const root = await fixture({ "SYSTEM.md": "", "AGENTS.md": "", "skills/z/B.md": "", "skills/a/A.md": "", "user-skills/U.md": "", "other/X.md": "", "skills/no.txt": "" });
  t.after(() => rm(root, { recursive: true, force: true }));
  assert.deepEqual((await discoverInstructionMarkdown(root)).map((path) => path.slice(root.length + 1)), ["AGENTS.md", "skills/a/A.md", "skills/z/B.md", "SYSTEM.md", "user-skills/U.md"]);
  const empty = await fixture({ "elsewhere/x.md": "" }); t.after(() => rm(empty, { recursive: true, force: true }));
  assert.deepEqual(await discoverInstructionMarkdown(empty), []);
});

test("markdown-it extraction uses headings and source maps for paragraphs and list items", () => {
  const source = `---\nname: ignored\ndescription: '[front](secret.md)'\n---\n# Build API\nRead [the guide](docs/guide.md#setup) before changes.\n\n- When releasing, consult\n  [policy](docs/policy.md).\n  - nested text\n\nTitle\n-----\nUse \`docs/runbook.md\`.\n\n\` .md \` and \`.md\` are not paths.\n\n    [indented](docs/no.md)\n\n\`\`\`md\n[fenced](docs/nope.md) and \`docs/nope.md\`\n\`\`\`\n[web](https://example.com/x.md) [root](/x.md) [hash](#x) [bad](bad%ZZ.md)\n`;
  const found = extractReferenceOccurrences(source, "AGENTS.md");
  assert.deepEqual(found.map(({ kind, line, heading, span, text, target, path }) => ({ kind, line, heading, span, text, target, path })), [
    { kind: "link", line: 6, heading: "Build API", span: "Read [the guide](docs/guide.md#setup) before changes.", text: "the guide", target: "docs/guide.md#setup", path: "docs/guide.md" },
    { kind: "link", line: 9, heading: "Build API", span: "- When releasing, consult\n  [policy](docs/policy.md).\n  - nested text", text: "policy", target: "docs/policy.md", path: "docs/policy.md" },
    { kind: "backtick", line: 14, heading: "Title", span: "Use `docs/runbook.md`.", text: "docs/runbook.md", target: "docs/runbook.md", path: "docs/runbook.md" },
  ]);
});

test("attributes repeated and multiline parsed link forms to their own source lines", () => {
  const source = `# References
Repeated [guide](docs/guide.md).
Repeated [guide](docs/guide.md).
Paths \`docs/path.md\` here.
Paths \`docs/path.md\` again.
Label guide appears before the multiline [guide](
  docs/multiline.md
).
Reference [full][manual], [collapsed][], [shortcut], [angle](<docs/auto.md>), and <https://example.com/file.md>.

[manual]: docs/full.md
[collapsed]: docs/collapsed.md
[shortcut]: docs/shortcut.md
`;
  assert.deepEqual(extractReferenceOccurrences(source).map(({ kind, line, target }) => ({ kind, line, target })), [
    { kind: "link", line: 2, target: "docs/guide.md" },
    { kind: "link", line: 3, target: "docs/guide.md" },
    { kind: "backtick", line: 4, target: "docs/path.md" },
    { kind: "backtick", line: 5, target: "docs/path.md" },
    { kind: "link", line: 6, target: "docs/multiline.md" },
    { kind: "link", line: 9, target: "docs/full.md" },
    { kind: "link", line: 9, target: "docs/collapsed.md" },
    { kind: "link", line: 9, target: "docs/shortcut.md" },
    { kind: "link", line: 9, target: "docs/auto.md" },
  ]);
});

test("extracts table-cell links and backticks with row spans and heading context", () => {
  const source = `# Matrix
| Action | Reference |
| --- | --- |
| Read | [guide](docs/guide.md) and \`docs/runbook.md\` |
`;
  assert.deepEqual(extractReferenceOccurrences(source).map(({ kind, line, heading, span, target }) => ({ kind, line, heading, span, target })), [
    { kind: "link", line: 4, heading: "Matrix", span: "| Read | [guide](docs/guide.md) and `docs/runbook.md` |", target: "docs/guide.md" },
    { kind: "backtick", line: 4, heading: "Matrix", span: "| Read | [guide](docs/guide.md) and `docs/runbook.md` |", target: "docs/runbook.md" },
  ]);
});

test("does not extract code-formatted Markdown labels separately from parsed links", () => {
  const source = "External [`external.md`](https://example.com/external.md). Local [`docs/guide.md`](docs/guide.md).\n";
  assert.deepEqual(extractReferenceOccurrences(source).map(({ kind, text, target, path }) => ({ kind, text, target, path })), [
    { kind: "link", text: "docs/guide.md", target: "docs/guide.md", path: "docs/guide.md" },
  ]);
});

test("resolves targets relative to source and strips fragments", () => {
  assert.equal(resolveOccurrenceTarget("/repo/skills/x/SKILL.md", { path: "../shared.md#part" }), "/repo/skills/shared.md");
});

test("frozen contracts, prompts, and consultation dependency validate", () => {
  assert.equal(validateReferenceContracts(), true);
  assert.deepEqual(REFERENCE_CONTRACTS.map(({ id }) => id), ["target_content_must_be_consulted", "loading_trigger_is_explicit", "target_is_expected_to_exist"]);
  assert(REFERENCE_CONTRACTS.every(({ model }) => model === "jev-1.13.0"));
  assert.deepEqual(REFERENCE_DEPENDENCIES, [{ source: "target_content_must_be_consulted", sourceClassification: "pass", consumes: "loading_trigger_is_explicit" }]);
  const occurrence = { heading: "When shipping", span: "Read [guide](docs/g.md).", text: "guide", target: "docs/g.md", path: "docs/g.md" };
  const structured = JSON.stringify({ heading: occurrence.heading, span: occurrence.span, link: { text: occurrence.text, target: occurrence.target }, path: occurrence.path });
  assert.equal(consultationQuestion(occurrence).instructions, `${REFERENCE_CONTRACTS[0].instructions}\n\nOccurrence: ${structured}`);
  assert.equal(triggerQuestion(occurrence).instructions, `${REFERENCE_CONTRACTS[1].instructions}\n\nOccurrence: ${structured}`);
  assert.equal(expectedExistingQuestion(occurrence).instructions, REFERENCE_CONTRACTS[2].instructions + '\n\nInstruction span: "Read [guide](docs/g.md)."\nTarget path: `docs/g.md`');
});

test("reference contract validation rejects changed dependency and malformed outcomes", () => {
  assert.throws(() => validateReferenceContracts(REFERENCE_CONTRACTS, [{ source: "target_content_must_be_consulted", sourceClassification: "finding", consumes: "loading_trigger_is_explicit" }]), /only on pass/);
  const contracts = structuredClone(REFERENCE_CONTRACTS); delete contracts[0].outcomes.unknown;
  assert.throws(() => validateReferenceContracts(contracts, REFERENCE_DEPENDENCIES), /outcomes must have exactly/);
});

test("missing Markdown links are fatal before network", async (t) => {
  const root = await fixture({ "AGENTS.md": "Read [missing](docs/missing.md).\n" }); t.after(() => rm(root, { recursive: true, force: true }));
  let called = false; const out = output();
  assert.equal(await runReferenceLint({ root, client: { systemOne: async () => { called = true; } }, stdout: out.write, stderr: out.write }), 1);
  assert.equal(called, false); assert.match(out.lines[0], /^ERROR AGENTS\.md:1 missing Markdown link target docs\/missing\.md/);
});

test("missing Markdown links in tables are fatal across all files before client construction", async (t) => {
  const root = await fixture({
    "AGENTS.md": "Read `existing.md`.\n",
    "existing.md": "ok\n",
    "skills/z/SKILL.md": "| Reference |\n| --- |\n| [missing](docs/missing.md) |\n",
  }); t.after(() => rm(root, { recursive: true, force: true }));
  let factories = 0; const out = output();
  assert.equal(await main({ root, createClient: async () => { factories++; return { systemOne: async () => assert.fail("paid request") }; }, stdout: out.write, stderr: out.write }), 1);
  assert.equal(factories, 0);
  assert.match(out.lines[0], /^ERROR skills\/z\/SKILL\.md:3 missing Markdown link target docs\/missing\.md/);
});

test("CLI boundary defers client construction for zero work and constructs it once before paid requests", async (t) => {
  const roots = [
    [await fixture({ "elsewhere/x.md": "ignored\n" }), "RECEIPT model=none files=0 occurrences=0 requests=0 input_tokens=0 output_tokens=0"],
    [await fixture({ "AGENTS.md": "No references.\n" }), "RECEIPT model=none files=1 occurrences=0 requests=0 input_tokens=0 output_tokens=0"],
  ];
  for (const [root, receipt] of roots) {
    t.after(() => rm(root, { recursive: true, force: true }));
    let factories = 0; const out = output();
    assert.equal(await main({ root, createClient: async () => { factories++; throw new Error("credentials required"); }, stdout: out.write, stderr: out.write }), 0);
    assert.equal(factories, 0);
    assert.equal(out.lines.at(-1), receipt);
  }

  const root = await fixture({ "AGENTS.md": "Read `one.md`.\n", "skills/x/SKILL.md": "Read `two.md`.\n" }); t.after(() => rm(root, { recursive: true, force: true }));
  let factories = 0; const requests = []; const out = output();
  assert.equal(await main({ root, createClient: async () => { factories++; return { systemOne: async (request) => (requests.push(request), response(request)) }; }, stdout: out.write, stderr: out.write }), 0);
  assert.equal(factories, 1);
  assert.equal(requests.length, 2);
});

test("code-formatted link labels produce zero external requests and one local-link request", async (t) => {
  const externalRoot = await fixture({ "AGENTS.md": "Read [`external.md`](https://example.com/external.md).\n" });
  t.after(() => rm(externalRoot, { recursive: true, force: true }));
  let externalCalls = 0; const externalOut = output();
  assert.equal(await runReferenceLint({ root: externalRoot, client: { systemOne: async () => { externalCalls++; } }, stdout: externalOut.write, stderr: externalOut.write }), 0);
  assert.equal(externalCalls, 0);
  assert.equal(externalOut.lines.at(-1), "RECEIPT model=none files=1 occurrences=0 requests=0 input_tokens=0 output_tokens=0");

  const localRoot = await fixture({ "AGENTS.md": "Read [`guide.md`](guide.md).\n", "guide.md": "ok\n" });
  t.after(() => rm(localRoot, { recursive: true, force: true }));
  const localRequests = []; const localOut = output();
  assert.equal(await runReferenceLint({ root: localRoot, client: { systemOne: async (request) => (localRequests.push(request), response(request)) }, stdout: localOut.write, stderr: localOut.write }), 0);
  assert.equal(localRequests.length, 1);
  assert.equal(Object.keys(localRequests[0].questions).length, 2);
  assert.match(localOut.lines.at(-1), /files=1 occurrences=1 requests=1 input_tokens=12 output_tokens=4/);
});

test("batches independent questions per file with empty state and never sends source paths or target content", async (t) => {
  const root = await fixture({
    "AGENTS.md": "# Work\nRead [guide](docs/guide.md) before work. Create `docs/new.md`.\n",
    "docs/guide.md": "PRIVATE TARGET CONTENT\n",
    "skills/x/info.md": "Consult `target.md` when releasing.\n",
    "skills/x/target.md": "MORE PRIVATE CONTENT\n",
  }); t.after(() => rm(root, { recursive: true, force: true }));
  const requests = []; const out = output();
  const code = await runReferenceLint({ root, client: { systemOne: async (request) => (requests.push(request), response(request)) }, stdout: out.write, stderr: out.write });
  assert.equal(code, 0); assert.equal(requests.length, 2);
  assert.deepEqual(requests.map((r) => Object.keys(r.questions).length), [3, 2]);
  assert(requests.every((r) => r.model === REFERENCE_MODEL && r.state === ""));
  assert.doesNotMatch(JSON.stringify(requests), /AGENTS\.md|skills\/x|PRIVATE TARGET|MORE PRIVATE/);
  assert.match(out.lines.at(-1), /files=3 occurrences=3 requests=2 input_tokens=24 output_tokens=8/);
});

test("missing backtick composition and existing consultation gating are advisory", async (t) => {
  const root = await fixture({ "AGENTS.md": "Read `missing.md`.\nRead [guide](guide.md).\n", "guide.md": "ok\n" }); t.after(() => rm(root, { recursive: true, force: true }));
  const scenarios = [
    [{ r0001_expected: 0.9, r0002_consultation: 0.2, r0002_trigger: 0.1 }, /FINDING .*target_is_expected_to_exist/, /loading_trigger/],
    [{ r0001_expected: 0.1, r0002_consultation: 0.5, r0002_trigger: 0.1 }, /UNKNOWN .*target_content_must_be_consulted/, /loading_trigger/],
    [{ r0001_expected: 0.5, r0002_consultation: 0.9, r0002_trigger: 0.2 }, /UNKNOWN .*target_is_expected_to_exist[\s\S]*FINDING .*loading_trigger_is_explicit/, /$^/],
  ];
  for (const [values, wanted, forbidden] of scenarios) {
    const out = output(); const code = await runReferenceLint({ root, client: { systemOne: async (request) => response(request, values) }, stdout: out.write, stderr: out.write });
    assert.equal(code, 0); assert.match(out.lines.join("\n"), wanted);
    if (forbidden.source !== "$^") {
      const diagnosticLines = out.lines.filter((line) => !line.startsWith("RECEIPT"));
      if (values.r0002_consultation !== 0.9) assert(!diagnosticLines.some((line) => forbidden.test(line)));
    }
  }
});

test("provider, exact model, integer token, answer shape, and probability failures are fatal", async (t) => {
  const root = await fixture({ "AGENTS.md": "Read `missing.md`.\n" }); t.after(() => rm(root, { recursive: true, force: true }));
  const failures = [
    [async () => { throw new Error("provider down"); }, /provider down/],
    [async (request) => response(request, {}, { model: "jev-1.13.1" }), /model identity/],
    [async (request) => response(request, {}, { usage: { input_tokens: 1.5, output_tokens: 2 } }), /invalid counts/],
    [async (request) => response(request, {}, { answers: {} }), /answers do not exactly match/],
    [async (request) => response(request, {}, { answers: { r0001_expected: { type: "noul", noul: 0.9, extra: true } } }), /invalid Noul answer/],
    [async (request) => response(request, { r0001_expected: 2 }), /invalid Noul probability/],
  ];
  for (const [systemOne, pattern] of failures) { const out = output(); assert.equal(await runReferenceLint({ root, client: { systemOne }, stdout: out.write, stderr: out.write }), 1); assert(out.lines.some((line) => pattern.test(line))); }
});
