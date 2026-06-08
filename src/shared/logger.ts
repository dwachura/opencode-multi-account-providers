import { PLUGIN_ID } from "./constants.js";

export const LOG_LEVELS = ["debug", "info", "warn", "error"] as const;

export type LogLevel = (typeof LOG_LEVELS)[number];

type LogInput = {
  body: {
    service: typeof PLUGIN_ID;
    level: LogLevel;
    message: string;
    extra?: Record<string, unknown>;
  };
};

type LogClient = {
  log: (input: LogInput) => Promise<unknown>;
};

async function logPluginEvent(
  client: LogClient,
  level: LogLevel,
  message: string,
  extra?: Record<string, unknown>,
) {
  await client
    .log({
      body: {
        service: PLUGIN_ID,
        level,
        message,
        extra,
      },
    })
    .catch(() => {});
}

export interface Logger {
  log(
    message: string,
    level?: LogLevel,
    extra?: Record<string, unknown>,
  ): Promise<unknown>;
}

export const Logger = {
  init(client: LogClient, source: string, defaultLevel: LogLevel): Logger {
    return {
      log: async (message, level = defaultLevel, extra = {}) => {
        await logPluginEvent(client, level, message, {
          source: source,
          ...extra,
        });
      },
    };
  },
};
