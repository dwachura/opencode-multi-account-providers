import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { test } from "node:test"

const execFileAsync = promisify(execFile)

test("sandbox dry-run emits local file plugin config", async () => {
  const { stdout } = await execFileAsync(process.execPath, ["scripts/opencode-sandbox.mjs", "--dry-run"])
  const out = JSON.parse(stdout)

  assert.equal(out.dryRun, true)
  assert.match(out.plugin, /^file:\/\//)
  assert.equal(out.env.OPENCODE_DISABLE_PROJECT_CONFIG, "true")
  assert.equal(out.env.OPENCODE_DISABLE_DEFAULT_PLUGINS, "true")
  assert.equal("OPENCODE_PURE" in out.env, false)
})

test("sandbox dry-run accepts released package name", async () => {
  const { stdout } = await execFileAsync(process.execPath, [
    "scripts/opencode-sandbox.mjs",
    "--dry-run",
    "--released",
    "--plugin",
    "opencode-multi-account-providers",
  ])
  const out = JSON.parse(stdout)

  assert.equal(out.plugin, "opencode-multi-account-providers")
})
