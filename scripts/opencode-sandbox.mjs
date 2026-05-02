#!/usr/bin/env node
import { spawn } from "node:child_process";
import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const PROVIDER_ENV = [
  "ANTHROPIC_API_KEY",
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
  "AWS_SESSION_TOKEN",
  "AZURE_OPENAI_API_KEY",
  "GEMINI_API_KEY",
  "GOOGLE_GENERATIVE_AI_API_KEY",
  "GROQ_API_KEY",
  "OPENAI_API_KEY",
  "OPENROUTER_API_KEY",
];

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  const plugin = readPluginSpec(args);
  const root = await mkdtemp(path.join(os.tmpdir(), "opencode-map-"));
  const paths = sandboxPaths(root);
  const env = sandboxEnv(paths);

  try {
    await writeSandbox(paths, plugin);

    const summary = {
      sandbox: root,
      project: paths.project,
      configDir: paths.config,
      serverConfig: path.join(paths.config, "opencode.jsonc"),
      tuiConfig: path.join(paths.config, "tui.jsonc"),
      plugin,
      opencode: args.opencode,
      env: env.overrides,
      scrubbed: env.scrubbed,
      dryRun: args.dryRun,
      keep: args.keep,
    };

    if (args.dryRun) {
      console.log(JSON.stringify(summary, null, 2));
      return;
    }

    const executable = await resolveExecutable(args.opencode);
    console.error(`OpenCode sandbox: ${root}`);
    console.error(`Project: ${paths.project}`);
    console.error(`Config: ${paths.config}`);

    await runOpenCode(executable, paths.project, env.full);
  } finally {
    if (!args.keep) await rm(root, { recursive: true, force: true });
  }
}

function parseArgs(argv) {
  const out = {
    opencode: "opencode",
    plugin: ".",
    released: false,
    keep: false,
    dryRun: false,
    help: false,
  };

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") out.help = true;
    else if (arg === "--keep") out.keep = true;
    else if (arg === "--dry-run") out.dryRun = true;
    else if (arg === "--released") out.released = true;
    else if (arg === "--plugin") out.plugin = readValue(argv, ++index, arg);
    else if (arg === "--opencode") out.opencode = readValue(argv, ++index, arg);
    else throw new Error(`Unknown option: ${arg}`);
  }

  return out;
}

function readValue(argv, index, flag) {
  const value = argv[index];
  if (!value || value.startsWith("--"))
    throw new Error(`${flag} requires a value`);
  return value;
}

function readPluginSpec(args) {
  if (args.released) return args.plugin;
  if (args.plugin.startsWith("file://")) return args.plugin;
  return pathToFileURL(path.resolve(args.plugin)).href;
}

function sandboxPaths(root) {
  return {
    root,
    home: path.join(root, "home"),
    config: path.join(root, "config", "opencode"),
    data: path.join(root, "xdg", "data"),
    cache: path.join(root, "xdg", "cache"),
    state: path.join(root, "xdg", "state"),
    xdgConfig: path.join(root, "xdg", "config"),
    project: path.join(root, "project"),
  };
}

async function writeSandbox(paths, plugin) {
  await Promise.all([
    mkdir(paths.home, { recursive: true }),
    mkdir(paths.config, { recursive: true }),
    mkdir(paths.data, { recursive: true }),
    mkdir(paths.cache, { recursive: true }),
    mkdir(paths.state, { recursive: true }),
    mkdir(paths.xdgConfig, { recursive: true }),
    mkdir(paths.project, { recursive: true }),
  ]);

  await Promise.all([
    writeFile(
      path.join(paths.config, "opencode.jsonc"),
      `${JSON.stringify(
        {
          $schema: "https://opencode.ai/config.json",
          plugin: [plugin],
        },
        null,
        2,
      )}\n`,
    ),
    writeFile(
      path.join(paths.config, "tui.jsonc"),
      `${JSON.stringify(
        {
          $schema: "https://opencode.ai/tui.json",
          plugin: [plugin],
        },
        null,
        2,
      )}\n`,
    ),
  ]);
}

function sandboxEnv(paths) {
  const full = { ...process.env };
  const scrubbed = [];

  for (const key of PROVIDER_ENV) {
    if (key in full) scrubbed.push(key);
    delete full[key];
  }

  const overrides = {
    HOME: paths.home,
    XDG_DATA_HOME: paths.data,
    XDG_CACHE_HOME: paths.cache,
    XDG_CONFIG_HOME: paths.xdgConfig,
    XDG_STATE_HOME: paths.state,
    OPENCODE_CONFIG_DIR: paths.config,
    OPENCODE_DB: path.join(paths.state, "opencode.db"),
    OPENCODE_DISABLE_PROJECT_CONFIG: "true",
    OPENCODE_DISABLE_DEFAULT_PLUGINS: "true",
  };

  Object.assign(full, overrides);
  delete full.OPENCODE_PURE;

  return { full, overrides, scrubbed };
}

async function resolveExecutable(command) {
  if (command.includes(path.sep)) {
    await access(command, constants.X_OK).catch(() => {
      throw new Error(
        `OpenCode executable not found or not executable: ${command}`,
      );
    });
    return command;
  }

  for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
    if (!dir) continue;
    const candidate = path.join(dir, command);
    if (await isExecutable(candidate)) return candidate;
  }

  throw new Error(
    `OpenCode executable not found: ${command}. Install OpenCode or pass --opencode /path/to/opencode.`,
  );
}

async function isExecutable(file) {
  return access(file, constants.X_OK)
    .then(() => true)
    .catch(() => false);
}

function runOpenCode(executable, cwd, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, [], {
      cwd,
      env,
      stdio: "inherit",
    });

    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (signal) {
        process.kill(process.pid, signal);
        return;
      }
      process.exitCode = code ?? 1;
      resolve();
    });
  });
}

function printHelp() {
  console.log(`Usage: npm run opencode:sandbox -- [options]

Options:
  --plugin <value>            Plugin path, file URL, or package name (if --released is specified), default: .
  --released                  Interpret --plugin as released npm package name
  --opencode <path|command>   OpenCode executable, default: opencode
  --keep                      Keep sandbox files after exit
  --dry-run                   Write sandbox files and print config without starting OpenCode
`);
}
