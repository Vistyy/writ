import { resolve } from "node:path";
import { runMarkdownCheck } from "./markdown-check.mjs";
import { main as runQuestions } from "./question-check.mjs";
import { main as runReferences } from "./reference-lint.mjs";
import { main as runRouting } from "./semantic-lint.mjs";

export const VERSION = "0.1.0";
export const USAGE = `Usage: writ <command> [--root <path>]

Commands:
  check       Run deterministic Markdown checks
  routing     Check skill routing metadata with TypeSafe
  references  Check instruction references with TypeSafe when needed
  questions   Calibrate and validate semantic question contracts

Options:
  --root <path>  Consumer repository root (default: current directory)
  --help         Show help
  --version      Show version`;

function parse(argv, cwd) {
  if (argv.length === 1 && (argv[0] === "--help" || argv[0] === "-h")) return { action: "help" };
  if (argv.length === 1 && (argv[0] === "--version" || argv[0] === "-v")) return { action: "version" };
  const command = argv[0];
  if (!command || !["check", "routing", "references", "questions"].includes(command)) throw new Error(command ? `unknown command: ${command}` : "missing command");
  if (argv.includes("--help") || argv.includes("-h")) {
    if (argv.length !== 2) throw new Error("--help does not accept other arguments");
    return { action: "help" };
  }
  let root = cwd;
  const rest = argv.slice(1);
  if (rest.length) {
    if (rest.length !== 2 || rest[0] !== "--root" || !rest[1] || rest[1].startsWith("-")) throw new Error("invalid arguments");
    if (command === "questions") throw new Error("questions does not accept --root");
    root = resolve(cwd, rest[1]);
  }
  return { action: "command", command, root };
}

export async function runCli({
  argv = process.argv.slice(2),
  cwd = process.cwd(),
  stdout = console.log,
  stderr = console.error,
  commands = {},
} = {}) {
  let parsed;
  try {
    parsed = parse(argv, cwd);
  } catch (error) {
    stderr(`ERROR ${error.message}`);
    stderr(USAGE);
    return 2;
  }
  if (parsed.action === "help") {
    stdout(USAGE);
    return 0;
  }
  if (parsed.action === "version") {
    stdout(VERSION);
    return 0;
  }
  const implementations = {
    check: ({ root }) => runMarkdownCheck({ root, stdout, stderr }),
    routing: ({ root }) => runRouting({ root, stdout, stderr }),
    references: ({ root }) => runReferences({ root, stdout, stderr }),
    questions: () => runQuestions({ stdout, stderr }),
    ...commands,
  };
  return implementations[parsed.command]({ root: parsed.root, stdout, stderr });
}
