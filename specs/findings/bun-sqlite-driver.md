# Finding: Bun SQLite Driver

OpenCode loads plugins under Bun.

`better-sqlite3` is not usable in that runtime. The plugin failed to load when `src/server/db.ts` statically imported `better-sqlite3`, with Bun reporting that `better-sqlite3` is not supported.

Current decision: server DB code uses Bun's built-in `bun:sqlite` driver directly.

Implications:

- server DB runtime is Bun-only
- do not add a static `better-sqlite3` import to plugin-loaded code
- if Node runtime support becomes required later, add a driver adapter with runtime-specific dynamic loading
