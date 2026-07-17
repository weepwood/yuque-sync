import assert from "node:assert/strict";
import test from "node:test";
import type { AppConfig } from "../src/config/env.js";
import { createLogger } from "../src/config/logger.js";
import { YuqueClient } from "../src/services/yuque.js";

const config: AppConfig = {
  yuqueToken: "token",
  yuqueCookie: "cookie",
  yuqueRepo: "weepwood/test",
  yuqueBaseUrl: "https://www.yuque.com",
  yuqueUploadPath: "/api/upload/attach",
  host: "127.0.0.1",
  port: 8787,
  mcpPath: "/mcp",
  allowedHosts: ["localhost"],
  allowedOrigins: [],
  maxImageBytes: 25 * 1024 * 1024,
  maxBatchImages: 10,
  requestTimeoutMs: 10_000,
  rateLimitWindowMs: 60_000,
  rateLimitMaxRequests: 120,
  documentTimezone: "Asia/Tokyo",
  logLevel: "silent",
  downloadAllowedHosts: [],
};

const logger = createLogger(config);

test("uploadImage uses Yuque attach endpoint and returns normalized URL", async () => {
  let requestUrl = "";
  let requestInit: RequestInit | undefined;
  const fetchMock = (async (input: URL | RequestInfo, init?: RequestInit) => {
    requestUrl = String(input);
    requestInit = init;
    return new Response(JSON.stringify({ data: { url: "//cdn.nlark.com/test.png" } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;

  const client = new YuqueClient(config, logger, fetchMock);
  const result = await client.uploadImage({
    bytes: new Uint8Array([1, 2, 3]),
    fileName: "test.png",
    mimeType: "image/png",
    sourceFileId: "file_test",
  });

  assert.equal(requestUrl, "https://www.yuque.com/api/upload/attach");
  assert.equal(requestInit?.method, "POST");
  assert.ok(requestInit?.body instanceof FormData);
  assert.equal(result.url, "https://cdn.nlark.com/test.png");
});

test("createOrUpdateDocument creates a document URL", async () => {
  const fetchMock = (async () =>
    new Response(
      JSON.stringify({ data: { id: 123, slug: "pink-guava", title: "Pink Guava" } }),
      { status: 200, headers: { "content-type": "application/json" } },
    )) as typeof fetch;

  const client = new YuqueClient(config, logger, fetchMock);
  const result = await client.createOrUpdateDocument({
    title: "Pink Guava",
    body: "content",
  });

  assert.equal(result.id, 123);
  assert.equal(result.slug, "pink-guava");
  assert.equal(result.url, "https://www.yuque.com/weepwood/test/pink-guava");
  assert.equal(result.updated, false);
});
