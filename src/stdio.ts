import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { loadConfig, type Config } from './config.js';
import { createServer } from './server.js';
import { redact } from './telegram.js';

let cfg: Config;
try {
  cfg = loadConfig();
} catch (e) {
  // stderr only — stdout belongs to the MCP protocol
  console.error(`telegram-notify: ${redact((e as Error).message)}`);
  process.exit(1);
}
await createServer(cfg).connect(new StdioServerTransport());
