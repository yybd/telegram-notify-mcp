// Configuration: environment variables first, then ~/.telegram-notify/config.json
// (written by `telegram-notify-mcp setup`, mode 600). The recipient is fixed here and
// nowhere else — no tool takes a chat id.

import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export interface Config {
  token: string;
  chatId: string;
  /** Real path of the only folder notify_file may send from; undefined = file sending off. */
  filesDir?: string;
}

export function configHome(): string {
  return process.env.TELEGRAM_NOTIFY_HOME || join(homedir(), '.telegram-notify');
}

export function configPath(): string {
  return join(configHome(), 'config.json');
}

const TOKEN_RE = /^\d{5,}:[A-Za-z0-9_-]{30,}$/;
const CHAT_RE = /^(-?\d{1,20}|@[A-Za-z][A-Za-z0-9_]{3,})$/;

export function validToken(t: string): boolean {
  return TOKEN_RE.test(t);
}

export function validChatId(c: string): boolean {
  return CHAT_RE.test(c);
}

function readFileConfig(): Partial<Config> {
  const p = configPath();
  if (!existsSync(p)) return {};
  try {
    const j = JSON.parse(readFileSync(p, 'utf8'));
    return { token: j.token, chatId: j.chatId === undefined ? undefined : String(j.chatId), filesDir: j.filesDir };
  } catch {
    throw new Error(`${p} is not valid JSON. Run \`telegram-notify-mcp setup\` again.`);
  }
}

/** An env var, ignoring empty values and placeholders a host left unfilled (Claude Desktop's ${user_config.x}). */
function env(name: string): string | undefined {
  const v = process.env[name]?.trim();
  return v && !/^\$\{.*\}$/.test(v) ? v : undefined;
}

export function loadConfig(): Config {
  const file = readFileConfig();
  const token = (env('TELEGRAM_BOT_TOKEN') || file.token || '').trim();
  const chatId = (env('TELEGRAM_CHAT_ID') || file.chatId || '').trim();
  const filesDir = (env('TELEGRAM_NOTIFY_FILES_DIR') || file.filesDir || '').trim() || undefined;
  if (!token) throw new Error('TELEGRAM_BOT_TOKEN is not set. Set it, or run `telegram-notify-mcp setup`.');
  if (!validToken(token)) throw new Error('TELEGRAM_BOT_TOKEN does not look like a bot token (digits:secret).');
  if (!chatId) throw new Error('TELEGRAM_CHAT_ID is not set. Set it, or run `telegram-notify-mcp setup`.');
  if (!validChatId(chatId)) throw new Error('TELEGRAM_CHAT_ID must be a numeric chat id or an @channel username.');
  return { token, chatId, filesDir };
}

export function saveConfig(c: { token: string; chatId: string; filesDir?: string }): string {
  const dir = configHome();
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const p = configPath();
  const body: Record<string, string> = { token: c.token, chatId: c.chatId };
  if (c.filesDir) body.filesDir = c.filesDir;
  writeFileSync(p, JSON.stringify(body, null, 2) + '\n', { mode: 0o600 });
  chmodSync(p, 0o600); // writeFileSync keeps an existing file's mode
  return p;
}
