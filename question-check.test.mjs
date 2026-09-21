import assert from "node:assert/strict";
import test from "node:test";
import { CALIBRATION_CASES, QUESTION_CONTRACTS, QUESTION_DEPENDENCIES } from "./question-contracts.mjs";
import { MODEL, QUESTIONS } from "./semantic-lint.mjs";
import { runQuestionCheck } from "./question-check.mjs";

const answer = (noul) => ({ type: "noul", noul });
const output = () => {
  const lines = [];
  return { lines, write: (line) => lines.push(line) };
};

function successfulResponse(request, override = {}) {
  const probabilities = Object.fromEntries(Object.keys(request.questions).map((id) => [id, 0.9]));
  const description = request.state?.skill?.description ?? "";
  if (description.startsWith("Use when a pull request")) probabilities.capability_is_stated = 0.1;
  if (description.startsWith("Provides helpful guidance")) probabilities.capability_is_specific = 0.1;
  if (description === "Compares two JSON schemas and reports incompatible field changes.") probabilities.activation_is_stated = 0.1;
  if (description.endsWith("Use for software work.")) probabilities.activation_is_specific = 0.1;
  if (description.includes("First read every schema file")) probabilities.routing_metadata_is_focused = 0.1;
  return {
    model: MODEL,
    answers: Object.fromEntries(Object.keys(request.questions).map((id) => [id, answer(probabilities[id])])),
    usage: { input_tokens: 11, output_tokens: 3 },
    ...override,
  };
}

test("question check sends bounded states, keeps paired meta judgments together, and prints a receipt", async () => {
  const requests = [];
  const out = output();
  const code = await runQuestionCheck({
    client: { systemOne: async (request) => (requests.push(request), successfulResponse(request)) },
    stdout: out.write,
    stderr: out.write,
  });
  assert.equal(code, 0);
  assert.equal(requests.length, 23);
  for (const request of requests.slice(0, CALIBRATION_CASES.length)) {
    assert.deepEqual(request.questions, QUESTIONS);
    assert.deepEqual(Object.keys(request.state), ["skill"]);
    assert.deepEqual(Object.keys(request.state.skill), ["name", "description"]);
  }
  for (const request of requests.slice(CALIBRATION_CASES.length, CALIBRATION_CASES.length + QUESTION_CONTRACTS.length)) {
    assert.deepEqual(Object.keys(request.questions), ["model_judgment_is_needed", "judgment_has_one_semantic_axis"]);
    assert.deepEqual(Object.keys(request.state), ["questionContract"]);
  }
  assert(requests.every((request) => request.model === MODEL));
  assert.doesNotMatch(JSON.stringify(requests), /skill body contents|repository path|PRIVATE|SECRET/);
  assert.match(out.lines.at(-1), /RECEIPT model=jev-1\.13\.0 .*requests=23 calibrations=6 contract_meta=10 pairs=10 dependencies=2 advisory_meta=0 calibration_mismatches=0/);
});

test("meta findings and unknowns are advisory and raw", async () => {
  const out = output();
  const code = await runQuestionCheck({
    calibrationCases: [],
    client: { systemOne: async (request) => {
      const response = successfulResponse(request);
      for (const id of Object.keys(response.answers)) response.answers[id] = answer(id === "model_judgment_is_needed" ? 0.2 : 0.5);
      return response;
    } },
    stdout: out.write,
    stderr: out.write,
  });
  assert.equal(code, 0);
  assert(out.lines.some((line) => /model_judgment_is_needed p=0\.2 classification=finding/));
  assert(out.lines.some((line) => /questions_are_materially_distinct p=0\.5 classification=unknown/));
  assert.match(out.lines.at(-1), /advisory_meta=22 calibration_mismatches=0/);
});

test("a calibration mismatch, including unknown, fails", async () => {
  const out = output();
  const code = await runQuestionCheck({
    contracts: QUESTION_CONTRACTS,
    dependencies: QUESTION_DEPENDENCIES,
    calibrationCases: [CALIBRATION_CASES[0]],
    client: { systemOne: async (request) => {
      const response = successfulResponse(request);
      if (request.state.skill) response.answers.capability_is_stated = answer(0.5);
      return response;
    } },
    stdout: out.write,
    stderr: out.write,
  });
  assert.equal(code, 1);
  assert(out.lines.some((line) => /MISMATCH .*expected=pass actual=unknown p=0\.5/));
  assert.match(out.lines.at(-1), /calibration_mismatches=1/);
});

test("deterministic validation happens before requests", async () => {
  const contracts = structuredClone(QUESTION_CONTRACTS);
  contracts[0].id = "bad-id";
  let called = false;
  const out = output();
  const code = await runQuestionCheck({
    contracts,
    calibrationCases: [],
    client: { systemOne: async () => { called = true; } },
    stdout: out.write,
    stderr: out.write,
  });
  assert.equal(code, 1);
  assert.equal(called, false);
  assert.match(out.lines[0], /^ERROR invalid snake_case/);
});

test("provider, model, token, and answer errors are fatal", async (t) => {
  const failures = [
    ["provider", async () => { throw new Error("provider unavailable"); }, /ERROR provider unavailable/],
    ["model", async (request) => successfulResponse(request, { model: "jev-1.13.1" }), /model identity must be exactly/],
    ["tokens", async (request) => successfulResponse(request, { usage: {} }), /omitted token usage/],
    ["answer", async (request) => successfulResponse(request, { answers: {} }), /missing or invalid Noul answer/],
  ];
  for (const [name, systemOne, pattern] of failures) {
    await t.test(name, async () => {
      const out = output();
      const code = await runQuestionCheck({ client: { systemOne }, calibrationCases: [], stdout: out.write, stderr: out.write });
      assert.equal(code, 1);
      assert(out.lines.some((line) => pattern.test(line)));
    });
  }
});
