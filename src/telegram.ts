// Send-only Telegram Bot API client on plain fetch.
// Deliberately implements sendMessage, sendDocument and getMe — and never getUpdates:
// pulling updates would fight any other process polling the same bot (409 Conflict).

import { readFile, realpath, stat } from 'node:fs/promises';
import { basename, isAbsolute, relative, resolve, sep } from 'node:path';
import type { Config } from './config.js';

export const MAX_TEXT = 4096;
export const MAX_CAPTION = 1024;
export const MAX_FILE_BYTES = 50 * 1024 * 1024; // Bot API upload limit
const API = 'https://api.telegram.org';
const TIMEOUT_MS = 30_000;

/** Removes the bot token (and anything shaped like one) from a string. */
export function redact(s: string, token?: string): string {
  let out = s;
  if (token) out = out.split(token).join('<redacted>');
  out = out.replace(/bot\d{5,}:[A-Za-z0-9_-]{20,}/g, 'bot<redacted>');
  out = out.replace(/\b\d{5,}:[A-Za-z0-9_-]{30,}\b/g, '<redacted>');
  return out;
}

export class TelegramError extends Error {}

interface ApiResult {
  ok: boolean;
  result?: any;
  description?: string;
  error_code?: number;
  parameters?: { retry_after?: number };
}

async function call(cfg: Config, method: string, body: FormData | Record<string, unknown>): Promise<any> {
  const url = `${API}/bot${cfg.token}/${method}`;
  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try {
      const init: RequestInit =
        body instanceof FormData
          ? { method: 'POST', body, signal: AbortSignal.timeout(TIMEOUT_MS) }
          : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(TIMEOUT_MS) };
      res = await fetch(url, init);
    } catch (e) {
      const cause = (e as any)?.cause?.message ? ` (${(e as any).cause.message})` : '';
      throw new TelegramError(redact(`Could not reach Telegram: ${(e as Error).message}${cause}`, cfg.token));
    }
    let data: ApiResult;
    try {
      data = (await res.json()) as ApiResult;
    } catch {
      throw new TelegramError(`Telegram returned HTTP ${res.status} with no JSON body`);
    }
    if (data.ok) return data.result;
    const wait = data.parameters?.retry_after;
    if (data.error_code === 429 && wait && wait <= 30 && attempt === 0) {
      await new Promise((r) => setTimeout(r, wait * 1000));
      continue;
    }
    const hint = data.error_code === 401 ? ' — the bot token is wrong or revoked' : data.error_code === 400 && /chat not found/i.test(data.description || '') ? ' — check TELEGRAM_CHAT_ID, and that you have pressed Start in the bot chat' : data.error_code === 403 ? ' — the bot cannot message this chat (blocked, or never started)' : '';
    throw new TelegramError(redact(`Telegram ${method} failed: ${data.error_code ?? res.status} ${data.description ?? ''}${hint}`.trim(), cfg.token));
  }
}

export async function getMe(cfg: Config): Promise<{ username: string; id: number }> {
  return call(cfg, 'getMe', {});
}

// ---------- text ----------

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Small Markdown subset → Telegram HTML. Everything not recognised is escaped, never passed through. */
export function markdownToHtml(md: string): string {
  const slots: string[] = [];
  const keep = (html: string) => `\u0000${slots.push(html) - 1}\u0000`;
  let s = md.replace(/\u0000/g, '');
  s = s.replace(/```[^\n`]*\n?([\s\S]*?)```/g, (_, code) => keep(`<pre>${escapeHtml(code.replace(/\n$/, ''))}</pre>`));
  s = s.replace(/`([^`\n]+)`/g, (_, code) => keep(`<code>${escapeHtml(code)}</code>`));
  s = s.replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, (_, text, url) =>
    keep(`<a href="${escapeHtml(url).replace(/"/g, '&quot;')}">${escapeHtml(text)}</a>`)
  );
  s = escapeHtml(s);
  s = s.replace(/^#{1,6}[ \t]+(.+)$/gm, '<b>$1</b>');
  s = s.replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>');
  s = s.replace(/__([^_\n]+)__/g, '<b>$1</b>');
  s = s.replace(/~~([^~\n]+)~~/g, '<s>$1</s>');
  s = s.replace(/(^|[^\w*])\*([^*\n]+)\*(?!\w)/g, '$1<i>$2</i>');
  s = s.replace(/(^|[^\w_])_([^_\n]+)_(?!\w)/g, '$1<i>$2</i>');
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => slots[Number(i)]);
}

/** Splits text into chunks of at most `max` characters, preferring paragraph, line, then word breaks. */
export function splitText(text: string, max = MAX_TEXT): string[] {
  const out: string[] = [];
  let rest = text;
  while (rest.length > max) {
    const window = rest.slice(0, max);
    let cut = window.lastIndexOf('\n\n');
    if (cut < max / 2) cut = window.lastIndexOf('\n');
    if (cut < max / 2) cut = window.lastIndexOf(' ');
    if (cut < max / 2) cut = max;
    // never split a surrogate pair
    const code = rest.charCodeAt(cut - 1);
    if (code >= 0xd800 && code <= 0xdbff) cut -= 1;
    out.push(rest.slice(0, cut).trimEnd());
    rest = rest.slice(cut).replace(/^\s+/, '');
  }
  if (rest.length || out.length === 0) out.push(rest);
  return out.filter((c, i) => c.length > 0 || i === 0);
}

export interface NotifyOptions {
  silent?: boolean;
  format?: 'plain' | 'markdown';
}

/** Sends text to the configured chat. Returns the number of messages sent. */
export async function sendText(cfg: Config, text: string, opts: NotifyOptions = {}): Promise<number> {
  if (!text.trim()) throw new TelegramError('Nothing to send: text is empty');
  const base = { chat_id: cfg.chatId, disable_notification: Boolean(opts.silent), link_preview_options: { is_disabled: true } };
  // Markdown is split on the source text with headroom for tags, then converted per chunk.
  const chunks = splitText(text, opts.format === 'markdown' ? 3500 : MAX_TEXT);
  for (const chunk of chunks) {
    if (opts.format === 'markdown') {
      const html = markdownToHtml(chunk);
      if (html.length <= MAX_TEXT) {
        try {
          await call(cfg, 'sendMessage', { ...base, text: html, parse_mode: 'HTML' });
          continue;
        } catch (e) {
          if (!/can't parse entities/i.test((e as Error).message)) throw e;
          // fall through: send the chunk as plain text
        }
      }
    }
    await call(cfg, 'sendMessage', { ...base, text: chunk });
  }
  return chunks.length;
}

// ---------- files ----------

/**
 * Resolves `p` to a real file inside `filesDir`. Relative paths are taken from filesDir.
 * Symlinks are resolved first, so a link pointing outside the folder is refused.
 */
export async function resolveAllowedFile(filesDir: string | undefined, p: string): Promise<string> {
  if (!filesDir) throw new TelegramError('File sending is off: TELEGRAM_NOTIFY_FILES_DIR is not set');
  let root: string;
  try {
    root = await realpath(filesDir);
  } catch {
    throw new TelegramError('TELEGRAM_NOTIFY_FILES_DIR does not exist');
  }
  const inside = (base: string, target: string) => {
    const rel = relative(base, target);
    return rel !== '' && rel !== '..' && !rel.startsWith('..' + sep) && !isAbsolute(rel);
  };
  // Lexical check first, so paths outside the folder are refused without touching them.
  const asGiven = resolve(root, p);
  if (!inside(root, asGiven) && !inside(resolve(filesDir), resolve(filesDir, p))) {
    throw new TelegramError(`Refused: ${p} is outside the allowed folder`);
  }
  let real: string;
  try {
    real = await realpath(asGiven);
  } catch {
    throw new TelegramError(`No such file: ${p}`);
  }
  if (!inside(root, real)) {
    throw new TelegramError(`Refused: ${p} is outside the allowed folder`);
  }
  const st = await stat(real);
  if (!st.isFile()) throw new TelegramError(`Not a regular file: ${p}`);
  if (st.size > MAX_FILE_BYTES) throw new TelegramError(`File is larger than Telegram's 50 MB bot limit: ${p}`);
  return real;
}

export async function sendFile(cfg: Config, p: string, caption?: string, opts: { silent?: boolean } = {}): Promise<string> {
  const real = await resolveAllowedFile(cfg.filesDir, p);
  const form = new FormData();
  form.set('chat_id', cfg.chatId);
  if (opts.silent) form.set('disable_notification', 'true');
  let extra: string | undefined;
  if (caption) {
    if (caption.length > MAX_CAPTION) {
      extra = caption;
    } else {
      form.set('caption', caption);
    }
  }
  form.set('document', new Blob([await readFile(real)]), basename(real));
  await call(cfg, 'sendDocument', form);
  if (extra) await sendText(cfg, extra, { silent: true });
  return basename(real);
}
