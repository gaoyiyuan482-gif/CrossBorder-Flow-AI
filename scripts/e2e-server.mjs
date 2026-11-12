import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { configureToolEnvironment } from "./tool-environment.mjs";

const projectRoot = process.cwd();
configureToolEnvironment(projectRoot);
const stateDir = mkdtempSync(join(tmpdir(), "crossborder-flow-e2e-"));
process.env.WRANGLER_CI_DISABLE_CONFIG_WATCHING = "true";
process.env.XDG_CONFIG_HOME = join(stateDir, "xdg-config");
process.env.XDG_CACHE_HOME = join(stateDir, "xdg-cache");
process.env.XDG_DATA_HOME = join(stateDir, "xdg-data");
process.env.WRANGLER_LOG_PATH = join(stateDir, "wrangler", "logs");
process.env.WRANGLER_REGISTRY_PATH = join(stateDir, "wrangler", "dev-registry");
process.env.MINIFLARE_REGISTRY_PATH = join(stateDir, "wrangler", "registry");
for (const directory of [process.env.XDG_CONFIG_HOME, process.env.XDG_CACHE_HOME, process.env.XDG_DATA_HOME, process.env.WRANGLER_LOG_PATH]) {
  mkdirSync(directory, { recursive: true });
}
const wrangler = join(projectRoot, "node_modules", "wrangler", "bin", "wrangler.js");
const run = (command, args) => {
  const result = spawnSync(command, args, { cwd: projectRoot, stdio: "inherit", env: process.env });
  if (result.status !== 0) process.exit(result.status ?? 1);
};

run(process.execPath, [join(projectRoot, "scripts", "run-framework.mjs"), "build"]);
for (const migration of ["drizzle/0000_flowery_eternity.sql", "drizzle/0001_supreme_stingray.sql"]) {
  run(process.execPath, [wrangler, "d1", "execute", "DB", "--local", "--config", "dist/server/wrangler.json", "--persist-to", stateDir, "--file", migration]);
}

const server = spawn(process.execPath, [
  "--import", join(projectRoot, "scripts", "sites-env.mjs"), wrangler, "dev",
  "--config", "dist/server/wrangler.json", "--local", "--persist-to", stateDir,
  "--ip", "127.0.0.1", "--port", "3100", "--inspector-port", "0",
], { cwd: projectRoot, stdio: "inherit", env: process.env });

const stop = () => {
  server.kill("SIGTERM");
  rmSync(stateDir, { recursive: true, force: true });
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
server.on("exit", (code) => {
  rmSync(stateDir, { recursive: true, force: true });
  process.exit(code ?? 0);
});
