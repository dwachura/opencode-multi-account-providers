import { HealthResponse, PluginApi } from "../shared/api.js";
import { PLUGIN_ID } from "../shared/constants.js";

export type PluginApiServer = {
  basePath: string;
  host: string;
  port: number;
  url: string;
  startedAt: string;
  stop(): Promise<void>;
};

const API_BASE_PATH = `${PLUGIN_ID}`;

export const PluginApiServer = {
  async start(): Promise<PluginApiServer> {
    const api = pluginApi();
    const server = Bun.serve({
      hostname: "localhost",
      port: 0,
      fetch: async (request) => {
        const url = new URL(request.url);
        if (
          request.method === "GET" &&
          url.pathname === `/${API_BASE_PATH}/health`
        ) {
          return json(await api.health());
        }
        return json({ code: "not_found", message: "Route not found" }, 404);
      },
    });
    const startTime = new Date().toISOString();
    const port = server.port;
    if (port === undefined)
      throw new Error("AuthPoolServer did not receive a listening port");
    const host = server.hostname;
    if (host === undefined)
      throw new Error("AuthPoolServer did not receive a listening port");
    return {
      host: host,
      port: port,
      basePath: API_BASE_PATH,
      url: `http://${server.hostname}:${port}/${API_BASE_PATH}`,
      startedAt: startTime,
      stop() {
        return server.stop();
      },
    };
  },
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function pluginApi(): PluginApi {
  return {
    health: async function (): Promise<HealthResponse> {
      return { status: "healthy" };
    },
  };
}
