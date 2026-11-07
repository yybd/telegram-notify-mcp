#!/usr/bin/env node
// The one command the npm package installs:
//   telegram-notify-mcp            stdio MCP server (what Claude Desktop / Claude Code run)
//   telegram-notify-mcp setup|test|help   configuration (see cli.ts)

const cmd = process.argv[2];

if (!cmd || cmd === 'serve' || cmd === 'stdio') {
  await import('./stdio.js');
} else {
  await import('./cli.js');
}
