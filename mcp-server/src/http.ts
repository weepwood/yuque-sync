import crypto from "node:crypto";
import { createServer } from "node:http";
import { createMcpExpressApp } from "@modelcontextprotocol/express";
import { toNodeHandler } from "@modelcontextprotocol/node";
import { createMcpHandler } from "@modelcontextprotocol/server";
import type { NextFunction, Request, Response } from "express";
import { loadConfig } from "./config/env.js";
import { createLogger } from "./config/logger.js";
import { createYuqueMcpServer } from "./mcp/server.js";

const config = loadConfig();
const logger = createLogger(config);

function secureEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) return false;
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function bearerAuth(req: Request, res: Response, next: NextFunction): void {
  if (!config.mcpBearerToken) {
    next();
    return;
  }

  const authorization = req.header("authorization") ?? "";
  const [scheme, token] = authorization.split(" ", 2);
  if (scheme?.toLowerCase() !== "bearer" || !token || !secureEqual(token, config.mcpBearerToken)) {
    res.setHeader("WWW-Authenticate", 'Bearer realm="yuque-image-mcp"');
    res.status(401).json({ error: "unauthorized" });
    return;
  }

  next();
}

function createRateLimiter() {
  const buckets = new Map<string, { count: number; resetAt: number }>();

  return (req: Request, res: Response, next: NextFunction): void => {
    const now = Date.now();
    const key = req.ip || req.socket.remoteAddress || "unknown";
    const current = buckets.get(key);

    if (!current || current.resetAt <= now) {
      buckets.set(key, {
        count: 1,
        resetAt: now + config.rateLimitWindowMs,
      });
      next();
      return;
    }

    current.count += 1;
    if (current.count > config.rateLimitMaxRequests) {
      const retryAfter = Math.max(1, Math.ceil((current.resetAt - now) / 1000));
      res.setHeader("Retry-After", String(retryAfter));
      res.status(429).json({ error: "rate_limit_exceeded" });
      return;
    }

    if (buckets.size > 2_000) {
      for (const [bucketKey, bucket] of buckets) {
        if (bucket.resetAt <= now) buckets.delete(bucketKey);
      }
    }

    next();
  };
}

const app = createMcpExpressApp({
  host: config.host,
  allowedHosts: config.allowedHosts.length ? config.allowedHosts : undefined,
  allowedOrigins: config.allowedOrigins.length ? config.allowedOrigins : undefined,
  jsonLimit: "2mb",
});
app.disable("x-powered-by");

app.get("/healthz", (_req, res) => {
  res.json({
    status: "ok",
    service: "yuque-image-mcp",
    version: "1.0.0",
  });
});

app.get("/readyz", (_req, res) => {
  res.json({
    status: "ready",
    mcp_path: config.mcpPath,
    default_repo_configured: Boolean(config.yuqueRepo),
  });
});

app.options(config.mcpPath, (_req, res) => {
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, MCP-Protocol-Version, MCP-Session-Id, Last-Event-ID",
  );
  res.setHeader("Access-Control-Expose-Headers", "MCP-Session-Id");
  res.status(204).end();
});

const mcpHandler = createMcpHandler(
  () => createYuqueMcpServer(config, logger),
  {
    legacy: "stateless",
    responseMode: "auto",
    onerror: (error) => {
      logger.error({ error: error.message, stack: error.stack }, "MCP handler error");
    },
  },
);
const nodeHandler = toNodeHandler(mcpHandler, {
  onerror: (error) => {
    logger.error({ error: error.message, stack: error.stack }, "Node MCP adapter error");
  },
});

app.all(
  config.mcpPath,
  bearerAuth,
  createRateLimiter(),
  async (req: Request, res: Response, next: NextFunction) => {
    res.setHeader("Access-Control-Expose-Headers", "MCP-Session-Id");
    try {
      await nodeHandler(req, res, req.body);
    } catch (error) {
      next(error);
    }
  },
);

app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  logger.error(
    {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    },
    "Unhandled HTTP error",
  );
  if (!res.headersSent) {
    res.status(500).json({ error: "internal_server_error" });
  }
});

const httpServer = createServer(app);
httpServer.listen(config.port, config.host, () => {
  logger.info(
    {
      host: config.host,
      port: config.port,
      mcpPath: config.mcpPath,
      bearerAuthEnabled: Boolean(config.mcpBearerToken),
    },
    "Yuque Image MCP server started",
  );
});

async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, "Shutting down");
  httpServer.close((error) => {
    if (error) {
      logger.error({ error: error.message }, "HTTP server close failed");
      process.exitCode = 1;
    }
  });
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("unhandledRejection", (error) => {
  logger.error({ error: String(error) }, "Unhandled promise rejection");
});
process.on("uncaughtException", (error) => {
  logger.fatal({ error: error.message, stack: error.stack }, "Uncaught exception");
  process.exit(1);
});
