import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const temporary = await mkdtemp(join(tmpdir(), "writ-consumer-"));
try {
  const packDir = join(temporary, "pack");
  const consumer = join(temporary, "consumer");
  const repository = join(consumer, "repository");
  await mkdir(packDir);
  await mkdir(repository, { recursive: true });
  const packed = JSON.parse(execFileSync("pnpm", ["pack", "--pack-destination", packDir, "--json"], { cwd: root, encoding: "utf8" }));
  await writeFile(join(consumer, "package.json"), JSON.stringify({ private: true, dependencies: { "@syzom/writ": `file:${packed.filename}` } }, null, 2));
  execFileSync("pnpm", ["install", "--prefer-offline", "--ignore-scripts"], { cwd: consumer, stdio: "pipe" });
  await writeFile(join(repository, "AGENTS.md"), "# Consumer instructions\n");

  const run = (...args) => spawnSync("pnpm", ["exec", "writ", ...args], { cwd: consumer, encoding: "utf8" });
  const help = run("--help");
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /^Usage: writ/m);
  const version = run("--version");
  assert.equal(version.status, 0, version.stderr);
  assert.equal(version.stdout.trim(), "0.1.0");
  const check = run("check", "--root", "repository");
  assert.equal(check.status, 0, `${check.stdout}\n${check.stderr}`);
  console.log("SMOKE help=0 version=0 check=0");
} finally {
  await rm(temporary, { recursive: true, force: true });
}
