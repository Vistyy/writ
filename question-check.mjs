import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CALIBRATION_CASES,
  QUESTION_CONTRACTS,
  QUESTION_DEPENDENCIES,
  runtimeQuestions,
  validateQuestionContracts,
} from "./question-contracts.mjs";
import { MODEL, QUESTIONS, classify } from "./semantic-lint.mjs";
import {
  REFERENCE_CALIBRATION_CASES,
  REFERENCE_CONTRACTS,
  REFERENCE_DEPENDENCIES,
  consultationQuestion,
  expectedExistingQuestion,
  triggerQuestion,
  validateReferenceContracts,
} from "./reference-contracts.mjs";

export const CONTRACT_META_QUESTIONS = Object.freeze({
  model_judgment_is_needed: {
    type: "noul",
    instructions: "Read the subject contract in `state.subject`. Would answering the subject question correctly require semantic interpretation of natural language (meaning, intent, aboutness, specificity, similarity), rather than an exact deterministic computation such as string matching, arithmetic, or schema validation that should stay in code?",
    criteria: {
      true: "Correct answers depend on interpreting the meaning of natural-language text; no exact deterministic computation decides the same predicate.",
      false: "An exact deterministic computation (string match, arithmetic, schema or shape check) decides the predicate; asking a model adds no needed judgment.",
    },
  },
  judgment_has_one_semantic_axis: {
    type: "noul",
    instructions: "Read the subject contract in `state.subject`. Does the subject question ask exactly one independently-answerable judgment, where any realistic input receives its answer from a single semantic axis?",
    criteria: {
      true: "Every realistic input is judged on one axis; there are no two independently variable subanswers collapsed into one answer.",
      false: "Two or more independently variable subanswers (for example purpose versus trigger, or clarity versus completeness) are collapsed into one answer, so one input can be high on one subanswer and low on another with no coherent single answer.",
    },
  },
});

export const DISTINCTNESS_QUESTION = Object.freeze({
  questions_are_materially_distinct: {
    type: "noul",
    instructions: "Read the two question contracts in `state.question_a` and `state.question_b`. Are they materially distinct: can realistic inputs receive different answers from the two questions, with the difference implying different fixes?",
    criteria: {
      true: "Realistic inputs can split the two answers, and the split implies different fixes; keeping both questions is justified.",
      false: "The two questions always agree on realistic inputs, or any disagreement implies the same fix; they should be merged.",
    },
  },
});

export const DEPENDENCY_QUESTION = Object.freeze({
  dependency_is_semantically_valid: {
    type: "noul",
    instructions: "Read the declared dependency in `state`: `upstream` question, `downstream` question, and `relation`. Is the dependency semantically valid: does the downstream question refine the upstream question so that suppressing or conditioning the downstream on a negative upstream is sound?",
    criteria: {
      true: "Downstream refines upstream (specificity, scope, or detail of the same construct); the declared relation is sound.",
      false: "Downstream does not refine upstream, or the relation is unsound (for example conditioning on an unrelated question).",
    },
  },
});

function publicContract(contract) {
  const { id, primitive, model, intendedAnswer, instructions, criteria, state, outcomes } = contract;
  return { id, primitive, ...(model ? { model } : {}), intendedAnswer, instructions, criteria, state, outcomes };
}

function pairs(items) {
  const result = [];
  for (let left = 0; left < items.length; left++) {
    for (let right = left + 1; right < items.length; right++) result.push([items[left], items[right]]);
  }
  return result;
}

function validateResponse(response, questionIds) {
  if (response?.model !== MODEL) throw new Error(`response model identity must be exactly ${MODEL}; received ${String(response?.model)}`);
  if (!Number.isInteger(response.usage?.input_tokens) || response.usage.input_tokens < 0 || !Number.isInteger(response.usage?.output_tokens) || response.usage.output_tokens < 0) throw new Error("response omitted token usage or returned invalid counts");
  if (!response.answers || typeof response.answers !== "object" || Array.isArray(response.answers) || JSON.stringify(Object.keys(response.answers).sort()) !== JSON.stringify([...questionIds].sort())) throw new Error("response answers do not exactly match requested questions");
  const results = {};
  for (const id of questionIds) {
    const answer = response.answers?.[id];
    if (answer?.type !== "noul" || JSON.stringify(Object.keys(answer).sort()) !== JSON.stringify(["noul", "type"])) throw new Error(`missing or invalid Noul answer for ${id}`);
    results[id] = { probability: answer.noul, classification: classify(answer.noul) };
  }
  return results;
}

export async function runQuestionCheck({ client, stdout = console.log, stderr = console.error, contracts = QUESTION_CONTRACTS, dependencies = QUESTION_DEPENDENCIES, calibrationCases = CALIBRATION_CASES, referenceContracts = REFERENCE_CONTRACTS, referenceDependencies = REFERENCE_DEPENDENCIES, referenceCalibrationCases = REFERENCE_CALIBRATION_CASES }) {
  let inputTokens = 0;
  let outputTokens = 0;
  let requests = 0;
  let calibrationMismatches = 0;
  let advisoryMeta = 0;

  async function evaluate(label, state, questions) {
    const response = await client.systemOne({ model: MODEL, state, questions });
    const results = validateResponse(response, Object.keys(questions));
    requests++;
    inputTokens += response.usage.input_tokens;
    outputTokens += response.usage.output_tokens;
    for (const [id, result] of Object.entries(results)) stdout(`RESULT ${label} ${id} p=${result.probability} classification=${result.classification}`);
    return results;
  }

  try {
    validateQuestionContracts(contracts, dependencies);
    validateReferenceContracts(referenceContracts, referenceDependencies);
    const questions = contracts === QUESTION_CONTRACTS ? QUESTIONS : runtimeQuestions(contracts);
    stdout(`VALID contracts=${contracts.length} dependencies=${dependencies.length} reference_contracts=${referenceContracts.length} reference_dependencies=${referenceDependencies.length}`);

    for (const calibration of calibrationCases) {
      const results = await evaluate(`calibration:${calibration.id}`, calibration.state, questions);
      for (const [expectedClassification, ids] of Object.entries(calibration.expected)) {
        if (expectedClassification !== "pass" && expectedClassification !== "finding") throw new Error(`${calibration.id}: unsupported expected classification ${expectedClassification}`);
        for (const id of ids) {
          if (!results[id]) throw new Error(`${calibration.id}: expected unknown question ${id}`);
          if (results[id].classification !== expectedClassification) {
            calibrationMismatches++;
            stderr(`MISMATCH calibration:${calibration.id} ${id} expected=${expectedClassification} actual=${results[id].classification} p=${results[id].probability}`);
          }
        }
      }
    }

    for (const calibration of referenceCalibrationCases) {
      const occurrence = { heading: calibration.heading ?? "", span: calibration.span, text: calibration.text ?? calibration.path, target: calibration.path, path: calibration.path };
      const referenceQuestions = calibration.kind === "missing"
        ? { target_is_expected_to_exist: expectedExistingQuestion(occurrence) }
        : { target_content_must_be_consulted: consultationQuestion(occurrence), loading_trigger_is_explicit: triggerQuestion(occurrence) };
      const results = await evaluate(`reference-calibration:${calibration.id}`, "", referenceQuestions);
      for (const [id, expectedClassification] of Object.entries(calibration.expected)) {
        if (results[id]?.classification !== expectedClassification) {
          calibrationMismatches++;
          stderr(`MISMATCH reference-calibration:${calibration.id} ${id} expected=${expectedClassification} actual=${results[id]?.classification ?? "missing"} p=${results[id]?.probability ?? "missing"}`);
        }
      }
    }

    for (const contract of contracts) {
      const results = await evaluate(`contract:${contract.id}`, { subject: publicContract(contract) }, CONTRACT_META_QUESTIONS);
      advisoryMeta += Object.values(results).filter(({ classification }) => classification !== "pass").length;
    }
    for (const [left, right] of pairs(contracts)) {
      const results = await evaluate(`pair:${left.id}:${right.id}`, {
        question_a: publicContract(left),
        question_b: publicContract(right),
      }, DISTINCTNESS_QUESTION);
      advisoryMeta += Object.values(results).filter(({ classification }) => classification !== "pass").length;
    }
    for (const dependency of dependencies) {
      const source = contracts.find(({ id }) => id === dependency.source);
      const suppressed = contracts.find(({ id }) => id === dependency.suppresses);
      const results = await evaluate(`dependency:${dependency.source}:${dependency.suppresses}`, {
        upstream: publicContract(source),
        downstream: publicContract(suppressed),
        relation: dependency,
      }, DEPENDENCY_QUESTION);
      advisoryMeta += Object.values(results).filter(({ classification }) => classification !== "pass").length;
    }
    for (const contract of referenceContracts) {
      const results = await evaluate(`reference-contract:${contract.id}`, { subject: publicContract(contract) }, CONTRACT_META_QUESTIONS);
      advisoryMeta += Object.values(results).filter(({ classification }) => classification !== "pass").length;
    }
    for (const [left, right] of pairs(referenceContracts)) {
      const results = await evaluate(`reference-pair:${left.id}:${right.id}`, { question_a: publicContract(left), question_b: publicContract(right) }, DISTINCTNESS_QUESTION);
      advisoryMeta += Object.values(results).filter(({ classification }) => classification !== "pass").length;
    }
    for (const dependency of referenceDependencies) {
      const source = referenceContracts.find(({ id }) => id === dependency.source);
      const consumed = referenceContracts.find(({ id }) => id === dependency.consumes);
      const results = await evaluate(`reference-dependency:${dependency.source}:${dependency.consumes}`, { upstream: publicContract(source), downstream: publicContract(consumed), relation: dependency }, DEPENDENCY_QUESTION);
      advisoryMeta += Object.values(results).filter(({ classification }) => classification !== "pass").length;
    }

    stdout(`RECEIPT model=${MODEL} input_tokens=${inputTokens} output_tokens=${outputTokens} requests=${requests} calibrations=${calibrationCases.length} reference_calibrations=${referenceCalibrationCases.length} contract_meta=${contracts.length * 2} pairs=${pairs(contracts).length} dependencies=${dependencies.length} reference_contract_meta=${referenceContracts.length * 2} reference_pairs=${pairs(referenceContracts).length} reference_dependencies=${referenceDependencies.length} advisory_meta=${advisoryMeta} calibration_mismatches=${calibrationMismatches}`);
    return calibrationMismatches === 0 ? 0 : 1;
  } catch (error) {
    stderr(`ERROR ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}

async function main() {
  let client;
  try {
    const { TypeSafeClient } = await import("@typesafe-ai/sdk");
    client = new TypeSafeClient({ defaultModel: MODEL });
  } catch (error) {
    console.error(`ERROR ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
    return;
  }
  process.exitCode = await runQuestionCheck({ client });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
