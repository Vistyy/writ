import { readdir, readFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { parse } from "yaml";
import { QUESTION_CONTRACTS, runtimeQuestions, suppressedQuestionIds } from "./question-contracts.mjs";

export const MODEL = "jev-1.13.0";
export const QUESTIONS = runtimeQuestions();

const ASPECTS = QUESTION_CONTRACTS.map(({ id, outcomes }) => [id, outcomes]);

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

  const suppressed = suppressedQuestionIds(results);
  const issues = ASPECTS.flatMap(([id, outcomes]) => {
    const result = results[id];
    return result.classification === "pass" || suppressed.has(id)
      ? []
      : [{ id, action: outcomes[result.classification].diagnostic, ...result }];
  });
  return { issues, results };
}

export async function runSemanticLint({ root, client, clientFactory, stdout = console.log, stderr = console.error }) {
  let clientPromise;
  const getClient = async () => {
    if (client) return client;
    clientPromise ??= Promise.resolve().then(() => clientFactory());
    return clientPromise;
  };
  let evaluated = 0;
  let skipped = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  const models = new Set();

  try {
    const skills = [];
    for (const path of await discoverSkills(root)) {
      const displayPath = relative(root, path);
      const metadata = readSkillMetadata(await readFile(path, "utf8"), displayPath);
      skills.push({ displayPath, metadata });
    }

    for (const { displayPath, metadata } of skills) {
      if (metadata.skipped) {
        skipped++;
        stdout(`SKIP ${displayPath}: disable-model-invocation is true`);
        continue;
      }

      const response = await (await getClient()).systemOne({
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

export async function main({
  root = process.cwd(),
  createClient = async () => {
    const { TypeSafeClient } = await import("@typesafe-ai/sdk");
    return new TypeSafeClient({ defaultModel: MODEL });
  },
  stdout = console.log,
  stderr = console.error,
} = {}) {
  return runSemanticLint({ root, clientFactory: createClient, stdout, stderr });
}
