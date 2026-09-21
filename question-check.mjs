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

export const CONTRACT_META_QUESTIONS = Object.freeze({
  model_judgment_is_needed: {
    type: "noul",
    instructions: "Does deciding this question require semantic model judgment rather than a deterministic structural check?",
    criteria: {
      true: "The answer depends on interpreting the meaning of natural-language state against the question criteria.",
      false: "The answer can be established exactly from syntax, types, equality, membership, or another deterministic rule.",
    },
  },
  judgment_has_one_semantic_axis: {
    type: "noul",
    instructions: "Does this question ask for one coherent semantic judgment axis?",
    criteria: {
      true: "Its instructions and criteria distinguish one concept whose positive and negative poles are coherent.",
      false: "It combines independently variable concepts such that one answer could conceal disagreement between them.",
    },
  },
});

export const DISTINCTNESS_QUESTION = Object.freeze({
  questions_are_materially_distinct: {
    type: "noul",
    instructions: "Do these two questions evaluate materially distinct semantic judgments?",
    criteria: {
      true: "A plausible state can satisfy one question and not the other because their decision boundaries differ.",
      false: "They are paraphrases or have effectively the same decision boundary.",
    },
  },
});

export const DEPENDENCY_QUESTION = Object.freeze({
  dependency_is_semantically_valid: {
    type: "noul",
    instructions: "Is this suppression dependency semantically valid for the two question contracts?",
    criteria: {
      true: "When the source receives the stated classification, reporting the suppressed question would be redundant, misleading, or less fundamental.",
      false: "The suppressed question remains independently useful or the source classification does not justify suppressing it.",
    },
  },
});

function publicContract(contract) {
  const { id, intendedAnswer, instructions, criteria, state, outcomes } = contract;
  return { id, primitive: "noul", intendedAnswer, instructions, criteria, state, outcomes };
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
  const results = {};
  for (const id of questionIds) {
    const answer = response.answers?.[id];
    if (answer?.type !== "noul") throw new Error(`missing or invalid Noul answer for ${id}`);
    results[id] = { probability: answer.noul, classification: classify(answer.noul) };
  }
  return results;
}

export async function runQuestionCheck({ client, stdout = console.log, stderr = console.error, contracts = QUESTION_CONTRACTS, dependencies = QUESTION_DEPENDENCIES, calibrationCases = CALIBRATION_CASES }) {
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
    const questions = contracts === QUESTION_CONTRACTS ? QUESTIONS : runtimeQuestions(contracts);
    stdout(`VALID contracts=${contracts.length} dependencies=${dependencies.length}`);

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

    for (const contract of contracts) {
      const results = await evaluate(`contract:${contract.id}`, { questionContract: publicContract(contract) }, CONTRACT_META_QUESTIONS);
      advisoryMeta += Object.values(results).filter(({ classification }) => classification !== "pass").length;
    }
    for (const [left, right] of pairs(contracts)) {
      const results = await evaluate(`pair:${left.id}:${right.id}`, { questionContracts: [publicContract(left), publicContract(right)] }, DISTINCTNESS_QUESTION);
      advisoryMeta += Object.values(results).filter(({ classification }) => classification !== "pass").length;
    }
    for (const dependency of dependencies) {
      const source = contracts.find(({ id }) => id === dependency.source);
      const suppressed = contracts.find(({ id }) => id === dependency.suppresses);
      const results = await evaluate(`dependency:${dependency.source}:${dependency.suppresses}`, {
        dependency,
        questionContracts: [publicContract(source), publicContract(suppressed)],
      }, DEPENDENCY_QUESTION);
      advisoryMeta += Object.values(results).filter(({ classification }) => classification !== "pass").length;
    }

    stdout(`RECEIPT model=${MODEL} input_tokens=${inputTokens} output_tokens=${outputTokens} requests=${requests} calibrations=${calibrationCases.length} contract_meta=${contracts.length * 2} pairs=${pairs(contracts).length} dependencies=${dependencies.length} advisory_meta=${advisoryMeta} calibration_mismatches=${calibrationMismatches}`);
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
