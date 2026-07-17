import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { loadConfig } from "./config/env.js";
import { createLogger } from "./config/logger.js";
import { createYuqueMcpServer } from "./mcp/server.js";

const config = loadConfig();
const logger = createLogger(config, process.stderr);
const server = createYuqueMcpServer(config, logger);
const transport = new StdioServerTransport();

await server.connect(transport);
logger.info("Yuque Image MCP stdio server started");

process.on("SIGINT", async () => {
  await server.close();
  process.exit(0);
});
