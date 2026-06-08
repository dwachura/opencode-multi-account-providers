import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";

export function requiredEnv<T>(env: Dict<T>, name: string): T {
  const value = env[name];
  return (
    value ??
    (() => {
      throw new Error(`Env ${name} not found`);
    })()
  );
}

const sharedEnvKeys = ["apiUrl"] as const;
export type SharedEnvKey = (typeof sharedEnvKeys)[number];

export type PluginSharedEnv = {
  get<T>(name: SharedEnvKey): Promise<T | undefined>;
  getRequired<T>(name: SharedEnvKey): Promise<T>;
  set<T>(name: SharedEnvKey, value: T): Promise<void>;
};

export const PluginSharedEnv = {
  async init(filePath: string): Promise<PluginSharedEnv> {
    await mkdir(filePath, { recursive: true });
    const envFilePath = path.join(filePath, "env.json");
    async function readEnvFile(): Promise<Dict<any>> {
      try {
        const content = await readFile(envFilePath, "utf-8");
        return JSON.parse(content);
      } catch (err) {
        if (err instanceof Error && "code" in err && err.code === "ENOENT") {
          return {};
        }
        throw err;
      }
    }
    async function get<T>(name: SharedEnvKey): Promise<T | undefined> {
      return (await readEnvFile())[name] as T;
    }
    return {
      get,
      async getRequired<T>(name: SharedEnvKey): Promise<T> {
        const raw = await get(name);
        if (raw === undefined) throw Error(`Env ${name} not defined`);
        return raw as T;
      },
      async set<T>(name: SharedEnvKey, value: T): Promise<void> {
        const env = await readEnvFile();
        env[name] = value;
        await writeFile(envFilePath, JSON.stringify(env), { flag: "w" });
      },
    };
  },
};
