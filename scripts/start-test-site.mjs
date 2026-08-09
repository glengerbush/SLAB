import {
  copyFile,
  cp,
  mkdir,
  mkdtemp,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { spawn } from "node:child_process";

const source = process.cwd();
const target = await mkdtemp(join(tmpdir(), "blog-acceptance-"));
const targetRecord = resolve(source, ".astro", "acceptance-root.txt");
const skipped = new Set([
  ".git",
  ".astro",
  ".scratch",
  "dist",
  "node_modules",
  "playwright-report",
  "test-results",
]);

await cp(source, target, {
  recursive: true,
  filter(path) {
    const first = relative(source, path).split(/[\\/]/, 1)[0];
    return !skipped.has(first);
  },
});
const fixtureRoot = resolve(source, "tests", "e2e", "site-fixture");
await rm(resolve(target, "content"), { recursive: true, force: true });
await cp(resolve(fixtureRoot, "content"), resolve(target, "content"), {
  recursive: true,
});
await copyFile(
  resolve(fixtureRoot, "site.config.yaml"),
  resolve(target, "site.config.yaml"),
);
await symlink(
  resolve(source, "node_modules"),
  resolve(target, "node_modules"),
  process.platform === "win32" ? "junction" : "dir",
);
await mkdir(resolve(source, ".astro"), { recursive: true });
await writeFile(targetRecord, target);

const command = process.platform === "win32" ? "npm.cmd" : "npm";
const child = spawn(command, ["run", "dev", "--", "--port", "4399"], {
  cwd: target,
  env: { ...process.env, ASTRO_DEV_BACKGROUND: "0" },
  stdio: "inherit",
});

async function stop(signal = "SIGTERM") {
  child.kill(signal);
  await rm(target, { recursive: true, force: true });
  await rm(targetRecord, { force: true });
}

process.once("SIGTERM", () => void stop());
process.once("SIGINT", () => void stop("SIGINT"));
child.once("exit", async (code) => {
  await rm(target, { recursive: true, force: true });
  await rm(targetRecord, { force: true });
  process.exit(code ?? 1);
});
