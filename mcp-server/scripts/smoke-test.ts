import { Client } from "@modelcontextprotocol/client";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/client";

const url = process.env.MCP_TEST_URL || "http://127.0.0.1:8787/mcp";
const headers: Record<string, string> = {};
if (process.env.MCP_BEARER_TOKEN) {
  headers.Authorization = `Bearer ${process.env.MCP_BEARER_TOKEN}`;
}

const client = new Client({
  name: "yuque-image-mcp-smoke-test",
  version: "1.0.0",
});
const transport = new StreamableHTTPClientTransport(new URL(url), {
  requestInit: { headers },
});

await client.connect(transport);
const result = await client.listTools();
console.log(`Connected to ${url}`);
console.log(`Tools (${result.tools.length}):`);
for (const tool of result.tools) {
  console.log(`- ${tool.name}: ${tool.description ?? ""}`);
}
await client.close();
