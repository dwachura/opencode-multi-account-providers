import { PLUGIN_ID } from "./constants.js";

export const LOG_LEVELS = ["debug", "info", "warn", "error"] as const;

export type LogLevel = (typeof LOG_LEVELS)[number];

export type LogInput = {
  service: typeof PLUGIN_ID;
  message: string;
  level: LogLevel;
  extra?: Record<string, unknown>;
};

export interface Logger {
  log(
    message: LogInput["message"],
    level?: LogInput["level"],
    extra?: LogInput["extra"],
  ): Promise<unknown>;
}

export const Logger = {
  init(
    logFunc: (input: LogInput) => Promise<unknown>,
    source: string,
    defaultLevel: LogLevel,
  ): Logger {
    return {
      log: async (message, level = defaultLevel, extra = {}) => {
        await logFunc({
          service: PLUGIN_ID,
          message: message,
          level: level,
          extra: {
            source: source,
            ...extra,
          },
        });
      },
    };
  },
};
