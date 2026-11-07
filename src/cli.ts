// telegram-notify-mcp setup | test | help

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { configPath, loadConfig, saveConfig, validChatId, validToken } from './config.js';
import { VERSION } from './server.js';
import { getMe, redact, sendText } from './telegram.js';

const HELP = `telegram-notify-mcp ${VERSION} — send-only Telegram notifications for MCP clients

Usage:
  telegram-notify-mcp            run the MCP server (stdio)
  telegram-notify-mcp setup      save the bot token and chat id to ${configPath()} (mode 600)
       [--files-dir <folder>]    also allow notify_file to send from this folder
  telegram-notify-mcp test       send a test message with the current configuration
  telegram-notify-mcp help

Environment (overrides the config file):
  TELEGRAM_BOT_TOKEN          bot token from @BotFather
  TELEGRAM_CHAT_ID            the one chat that receives every message
  TELEGRAM_NOTIFY_FILES_DIR   folder notify_file may send from (unset = file sending off)
`;

function ask(question: string, hidden = false): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  if (hidden) {
    const w = (rl as any)._writeToOutput?.bind(rl);
    (rl as any)._writeToOutput = (s: string) => (s.startsWith(question) ? w?.(s) : w?.(s.replace(/[^\r\n]/g, '*')));
  }
  return new Promise((r) => rl.question(question, (a) => (rl.close(), hidden && process.stdout.write('\n'), r(a.trim()))));
}

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
}

async function setup() {
  console.log('1. In Telegram, open @BotFather, create a bot (or use an existing one) and copy its token.');
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim() || (await ask('Bot token: ', true));
  if (!validToken(token)) throw new Error('That does not look like a bot token (digits:secret).');
  const me = await getMe({ token, chatId: '0' });
  console.log(`   ✓ bot @${me.username}`);
  console.log(`2. Open a chat with @${me.username} and press Start, so the bot may message you.`);
  console.log('   Your numeric chat id: message @userinfobot (or any "my id" bot) and copy the Id.');
  const chatId = process.env.TELEGRAM_CHAT_ID?.trim() || (await ask('Chat id: '));
  if (!validChatId(chatId)) throw new Error('A chat id is a number (negative for groups) or an @channel username.');
  const dir = flag('--files-dir');
  if (dir && !existsSync(dir)) throw new Error(`--files-dir: ${dir} does not exist`);
  const p = saveConfig({ token, chatId, filesDir: dir ? resolve(dir) : undefined });
  console.log(`   ✓ saved ${p} (mode 600)`);
  await sendText({ token, chatId }, `✅ telegram-notify is set up. Notifications from your MCP clients will arrive here.`);
  console.log('   ✓ test message sent — check Telegram.');
}

async function test() {
  const cfg = loadConfig();
  const me = await getMe(cfg);
  await sendText(cfg, `🔔 telegram-notify test from @${me.username} — ${new Date().toISOString()}`);
  console.log(`✓ sent a test message through @${me.username}${cfg.filesDir ? ` (file sending: ${cfg.filesDir})` : ' (file sending: off)'}`);
}

const cmd = process.argv[2];
try {
  if (cmd === 'setup') await setup();
  else if (cmd === 'test') await test();
  else if (cmd === 'help' || cmd === '--help' || cmd === '-h') console.log(HELP);
  else if (cmd === '--version' || cmd === '-v') console.log(VERSION);
  else {
    console.error(`Unknown command: ${cmd}\n\n${HELP}`);
    process.exit(2);
  }
} catch (e) {
  console.error(`✗ ${redact((e as Error).message)}`);
  process.exit(1);
}
