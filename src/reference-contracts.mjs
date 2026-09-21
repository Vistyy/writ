const OUTCOMES = ["pass", "finding", "unknown"];
export const REFERENCE_MODEL = "jev-1.13.0";

export const REFERENCE_CONTRACTS = Object.freeze([
  {
    id: "target_content_must_be_consulted",
    primitive: "noul",
    model: REFERENCE_MODEL,
    intendedAnswer: true,
    instructions: "Does completing this exact instruction require consulting the target file's content as guidance, authority, format, or procedure needed for another action? Judge only the role the span assigns to the target.",
    criteria: {
      true: "The span directs reading, consulting, following, checking, or otherwise using the target's content as an input to the work (for example: read X before doing Y, follow its guidance, check against it).",
      false: "The target is only named as an owner, cited, navigated, described, or directly modified or executed as the action object, without requiring its content as an input (for example: X owns Y; update the examples in X).",
    },
    state: { supplied: ["occurrence.heading", "occurrence.span", "occurrence.link.text", "occurrence.link.target", "occurrence.path"], withheld: ["shared request state", "source path", "target content", "repository context"] },
    outcomes: {
      pass: { downstream: "Consume loading_trigger_is_explicit.", diagnostic: "No consultation-role change is needed." },
      finding: { downstream: "Do not consume loading_trigger_is_explicit.", diagnostic: "The reference does not direct consulting the target's content; no trigger diagnostic applies." },
      unknown: { downstream: "Report an advisory and do not conclude loading_trigger_is_explicit.", diagnostic: "Clarify whether the target's content must be consulted." },
    },
  },
  {
    id: "loading_trigger_is_explicit",
    primitive: "noul",
    model: REFERENCE_MODEL,
    intendedAnswer: true,
    instructions: "Given only the instruction block in span, its local heading context in heading, and the exact link identity in link, if consultation of the target is directed, do the supplied span or heading explicitly state when to consult? Answer yes when they state an unconditional scope explicitly (for example Always read), or name one or more concrete tasks, events, states, or conditions that trigger consultation. Compound triggers joined by and, or, either/or, or a list remain explicit. A local heading counts only when it itself states a recognizable task, event, state, or condition that scopes the directive. Relative terms such as these limits or the threshold count as named triggers even when defined elsewhere; this question does not judge dependency completeness or runtime truth. Answer no for a bare directive with no stated scope, vague discretion such as as needed, when relevant, if useful, when appropriate, or warranted without criteria, and spans that do not direct consultation. Do not infer that a bare imperative means always. Judge only heading, span, and link.",
    criteria: {
      true: "Consultation is directed and its scope is explicit in the span or heading: explicitly unconditional, or one or more named tasks, events, states, or conditions, including compound triggers.",
      false: "No consultation is directed, or its scope is absent, bare, or delegated only to vague discretion; an unqualified imperative without scoped heading context is not explicit.",
    },
    state: { supplied: ["occurrence.heading", "occurrence.span", "occurrence.link.text", "occurrence.link.target", "occurrence.path"], withheld: ["shared request state", "source path", "target content", "repository context"] },
    outcomes: {
      pass: { downstream: "No diagnostic.", diagnostic: "No trigger-scope change is needed." },
      finding: { downstream: "Report an advisory.", diagnostic: "State explicitly when the target must be consulted." },
      unknown: { downstream: "Report an advisory.", diagnostic: "Clarify when the target must be consulted." },
    },
  },
  {
    id: "target_is_expected_to_exist",
    primitive: "noul",
    model: REFERENCE_MODEL,
    intendedAnswer: true,
    instructions: "Given only the instruction span and the exact backticked Markdown path, does the instruction treat that path as an artifact that already exists and is available now? Answer yes when the path is assigned a current role such as content to read, consult, follow, check, validate against, edit, update, synchronize, move from, delete, or a current owner/source of truth. Answer no when the path is a new artifact to create, generate, initialize, copy or rename into, a destination or output filename that need not exist yet, an optional artifact explicitly guarded by if present/if it exists, or a hypothetical/example path. Judge whether prior existence is required by the instruction, not whether the operation could overwrite an existing file. Do not use repository knowledge or infer from the path name.",
    criteria: {
      true: "The instruction requires or presupposes that the target artifact already exists now.",
      false: "The instruction does not require prior existence because the target is to be created/generated/initialized, is only an output or destination, is explicitly optional if present, or is hypothetical/example text.",
    },
    state: { supplied: ["occurrence.span", "occurrence.path"], withheld: ["shared request state", "source path", "target content", "repository context"] },
    outcomes: {
      pass: { downstream: "Report a stale-reference advisory.", diagnostic: "The instruction expects this missing target to exist; restore it or update the reference." },
      finding: { downstream: "No diagnostic.", diagnostic: "The missing path is intentional creation, output, destination, optional, or example text." },
      unknown: { downstream: "Report an advisory.", diagnostic: "Clarify whether this missing path is expected to exist already." },
    },
  },
]);

export const REFERENCE_DEPENDENCIES = Object.freeze([
  { source: "target_content_must_be_consulted", sourceClassification: "pass", consumes: "loading_trigger_is_explicit" },
]);

export const REFERENCE_CALIBRATION_CASES = Object.freeze([
  { id: "ownership_not_consultation", kind: "existing", heading: "Architecture", span: "`docs/design.md` owns architecture decisions.", text: "docs/design.md", path: "docs/design.md", expected: { target_content_must_be_consulted: "finding" } },
  { id: "direct_modification_not_consultation", kind: "existing", heading: "Docs", span: "Update `docs/design.md` when the API changes.", text: "docs/design.md", path: "docs/design.md", expected: { target_content_must_be_consulted: "finding" } },
  { id: "explicit_before_trigger", kind: "existing", heading: "Architecture", span: "Read `docs/design.md` before changing architecture.", text: "docs/design.md", path: "docs/design.md", expected: { target_content_must_be_consulted: "pass", loading_trigger_is_explicit: "pass" } },
  { id: "compound_trigger", kind: "existing", heading: "Work", span: "Consult `docs/policy.md` before release or when permissions change.", text: "docs/policy.md", path: "docs/policy.md", expected: { target_content_must_be_consulted: "pass", loading_trigger_is_explicit: "pass" } },
  { id: "scoped_heading_bare_directive", kind: "existing", heading: "When changing authentication", span: "Read `docs/auth.md`.", text: "docs/auth.md", path: "docs/auth.md", expected: { target_content_must_be_consulted: "pass", loading_trigger_is_explicit: "pass" } },
  { id: "unscoped_bare_directive", kind: "existing", heading: "References", span: "Read `docs/auth.md`.", text: "docs/auth.md", path: "docs/auth.md", expected: { target_content_must_be_consulted: "pass", loading_trigger_is_explicit: "finding" } },
  { id: "vague_trigger", kind: "existing", heading: "References", span: "Read `docs/auth.md` when relevant.", text: "docs/auth.md", path: "docs/auth.md", expected: { target_content_must_be_consulted: "pass", loading_trigger_is_explicit: "finding" } },
  { id: "missing_ownership", kind: "missing", span: "`docs/design.md` owns architecture decisions.", path: "docs/design.md", expected: { target_is_expected_to_exist: "pass" } },
  { id: "missing_read", kind: "missing", span: "Read `docs/design.md` before changing architecture.", path: "docs/design.md", expected: { target_is_expected_to_exist: "pass" } },
  { id: "missing_update", kind: "missing", span: "Update `docs/design.md` when the API changes.", path: "docs/design.md", expected: { target_is_expected_to_exist: "pass" } },
  { id: "missing_move_from", kind: "missing", span: "Move `docs/draft.md` into the archive.", path: "docs/draft.md", expected: { target_is_expected_to_exist: "pass" } },
  { id: "missing_create", kind: "missing", span: "Create `docs/design.md` for the proposal.", path: "docs/design.md", expected: { target_is_expected_to_exist: "finding" } },
  { id: "missing_generate_output", kind: "missing", span: "Generate output as `reports/results.md`.", path: "reports/results.md", expected: { target_is_expected_to_exist: "finding" } },
  { id: "missing_rename_to", kind: "missing", span: "Rename the draft to `docs/final.md`.", path: "docs/final.md", expected: { target_is_expected_to_exist: "finding" } },
  { id: "missing_if_present", kind: "missing", span: "If `docs/optional.md` exists, update it.", path: "docs/optional.md", expected: { target_is_expected_to_exist: "finding" } },
  { id: "missing_example", kind: "missing", span: "For example, use `docs/example.md`.", path: "docs/example.md", expected: { target_is_expected_to_exist: "finding" } },
]);

export function validateReferenceContracts(contracts = REFERENCE_CONTRACTS, dependencies = REFERENCE_DEPENDENCIES) {
  const ids = new Set();
  for (const contract of contracts) {
    if (!contract || typeof contract !== "object" || !/^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/.test(contract.id ?? "")) throw new Error("invalid reference contract id");
    if (ids.has(contract.id)) throw new Error(`duplicate reference contract id: ${contract.id}`);
    ids.add(contract.id);
    if (contract.primitive !== "noul" || contract.model !== REFERENCE_MODEL || typeof contract.intendedAnswer !== "boolean") throw new Error(`${contract.id}: invalid Noul contract`);
    if (typeof contract.instructions !== "string" || contract.instructions.trim() === "") throw new Error(`${contract.id}: instructions must be nonempty`);
    if (JSON.stringify(Object.keys(contract.criteria ?? {}).sort()) !== JSON.stringify(["false", "true"])) throw new Error(`${contract.id}: criteria must have exactly true and false`);
    if (!Array.isArray(contract.state?.supplied) || !Array.isArray(contract.state?.withheld) || contract.state.supplied.length === 0 || contract.state.withheld.length === 0) throw new Error(`${contract.id}: supplied and withheld state are required`);
    if (JSON.stringify(Object.keys(contract.outcomes ?? {}).sort()) !== JSON.stringify([...OUTCOMES].sort())) throw new Error(`${contract.id}: outcomes must have exactly pass, finding, unknown`);
    for (const outcome of OUTCOMES) if (!contract.outcomes[outcome]?.downstream || !contract.outcomes[outcome]?.diagnostic) throw new Error(`${contract.id}: incomplete ${outcome} outcome`);
  }
  for (const dependency of dependencies) {
    if (!ids.has(dependency.source) || !ids.has(dependency.consumes)) throw new Error(`invalid reference dependency: ${dependency.source} -> ${dependency.consumes}`);
    if (dependency.sourceClassification !== "pass") throw new Error("consultation dependency must consume trigger only on pass");
  }
  if (dependencies.length !== 1 || dependencies[0].source !== "target_content_must_be_consulted" || dependencies[0].consumes !== "loading_trigger_is_explicit") throw new Error("exact consultation-to-trigger dependency is required");
  return true;
}

const byId = Object.fromEntries(REFERENCE_CONTRACTS.map((contract) => [contract.id, contract]));
const json = (value) => JSON.stringify(value);

export function consultationQuestion(occurrence) {
  const contract = byId.target_content_must_be_consulted;
  return { type: "noul", instructions: `${contract.instructions}\n\nOccurrence: ${json({ heading: occurrence.heading, span: occurrence.span, link: { text: occurrence.text, target: occurrence.target }, path: occurrence.path })}`, criteria: contract.criteria };
}
export function triggerQuestion(occurrence) {
  const contract = byId.loading_trigger_is_explicit;
  return { type: "noul", instructions: `${contract.instructions}\n\nOccurrence: ${json({ heading: occurrence.heading, span: occurrence.span, link: { text: occurrence.text, target: occurrence.target }, path: occurrence.path })}`, criteria: contract.criteria };
}
export function expectedExistingQuestion(occurrence) {
  const contract = byId.target_is_expected_to_exist;
  return { type: "noul", instructions: `${contract.instructions}\n\nInstruction span: ${json(occurrence.span)}\nTarget path: \`${occurrence.path}\``, criteria: contract.criteria };
}
