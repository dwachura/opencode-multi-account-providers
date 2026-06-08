export interface PluginApi {
  health: () => Promise<HealthResponse>;
}

export type HealthResponse =
  | {
      status: "healthy";
    }
  | {
      status: "degraded";
      problems: string[];
    };
