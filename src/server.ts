// The MCP surface: two tools, neither of which takes a recipient.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { Config } from './config.js';
import { redact, sendFile, sendText } from './telegram.js';

export const VERSION = '0.1.2';

const INSTRUCTIONS = `Sends Telegram notifications to the owner of this server — one fixed chat, set in its configuration.
- notify: a short message when something finishes, fails, or needs the user's attention. Plain text by default; format="markdown" for **bold**, _italic_, \`code\`, links. silent=true delivers without a sound.
- Write plain words: no emoji or icons in the text or captions.
- notify_file: sends a file, only from the folder the owner allowed.
- This is one-way: replies in Telegram never come back here. Do not ask the user a question through it and wait for an answer.`;

function fail(cfg: Config, e: unknown) {
  return { isError: true, content: [{ type: 'text' as const, text: redact((e as Error)?.message ?? String(e), cfg.token) }] };
}

export function createServer(cfg: Config): McpServer {
  const server = new McpServer({ name: 'telegram-notify', version: VERSION }, { instructions: INSTRUCTIONS });

  server.registerTool(
    'notify',
    {
      title: 'Send a Telegram notification',
      description:
        "Sends a message to the owner's Telegram (a fixed chat; you cannot choose the recipient). Messages over 4096 characters are split. Do not use emoji or icons.",
      inputSchema: {
        text: z.string().min(1).max(40_000).describe('The message'),
        silent: z.boolean().optional().describe('Deliver without a notification sound'),
        format: z.enum(['plain', 'markdown']).optional().describe('plain (default) or markdown: **bold**, _italic_, `code`, ```blocks```, [links](https://…), # headings'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ text, silent, format }) => {
      try {
        const n = await sendText(cfg, text, { silent, format });
        return { content: [{ type: 'text', text: n === 1 ? 'Sent.' : `Sent as ${n} messages.` }] };
      } catch (e) {
        return fail(cfg, e);
      }
    }
  );

  server.registerTool(
    'notify_file',
    {
      title: 'Send a file over Telegram',
      description: cfg.filesDir
        ? "Sends a file to the owner's Telegram. Only files inside the allowed folder can be sent; a relative path is taken from that folder. Up to 50 MB."
        : 'File sending is turned off on this server (TELEGRAM_NOTIFY_FILES_DIR is not set); every call is refused.',
      inputSchema: {
        path: z.string().min(1).describe('File path, inside the allowed folder'),
        caption: z.string().max(4096).optional().describe('Caption; over 1024 characters it is sent as a separate message'),
        silent: z.boolean().optional().describe('Deliver without a notification sound'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ path, caption, silent }) => {
      try {
        const name = await sendFile(cfg, path, caption, { silent });
        return { content: [{ type: 'text', text: `Sent ${name}.` }] };
      } catch (e) {
        return fail(cfg, e);
      }
    }
  );

  return server;
}
