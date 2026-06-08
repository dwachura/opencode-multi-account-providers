import { homedir } from "node:os";
import { LOG_LEVELS, LogLevel } from "../shared/logger.js";
import { OPENCODE_RUN_ID_ENV, PLUGIN_ID } from "./constants.js";
import { PluginSharedEnv, requiredEnv } from "./env.js";
import path from "node:path";

export type PluginContext = {
  logLevel: LogLevel;
  instanceId: string;
  dirs: {
    data: string;
    state: string;
  };
  env: PluginSharedEnv;
};

export const PluginContext = {
  async init(env: Dict<any>): Promise<PluginContext> {
    const instanceId = requiredEnv(env, OPENCODE_RUN_ID_ENV);
    const stateDir = path.join(
      defaultStateRoot(),
      "plugins",
      `${PLUGIN_ID}`,
      instanceId,
    );
    return {
      logLevel: readLogLevel(env.logLevel),
      instanceId: instanceId,
      dirs: {
        data: path.join(
          defaultDataRoot(),
          "plugins",
          `${PLUGIN_ID}`,
          instanceId,
        ),
        state: stateDir,
      },
      env: await PluginSharedEnv.init(stateDir),
    };
  },
};

function readLogLevel(value: unknown): LogLevel {
  if (value === undefined) return "info";
  if (typeof value !== "string" || !LOG_LEVELS.includes(value as LogLevel)) {
    throw new TypeError(`Invalid logLevel: ${String(value)}`);
  }
  return value as LogLevel;
}

// todo: make paths OS agnostic
function defaultDataRoot() {
  const dataRoot =
    process.env.XDG_DATA_HOME ?? path.join(homedir(), ".local", "share");
  return path.join(dataRoot, "opencode");
}

function defaultStateRoot() {
  const xdgState =
    process.env.XDG_STATE_HOME ?? path.join(homedir(), ".local", "state");
  return path.join(xdgState, "opencode");
}
