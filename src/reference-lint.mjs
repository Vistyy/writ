import { readdir, readFile, stat } from "node:fs/promises";
import { dirname, extname, relative, resolve } from "node:path";
import MarkdownIt from "markdown-it";
import { classify } from "./semantic-lint.mjs";
import { REFERENCE_MODEL, consultationQuestion, expectedExistingQuestion, triggerQuestion } from "./reference-contracts.mjs";

export { REFERENCE_MODEL };
const ROOT_FILES = ["AGENTS.md", "SYSTEM.md", "APPEND_SYSTEM.md"];
const md = new MarkdownIt({ html: false, linkify: false, typographer: false });

async function isFile(path) {
  try { return (await stat(path)).isFile(); } catch (error) { if (error?.code === "ENOENT") return false; throw error; }
}

export async function discoverInstructionMarkdown(root) {
  const found = [];
  for (const name of ROOT_FILES) if (await isFile(resolve(root, name))) found.push(resolve(root, name));
  async function visit(directory) {
    let entries;
    try { entries = await readdir(directory, { withFileTypes: true }); } catch (error) { if (error?.code === "ENOENT") return; throw error; }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile() && extname(entry.name).toLowerCase() === ".md") found.push(path);
    }
  }
  await visit(resolve(root, "skills"));
  await visit(resolve(root, "user-skills"));
  return found.sort((a, b) => relative(root, a).localeCompare(relative(root, b)));
}

function blankFrontmatter(source) {
  if (!source.startsWith("---\n") && !source.startsWith("---\r\n")) return source;
  const match = source.match(/^---\r?\n[\s\S]*?\r?\n---(?=\r?\n|$)/);
  return match ? source.slice(0, match.index) + match[0].replace(/[^\r\n]/g, " ") + source.slice(match[0].length) : source;
}

function inlineText(token) {
  return (token.children ?? []).map((child) => child.type === "softbreak" || child.type === "hardbreak" ? " " : child.content ?? "").join("").trim();
}

function localMarkdownTarget(raw) {
  if (typeof raw !== "string" || raw === "" || raw.startsWith("#") || raw.startsWith("/") || raw.startsWith("\\") || raw.startsWith("//") || /^[a-zA-Z][a-zA-Z+.-]*:/.test(raw) || raw.includes("?")) return null;
  const withoutFragment = raw.split("#", 1)[0];
  if (!withoutFragment || !/\.md$/i.test(withoutFragment)) return null;
  let decoded;
  try { decoded = decodeURIComponent(withoutFragment); } catch { return null; }
  if (!decoded || decoded === ".md" || decoded.includes("\0") || resolve("/", decoded) === "/.md") return null;
  return { path: decoded, target: raw };
}

function lineAtOffset(span, startLine, offset) {
  return startLine + 1 + (span.slice(0, Math.max(0, offset)).match(/\n/g)?.length ?? 0);
}

function locateLink(span, cursor, normalizedTarget, text) {
  const candidates = [];
  const inlinePattern = /!?\[([^\]]*)\]\(\s*(?:<([^>\n]+)>|([^\s)]+))/gs;
  inlinePattern.lastIndex = cursor;
  for (const match of span.matchAll(inlinePattern)) {
    const target = match[2] ?? match[3];
    if (md.normalizeLink(target) === normalizedTarget) candidates.push({ offset: match.index + (match[0].startsWith("!") ? 1 : 0), end: match.index + match[0].length, rank: 0, target });
  }
  const escapedText = text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (escapedText) {
    const referencePattern = new RegExp(`\\[${escapedText}\\](?:\\[[^\\]]*\\])?`, "g");
    referencePattern.lastIndex = cursor;
    const match = referencePattern.exec(span);
    if (match) candidates.push({ offset: match.index, end: referencePattern.lastIndex, rank: 1, target: normalizedTarget });
  }
  const autolink = `<${normalizedTarget}>`;
  const autolinkOffset = span.indexOf(autolink, cursor);
  if (autolinkOffset !== -1) candidates.push({ offset: autolinkOffset, end: autolinkOffset + autolink.length, rank: 0, target: normalizedTarget });
  return candidates.sort((left, right) => left.offset - right.offset || left.rank - right.rank || left.end - right.end)[0] ?? { offset: cursor, end: cursor, target: normalizedTarget };
}

function locateCode(span, cursor, child) {
  const wrapped = `${child.markup}${child.content}${child.markup}`;
  const wrappedOffset = span.indexOf(wrapped, cursor);
  if (wrappedOffset !== -1) return { offset: wrappedOffset, end: wrappedOffset + wrapped.length };
  const contentOffset = span.indexOf(child.content, cursor);
  return contentOffset === -1 ? { offset: cursor, end: cursor } : { offset: contentOffset, end: contentOffset + child.content.length };
}

export function extractReferenceOccurrences(source, sourcePath = "document.md") {
  const parsedSource = blankFrontmatter(source);
  const tokens = md.parse(parsedSource, {});
  const lines = source.split(/\r?\n/);
  const occurrences = [];
  let heading = "";
  const listItems = [];
  const tableRows = [];
  const blockCursors = new Map();
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    if (token.type === "heading_open") {
      const inline = tokens[index + 1];
      if (inline?.type === "inline") heading = inlineText(inline);
      continue;
    }
    if (token.type === "list_item_open") listItems.push(token.map);
    if (token.type === "list_item_close") listItems.pop();
    if (token.type === "tr_open") tableRows.push(token.map);
    if (token.type === "tr_close") tableRows.pop();
    if (token.type !== "inline") continue;
    const blockMap = listItems.at(-1) ?? token.map ?? tableRows.at(-1);
    if (!blockMap) continue;
    const rawSpan = lines.slice(blockMap[0], blockMap[1]).join("\n");
    const span = rawSpan.trim();
    const cursorKey = `${blockMap[0]}:${blockMap[1]}`;
    let sourceCursor = blockCursors.get(cursorKey) ?? 0;
    const children = token.children ?? [];
    let linkDepth = 0;
    for (let childIndex = 0; childIndex < children.length; childIndex++) {
      const child = children[childIndex];
      if (child.type === "link_open") {
        linkDepth++;
        const normalizedTarget = child.attrGet("href");
        let text = "";
        for (let cursor = childIndex + 1; cursor < children.length && children[cursor].type !== "link_close"; cursor++) text += children[cursor].content ?? "";
        const located = locateLink(rawSpan, sourceCursor, normalizedTarget, text);
        sourceCursor = located.end;
        const local = localMarkdownTarget(located.target);
        if (!local) continue;
        occurrences.push({ kind: "link", sourcePath, line: lineAtOffset(rawSpan, blockMap[0], located.offset), heading, span, text, target: located.target, path: local.path });
      } else if (child.type === "link_close") {
        linkDepth = Math.max(0, linkDepth - 1);
      } else if (child.type === "code_inline" && linkDepth === 0) {
        const located = locateCode(rawSpan, sourceCursor, child);
        sourceCursor = located.end;
        const local = localMarkdownTarget(child.content);
        if (!local) continue;
        occurrences.push({ kind: "backtick", sourcePath, line: lineAtOffset(rawSpan, blockMap[0], located.offset), heading, span, text: child.content, target: child.content, path: local.path });
      }
    }
    blockCursors.set(cursorKey, sourceCursor);
  }
  return occurrences;
}

export function resolveOccurrenceTarget(sourceFile, occurrence) {
  return resolve(dirname(sourceFile), occurrence.path.split("#", 1)[0]);
}

function validateResponse(response, questionIds) {
  if (response?.model !== REFERENCE_MODEL) throw new Error(`response model identity must be exactly ${REFERENCE_MODEL}; received ${String(response?.model)}`);
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

export async function runReferenceLint({ root, client, clientFactory, stdout = console.log, stderr = console.error }) {
  let fileCount = 0, occurrenceCount = 0, requestCount = 0, inputTokens = 0, outputTokens = 0;
  let clientPromise;
  const getClient = async () => {
    if (client) return client;
    clientPromise ??= Promise.resolve().then(() => clientFactory());
    return clientPromise;
  };
  try {
    const files = [];
    const missingLinks = [];
    for (const sourceFile of await discoverInstructionMarkdown(root)) {
      fileCount++;
      const displayPath = relative(root, sourceFile);
      const occurrences = extractReferenceOccurrences(await readFile(sourceFile, "utf8"), displayPath);
      occurrenceCount += occurrences.length;
      for (const occurrence of occurrences) {
        occurrence.exists = await isFile(resolveOccurrenceTarget(sourceFile, occurrence));
        if (!occurrence.exists && occurrence.kind === "link") missingLinks.push(occurrence);
      }
      files.push({ sourceFile, displayPath, occurrences });
    }
    if (missingLinks.length) {
      for (const occurrence of missingLinks) stderr(`ERROR ${occurrence.sourcePath}:${occurrence.line} missing Markdown link target ${occurrence.target}`);
      return 1;
    }

    for (const file of files) {
      const questions = {};
      const bindings = [];
      file.occurrences.forEach((occurrence, index) => {
        const prefix = `r${String(index + 1).padStart(4, "0")}`;
        if (!occurrence.exists) {
          const id = `${prefix}_expected`;
          questions[id] = expectedExistingQuestion(occurrence);
          bindings.push({ id, type: "expected", occurrence });
        } else {
          const consultation = `${prefix}_consultation`, trigger = `${prefix}_trigger`;
          questions[consultation] = consultationQuestion(occurrence);
          questions[trigger] = triggerQuestion(occurrence);
          bindings.push({ id: consultation, trigger, type: "existing", occurrence });
        }
      });
      if (Object.keys(questions).length === 0) continue;
      const response = await (await getClient()).systemOne({ model: REFERENCE_MODEL, state: "", questions });
      const results = validateResponse(response, Object.keys(questions));
      requestCount++;
      inputTokens += response.usage.input_tokens;
      outputTokens += response.usage.output_tokens;
      for (const binding of bindings) {
        const location = `${binding.occurrence.sourcePath}:${binding.occurrence.line}`;
        if (binding.type === "expected") {
          const result = results[binding.id];
          if (result.classification === "pass") stdout(`FINDING ${location} target_is_expected_to_exist p=${result.probability}: The instruction expects missing ${binding.occurrence.path} to exist; restore it or update the reference. [advisory]`);
          else if (result.classification === "unknown") stdout(`UNKNOWN ${location} target_is_expected_to_exist p=${result.probability}: Clarify whether missing ${binding.occurrence.path} is expected to exist already. [advisory]`);
          continue;
        }
        const consultation = results[binding.id];
        if (consultation.classification === "finding") continue;
        if (consultation.classification === "unknown") {
          stdout(`UNKNOWN ${location} target_content_must_be_consulted p=${consultation.probability}: Clarify whether ${binding.occurrence.path} must be consulted. [advisory]`);
          continue;
        }
        const trigger = results[binding.trigger];
        if (trigger.classification === "finding") stdout(`FINDING ${location} loading_trigger_is_explicit p=${trigger.probability}: State explicitly when ${binding.occurrence.path} must be consulted. [advisory]`);
        else if (trigger.classification === "unknown") stdout(`UNKNOWN ${location} loading_trigger_is_explicit p=${trigger.probability}: Clarify when ${binding.occurrence.path} must be consulted. [advisory]`);
      }
    }
    stdout(`RECEIPT model=${requestCount ? REFERENCE_MODEL : "none"} files=${fileCount} occurrences=${occurrenceCount} requests=${requestCount} input_tokens=${inputTokens} output_tokens=${outputTokens}`);
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
    return new TypeSafeClient({ defaultModel: REFERENCE_MODEL });
  },
  stdout = console.log,
  stderr = console.error,
} = {}) {
  return runReferenceLint({ root, clientFactory: createClient, stdout, stderr });
}

