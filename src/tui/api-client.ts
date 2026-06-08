import { HealthResponse, PluginApi } from "../shared/api.js";

export function createPluginApiClient(apiUrl: string): PluginApi {
  return {
    async health(): Promise<HealthResponse> {
      const response = await fetch(`${apiUrl}/health`, {
        method: "GET",
        headers: {
          Accept: "application/json",
        },
      });
      console.log(`Called GET /health: ${response.status}, ${JSON.stringify(response)}`)
      if (!response.ok) {
        throw new Error(
          `API request failed: ${response.status} ${response.statusText}`,
        );
      }
      return (await response.json()) as HealthResponse;
    },
  };
}
