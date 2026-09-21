import assert from "node:assert/strict";
import test from "node:test";
import {
  QUESTION_CONTRACTS,
  QUESTION_DEPENDENCIES,
  runtimeQuestions,
  suppressedQuestionIds,
  validateQuestionContracts,
} from "./question-contracts.mjs";
import { QUESTIONS } from "./semantic-lint.mjs";

const clone = (value) => structuredClone(value);

test("runtime questions remain exactly derived from the five settled contracts", () => {
  assert.equal(validateQuestionContracts(), true);
  assert.deepEqual(runtimeQuestions(), QUESTIONS);
  assert.deepEqual(Object.keys(QUESTIONS), [
    "capability_is_stated",
    "capability_is_specific",
    "activation_is_stated",
    "activation_is_specific",
    "routing_metadata_is_focused",
  ]);
});

test("declared dependencies derive suppression", () => {
  assert.deepEqual([...suppressedQuestionIds({
    capability_is_stated: { classification: "finding" },
    activation_is_stated: { classification: "pass" },
  })], ["capability_is_specific"]);
  assert.deepEqual([...suppressedQuestionIds({
    capability_is_stated: { classification: "pass" },
    activation_is_stated: { classification: "finding" },
  })], ["activation_is_specific"]);
});

test("contract validation rejects malformed deterministic structure", async (t) => {
  const cases = [
    ["snake_case", (contracts) => { contracts[0].id = "Not-Snake"; }, /invalid snake_case/],
    ["duplicate ids", (contracts) => { contracts[1].id = contracts[0].id; }, /duplicate question id/],
    ["unsupported primitive", (contracts) => { contracts[0].primitive = "choice"; }, /unsupported primitive/],
    ["empty contract field", (contracts) => { contracts[0].instructions = ""; }, /instructions must be nonempty/],
    ["state fields", (contracts) => { contracts[0].state.supplied = []; }, /state\.supplied/],
    ["exact outcomes", (contracts) => { contracts[0].outcomes.extra = {}; }, /outcomes must have exactly/],
  ];
  for (const [name, mutate, pattern] of cases) {
    await t.test(name, () => {
      const contracts = clone(QUESTION_CONTRACTS);
      mutate(contracts);
      assert.throws(() => validateQuestionContracts(contracts, clone(QUESTION_DEPENDENCIES)), pattern);
    });
  }
});

test("dependency validation rejects bad references, duplicates, self edges, and cycles", async (t) => {
  const cases = [
    ["reference", [{ source: "missing", sourceClassification: "finding", suppresses: "capability_is_specific" }], /invalid dependency reference/],
    ["duplicate", [QUESTION_DEPENDENCIES[0], QUESTION_DEPENDENCIES[0]], /duplicate dependency/],
    ["self", [{ source: "capability_is_stated", sourceClassification: "finding", suppresses: "capability_is_stated" }], /self dependency/],
    ["cycle", [
      { source: "capability_is_stated", sourceClassification: "finding", suppresses: "capability_is_specific" },
      { source: "capability_is_specific", sourceClassification: "finding", suppresses: "capability_is_stated" },
    ], /acyclic/],
  ];
  for (const [name, dependencies, pattern] of cases) {
    await t.test(name, () => assert.throws(() => validateQuestionContracts(clone(QUESTION_CONTRACTS), clone(dependencies)), pattern));
  }
});
