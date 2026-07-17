import pino, { type DestinationStream } from "pino";
import type { AppConfig } from "./env.js";

export function createLogger(
  config: Pick<AppConfig, "logLevel">,
  destination?: DestinationStream,
) {
  const options = {
    level: config.logLevel,
    redact: {
      paths: [
        "req.headers.authorization",
        "req.headers.cookie",
        "authorization",
        "cookie",
        "yuqueToken",
        "yuqueCookie",
      ],
      censor: "[REDACTED]",
    },
    base: { service: "yuque-image-mcp" },
  };

  return destination ? pino(options, destination) : pino(options);
}

export type AppLogger = ReturnType<typeof createLogger>;
