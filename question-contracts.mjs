const OUTCOME_KEYS = ["pass", "finding", "unknown"];

export const QUESTION_CONTRACTS = Object.freeze([
  {
    id: "capability_is_stated",
    primitive: "noul",
    intendedAnswer: true,
    instructions: "Do `skill.name` and `skill.description` state what capability this skill provides?",
    criteria: {
      true: "They state an action the skill performs, a judgment it makes, knowledge it supplies, or an outcome it produces.",
      false: "They state only a topic, persona, aspiration, or invocation condition without saying what the skill contributes.",
    },
    state: { supplied: ["skill.name", "skill.description"], withheld: ["skill body", "skill path", "other frontmatter", "repository context"] },
    outcomes: {
      pass: { downstream: "Do not report a capability-presence issue.", diagnostic: "No capability-presence change is needed." },
      finding: { downstream: "Report this issue and suppress capability_is_specific.", diagnostic: "State the action, judgment, knowledge, or outcome this skill provides." },
      unknown: { downstream: "Report this advisory issue without suppressing capability_is_specific.", diagnostic: "State the action, judgment, knowledge, or outcome this skill provides." },
    },
  },
  {
    id: "capability_is_specific",
    primitive: "noul",
    intendedAnswer: true,
    instructions: "Do `skill.name` and `skill.description` identify a capability specific enough to distinguish this skill from a generic assistant?",
    criteria: {
      true: "They identify a bounded action, judgment, knowledge, or outcome.",
      false: "They provide only generic help, guidance, expertise, quality improvement, a topic, persona, aspiration, or invocation condition.",
    },
    state: { supplied: ["skill.name", "skill.description"], withheld: ["skill body", "skill path", "other frontmatter", "repository context"] },
    outcomes: {
      pass: { downstream: "Do not report a capability-specificity issue.", diagnostic: "No capability-specificity change is needed." },
      finding: { downstream: "Report this issue unless capability_is_stated is a finding.", diagnostic: "Name a bounded action, judgment, knowledge, or outcome for this capability." },
      unknown: { downstream: "Report this advisory issue unless capability_is_stated is a finding.", diagnostic: "Name a bounded action, judgment, knowledge, or outcome for this capability." },
    },
  },
  {
    id: "activation_is_stated",
    primitive: "noul",
    intendedAnswer: true,
    instructions: "Do `skill.name` and `skill.description` identify at least one task, input, artifact, event, or condition in which this skill is relevant?",
    criteria: {
      true: "They name a recognizable task, input, artifact, event, or condition for using the skill.",
      false: "They provide no activation information, or only circular wording such as 'when needed', 'when appropriate', or 'when using this skill'.",
    },
    state: { supplied: ["skill.name", "skill.description"], withheld: ["skill body", "skill path", "other frontmatter", "repository context"] },
    outcomes: {
      pass: { downstream: "Do not report an activation-presence issue.", diagnostic: "No activation-presence change is needed." },
      finding: { downstream: "Report this issue and suppress activation_is_specific.", diagnostic: "Name a concrete task, input, artifact, event, or condition where this skill is relevant." },
      unknown: { downstream: "Report this advisory issue without suppressing activation_is_specific.", diagnostic: "Name a concrete task, input, artifact, event, or condition where this skill is relevant." },
    },
  },
  {
    id: "activation_is_specific",
    primitive: "noul",
    intendedAnswer: true,
    instructions: "Do `skill.name` and `skill.description` identify an activation condition specific enough for an agent to decide whether a user request should invoke this skill?",
    criteria: {
      true: "They identify a recognizable user intent, task, input, artifact, event, or condition that makes the skill relevant.",
      false: "They name only a broad domain or category, or use vague or circular activation wording.",
    },
    state: { supplied: ["skill.name", "skill.description"], withheld: ["skill body", "skill path", "other frontmatter", "repository context"] },
    outcomes: {
      pass: { downstream: "Do not report an activation-specificity issue.", diagnostic: "No activation-specificity change is needed." },
      finding: { downstream: "Report this issue unless activation_is_stated is a finding.", diagnostic: "Identify a recognizable user intent, task, input, artifact, event, or condition that triggers this skill." },
      unknown: { downstream: "Report this advisory issue unless activation_is_stated is a finding.", diagnostic: "Identify a recognizable user intent, task, input, artifact, event, or condition that triggers this skill." },
    },
  },
  {
    id: "routing_metadata_is_focused",
    primitive: "noul",
    intendedAnswer: true,
    instructions: "Do `skill.name` and `skill.description` stay focused on identifying the skill's capability and deciding whether it is relevant?",
    criteria: {
      true: "They contain capability, activation conditions, meaningful non-matches, or brief domain context needed to distinguish the skill.",
      false: "They tell the invoked agent how to do the work, such as directing it to read documentation, run commands, follow steps, or apply an implementation method, or include extended examples or rationale not needed for routing.",
    },
    state: { supplied: ["skill.name", "skill.description"], withheld: ["skill body", "skill path", "other frontmatter", "repository context"] },
    outcomes: {
      pass: { downstream: "Do not report a routing-focus issue.", diagnostic: "No routing-focus change is needed." },
      finding: { downstream: "Report this issue.", diagnostic: "Keep the description to capability and routing; move post-invocation procedure into the skill body." },
      unknown: { downstream: "Report this advisory issue.", diagnostic: "Keep the description to capability and routing; move post-invocation procedure into the skill body." },
    },
  },
]);

export const QUESTION_DEPENDENCIES = Object.freeze([
  { source: "capability_is_stated", sourceClassification: "finding", suppresses: "capability_is_specific" },
  { source: "activation_is_stated", sourceClassification: "finding", suppresses: "activation_is_specific" },
]);

export const CALIBRATION_CASES = Object.freeze([
  {
    id: "complete_focused_positive",
    state: { skill: { name: "schema-diff", description: "Compares two JSON schemas and reports incompatible field changes. Use when reviewing a proposed API schema migration." } },
    expected: { pass: ["capability_is_stated", "capability_is_specific", "activation_is_stated", "activation_is_specific", "routing_metadata_is_focused"] },
  },
  {
    id: "capability_omitted_concrete_activation",
    state: { skill: { name: "pull-request-time", description: "Use when a pull request changes a database migration." } },
    expected: { finding: ["capability_is_stated"], pass: ["activation_is_stated", "activation_is_specific"] },
  },
  {
    id: "generic_capability_concrete_activation",
    state: { skill: { name: "code-helper", description: "Provides helpful guidance. Use when a pull request changes a database migration." } },
    expected: { pass: ["capability_is_stated", "activation_is_stated", "activation_is_specific"], finding: ["capability_is_specific"] },
  },
  {
    id: "activation_omitted",
    state: { skill: { name: "schema-diff", description: "Compares two JSON schemas and reports incompatible field changes." } },
    expected: { pass: ["capability_is_stated", "capability_is_specific"], finding: ["activation_is_stated"] },
  },
  {
    id: "broad_activation",
    state: { skill: { name: "schema-diff", description: "Compares two JSON schemas and reports incompatible field changes. Use for software work." } },
    expected: { pass: ["activation_is_stated"], finding: ["activation_is_specific"] },
  },
  {
    id: "procedural_routing_metadata",
    state: { skill: { name: "schema-diff", description: "Compares two JSON schemas for API reviews. Use when an API schema changes. First read every schema file, run the generator, and inspect the diff line by line." } },
    expected: { finding: ["routing_metadata_is_focused"] },
  },
]);

export function runtimeQuestions(contracts = QUESTION_CONTRACTS) {
  return Object.freeze(Object.fromEntries(contracts.map(({ id, primitive, instructions, criteria }) => [id, { type: primitive, instructions, criteria }])));
}

export function suppressedQuestionIds(results, dependencies = QUESTION_DEPENDENCIES) {
  return new Set(dependencies
    .filter(({ source, sourceClassification }) => results[source]?.classification === sourceClassification)
    .map(({ suppresses }) => suppresses));
}

export function validateQuestionContracts(contracts = QUESTION_CONTRACTS, dependencies = QUESTION_DEPENDENCIES) {
  const ids = new Set();
  for (const contract of contracts) {
    if (!contract || typeof contract !== "object") throw new Error("question contract must be an object");
    if (typeof contract.id !== "string" || !/^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/.test(contract.id)) throw new Error(`invalid snake_case question id: ${String(contract.id)}`);
    if (ids.has(contract.id)) throw new Error(`duplicate question id: ${contract.id}`);
    ids.add(contract.id);
    if (contract.primitive !== "noul") throw new Error(`${contract.id}: unsupported primitive ${String(contract.primitive)}`);
    if (contract.intendedAnswer !== true && contract.intendedAnswer !== false) throw new Error(`${contract.id}: intendedAnswer must be boolean`);
    for (const [field, value] of [["instructions", contract.instructions], ["criteria.true", contract.criteria?.true], ["criteria.false", contract.criteria?.false]]) {
      if (typeof value !== "string" || value.trim() === "") throw new Error(`${contract.id}: ${field} must be nonempty`);
    }
    if (JSON.stringify(Object.keys(contract.criteria).sort()) !== JSON.stringify(["false", "true"])) throw new Error(`${contract.id}: Noul criteria must have exactly true and false`);
    for (const field of ["supplied", "withheld"]) {
      if (!Array.isArray(contract.state?.[field]) || contract.state[field].length === 0 || contract.state[field].some((value) => typeof value !== "string" || value.trim() === "")) {
        throw new Error(`${contract.id}: state.${field} must contain nonempty fields`);
      }
    }
    if (JSON.stringify(Object.keys(contract.outcomes ?? {}).sort()) !== JSON.stringify([...OUTCOME_KEYS].sort())) throw new Error(`${contract.id}: outcomes must have exactly pass, finding, unknown`);
    for (const outcome of OUTCOME_KEYS) {
      for (const field of ["downstream", "diagnostic"]) {
        if (typeof contract.outcomes[outcome]?.[field] !== "string" || contract.outcomes[outcome][field].trim() === "") throw new Error(`${contract.id}: outcomes.${outcome}.${field} must be nonempty`);
      }
    }
  }

  const edges = new Set();
  const graph = new Map([...ids].map((id) => [id, []]));
  for (const dependency of dependencies) {
    if (!ids.has(dependency.source) || !ids.has(dependency.suppresses)) throw new Error(`invalid dependency reference: ${dependency.source} -> ${dependency.suppresses}`);
    if (dependency.source === dependency.suppresses) throw new Error(`self dependency: ${dependency.source}`);
    if (dependency.sourceClassification !== "finding") throw new Error(`unsupported dependency classification: ${String(dependency.sourceClassification)}`);
    const edge = `${dependency.source}->${dependency.suppresses}`;
    if (edges.has(edge)) throw new Error(`duplicate dependency: ${edge}`);
    edges.add(edge);
    graph.get(dependency.source).push(dependency.suppresses);
  }
  const visiting = new Set();
  const visited = new Set();
  function visit(id) {
    if (visiting.has(id)) throw new Error("question dependencies must be acyclic");
    if (visited.has(id)) return;
    visiting.add(id);
    for (const target of graph.get(id)) visit(target);
    visiting.delete(id);
    visited.add(id);
  }
  for (const id of ids) visit(id);
  return true;
}
