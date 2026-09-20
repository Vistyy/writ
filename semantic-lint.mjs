import { readdir, readFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

export const MODEL = "jev-1.13.0";
export const QUESTIONS = Object.freeze({
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
});

const ASPECTS = [
  ["capability_is_stated", "State the action, judgment, knowledge, or outcome this skill provides."],
  ["capability_is_specific", "Name a bounded action, judgment, knowledge, or outcome for this capability."],
  ["activation_is_stated", "Name a concrete task, input, artifact, event, or condition where this skill is relevant."],
  ["activation_is_specific", "Identify a recognizable user intent, task, input, artifact, event, or condition that triggers this skill."],
];

export async function discoverSkills(root) {
  const found = [];
  async function visit(directory) {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (error?.code === "ENOENT") return;
      throw error;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        await visit(resolve(directory, entry.name));
      } else if (entry.isFile() && entry.name === "SKILL.md") {
        found.push(resolve(directory, entry.name));
      }
    }
  }
  await Promise.all([visit(resolve(root, "skills")), visit(resolve(root, "user-skills"))]);
  return found.sort();
}

export function readSkillMetadata(source, path = "SKILL.md") {
  if (!source.startsWith("---\n") && !source.startsWith("---\r\n")) {
    throw new Error(`${path}: missing YAML frontmatter`);
  }
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) throw new Error(`${path}: unterminated YAML frontmatter`);

  let metadata;
  try {
    metadata = parse(match[1]);
  } catch (error) {
    throw new Error(`${path}: invalid YAML frontmatter: ${error.message}`, { cause: error });
  }
  if (metadata === null || typeof metadata !== "object" || Array.isArray(metadata)) {
    throw new Error(`${path}: frontmatter must be a YAML mapping`);
  }
  if (metadata["disable-model-invocation"] === true) return { skipped: true };
  if (typeof metadata.name !== "string" || metadata.name.trim() === "") {
    throw new Error(`${path}: applicable skill requires a non-empty string name`);
  }
  if (typeof metadata.description !== "string" || metadata.description.trim() === "") {
    throw new Error(`${path}: applicable skill requires a non-empty string description`);
  }
  return {
    skipped: false,
    skill: { name: metadata.name, description: metadata.description },
  };
}

export function classify(probability) {
  if (typeof probability !== "number" || !Number.isFinite(probability) || probability < 0 || probability > 1) {
    throw new Error(`invalid Noul probability: ${String(probability)}`);
  }
  if (probability <= 1 / 3) return "finding";
  if (probability >= 2 / 3) return "pass";
  return "unknown";
}

function diagnostics(answers) {
  const results = Object.fromEntries(ASPECTS.map(([id]) => {
    const answer = answers?.[id];
    if (answer?.type !== "noul") throw new Error(`missing or invalid Noul answer for ${id}`);
    return [id, { probability: answer.noul, classification: classify(answer.noul) }];
  }));

  const suppressed = new Set();
  if (results.capability_is_stated.classification === "finding") suppressed.add("capability_is_specific");
  if (results.activation_is_stated.classification === "finding") suppressed.add("activation_is_specific");
  const issues = ASPECTS.flatMap(([id, action]) => {
    const result = results[id];
    return result.classification === "pass" || suppressed.has(id)
      ? []
      : [{ id, action, ...result }];
  });
  return { issues, results };
}

export async function runSemanticLint({ root, client, stdout = console.log, stderr = console.error }) {
  let evaluated = 0;
  let skipped = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  const models = new Set();

  try {
    for (const path of await discoverSkills(root)) {
      const displayPath = relative(root, path);
      const metadata = readSkillMetadata(await readFile(path, "utf8"), displayPath);
      if (metadata.skipped) {
        skipped++;
        stdout(`SKIP ${displayPath}: disable-model-invocation is true`);
        continue;
      }

      const response = await client.systemOne({
        model: MODEL,
        state: { skill: metadata.skill },
        questions: QUESTIONS,
      });
      if (response?.model !== MODEL) {
        throw new Error(`response model identity must be exactly ${MODEL}; received ${String(response?.model)}`);
      }
      if (!Number.isFinite(response.usage?.input_tokens) || !Number.isFinite(response.usage?.output_tokens)) {
        throw new Error("response omitted token usage");
      }
      evaluated++;
      models.add(response.model);
      inputTokens += response.usage.input_tokens;
      outputTokens += response.usage.output_tokens;

      const { issues, results } = diagnostics(response.answers);
      if (issues.length === 0) {
        const probabilities = ASPECTS.map(([id]) => `${id} p=${results[id].probability}`).join(", ");
        stdout(`PASS ${displayPath} (${metadata.skill.name}) ${probabilities}`);
      }
      for (const issue of issues) {
        stdout(`${issue.classification.toUpperCase()} ${displayPath} (${metadata.skill.name}) ${issue.id} p=${issue.probability}: ${issue.action} [advisory]`);
      }
    }
    stdout(`RECEIPT model=${[...models].sort().join(",") || "none"} input_tokens=${inputTokens} output_tokens=${outputTokens} evaluated=${evaluated} skipped=${skipped}`);
    return 0;
  } catch (error) {
    stderr(`ERROR ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}

async function main() {
  const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  let client;
  try {
    const { TypeSafeClient } = await import("@typesafe-ai/sdk");
    client = new TypeSafeClient({ defaultModel: MODEL });
  } catch (error) {
    console.error(`ERROR ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
    return;
  }
  process.exitCode = await runSemanticLint({ root: repositoryRoot, client });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
