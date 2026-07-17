import "dotenv/config";
import * as z from "zod/v4";

const numberFromEnv = (fallback: number, minimum = 1) =>
  z.preprocess(
    (value) => (value === undefined || value === "" ? fallback : Number(value)),
    z.number().int().min(minimum),
  );

const optionalTrimmedString = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.string().trim().optional(),
);

const envSchema = z.object({
  YUQUE_TOKEN: z.string().trim().min(1, "YUQUE_TOKEN is required"),
  YUQUE_COOKIE: z.string().trim().min(1, "YUQUE_COOKIE is required"),
  YUQUE_REPO: z.string().trim().min(3, "YUQUE_REPO is required"),
  YUQUE_BASE_URL: z.string().url().default("https://www.yuque.com"),
  YUQUE_UPLOAD_PATH: z.string().trim().default("/api/upload/attach"),
  HOST: z.string().trim().default("127.0.0.1"),
  PORT: numberFromEnv(8787, 1).pipe(z.number().max(65535)),
  MCP_PATH: z.string().trim().default("/mcp"),
  MCP_BEARER_TOKEN: optionalTrimmedString,
  ALLOWED_HOSTS: z.string().default("localhost,127.0.0.1"),
  ALLOWED_ORIGINS: z.string().default(""),
  MAX_IMAGE_MB: numberFromEnv(25, 1).pipe(z.number().max(100)),
  MAX_BATCH_IMAGES: numberFromEnv(10, 1).pipe(z.number().max(50)),
  REQUEST_TIMEOUT_MS: numberFromEnv(60_000, 1_000),
  RATE_LIMIT_WINDOW_MS: numberFromEnv(60_000, 1_000),
  RATE_LIMIT_MAX_REQUESTS: numberFromEnv(120, 1),
  DOCUMENT_TIMEZONE: z.string().trim().default("Asia/Tokyo"),
  LOG_LEVEL: z.string().trim().default("info"),
  DOWNLOAD_ALLOWED_HOSTS: z.string().default(""),
});

export interface AppConfig {
  yuqueToken: string;
  yuqueCookie: string;
  yuqueRepo: string;
  yuqueBaseUrl: string;
  yuqueUploadPath: string;
  host: string;
  port: number;
  mcpPath: string;
  mcpBearerToken?: string;
  allowedHosts: string[];
  allowedOrigins: string[];
  maxImageBytes: number;
  maxBatchImages: number;
  requestTimeoutMs: number;
  rateLimitWindowMs: number;
  rateLimitMaxRequests: number;
  documentTimezone: string;
  logLevel: string;
  downloadAllowedHosts: string[];
}

function csv(value: string): string[] {
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

function normalizePath(value: string): string {
  const trimmed = value.trim();
  const withLeadingSlash = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  return withLeadingSlash.length > 1 ? withLeadingSlash.replace(/\/+$/, "") : withLeadingSlash;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "environment"}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }

  const value = parsed.data;
  return {
    yuqueToken: value.YUQUE_TOKEN,
    yuqueCookie: value.YUQUE_COOKIE,
    yuqueRepo: value.YUQUE_REPO,
    yuqueBaseUrl: value.YUQUE_BASE_URL.replace(/\/+$/, ""),
    yuqueUploadPath: normalizePath(value.YUQUE_UPLOAD_PATH),
    host: value.HOST,
    port: value.PORT,
    mcpPath: normalizePath(value.MCP_PATH),
    mcpBearerToken: value.MCP_BEARER_TOKEN,
    allowedHosts: csv(value.ALLOWED_HOSTS),
    allowedOrigins: csv(value.ALLOWED_ORIGINS),
    maxImageBytes: value.MAX_IMAGE_MB * 1024 * 1024,
    maxBatchImages: value.MAX_BATCH_IMAGES,
    requestTimeoutMs: value.REQUEST_TIMEOUT_MS,
    rateLimitWindowMs: value.RATE_LIMIT_WINDOW_MS,
    rateLimitMaxRequests: value.RATE_LIMIT_MAX_REQUESTS,
    documentTimezone: value.DOCUMENT_TIMEZONE,
    logLevel: value.LOG_LEVEL,
    downloadAllowedHosts: csv(value.DOWNLOAD_ALLOWED_HOSTS).map((host) => host.toLowerCase()),
  };
}
