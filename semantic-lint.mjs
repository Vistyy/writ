import { readdir, readFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

export const MODEL = "jev-1.13.0";
export const QUESTIONS = Object.freeze({
  capability_stated: {
    type: "noul",
    instructions: "Does `skill.description` state what capability the skill provides?",
    criteria: {
      true: "It states a task the skill performs or an outcome it helps produce.",
      false: "It does not state a capability; a name, topic, value, or vague identity alone is not a capability.",
    },
  },
  capability_specific: {
    type: "noul",
    instructions: "Is the capability stated in `skill.description` specific enough to distinguish this skill from generic assistant help?",
    criteria: {
      true: "It names concrete tasks, outcomes, or a bounded domain that distinguishes the capability.",
      false: "The capability is absent, generic, or broad, such as helping, coding, researching, or writing without a distinguishing task or outcome.",
    },
  },
  activation_stated: {
    type: "noul",
    instructions: "Does `skill.description` state when the agent should use the skill?",
    criteria: {
      true: "It states user intents, situations, conditions, or triggers for activating the skill.",
      false: "It only describes what the skill does, or otherwise gives no activation condition.",
    },
  },
  activation_specific: {
    type: "noul",
    instructions: "Is the activation guidance in `skill.description` specific enough for an agent to decide whether to use the skill?",
    criteria: {
      true: "It gives actionable matching conditions, boundaries, or exclusions that distinguish when to use the skill.",
      false: "The activation guidance is absent, generic, or broad enough to apply to routine work indiscriminately.",
    },
  },
});

const ASPECTS = [
  ["capability_stated", "Add a sentence stating the capability this skill provides."],
  ["capability_specific", "Name concrete tasks, outcomes, or a bounded domain for this capability."],
  ["activation_stated", "Add a clear condition such as “Use when …”."],
  ["activation_specific", "Give actionable activation triggers or boundaries, including when not to use it where useful."],
];

const ignoredDirectories = new Set([".git", "node_modules"]);

export async function discoverSkills(root) {
  const found = [];
  async function visit(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory() && !ignoredDirectories.has(entry.name)) {
        await visit(resolve(directory, entry.name));
      } else if (entry.isFile() && entry.name === "SKILL.md") {
        found.push(resolve(directory, entry.name));
      }
    }
  }
  await visit(root);
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
  if (results.capability_stated.classification === "finding") suppressed.add("capability_specific");
  if (results.activation_stated.classification === "finding") suppressed.add("activation_specific");
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
      if (typeof response?.model !== "string" || !response.model) throw new Error("response omitted model identity");
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
