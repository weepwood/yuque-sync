import assert from "node:assert/strict";
import test from "node:test";
import { loadConfig } from "../src/config/env.js";

test("loadConfig normalizes paths and numeric limits", () => {
  const config = loadConfig({
    YUQUE_TOKEN: "token",
    YUQUE_COOKIE: "cookie",
    YUQUE_REPO: "weepwood/test",
    MCP_PATH: "mcp/secret/",
    MAX_IMAGE_MB: "10",
    ALLOWED_HOSTS: "example.com, localhost",
  });

  assert.equal(config.mcpPath, "/mcp/secret");
  assert.equal(config.maxImageBytes, 10 * 1024 * 1024);
  assert.deepEqual(config.allowedHosts, ["example.com", "localhost"]);
});

test("loadConfig rejects missing credentials", () => {
  assert.throws(() => loadConfig({}), /YUQUE_TOKEN:/);
});
