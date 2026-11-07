// Offline checks. fetch is mocked — nothing reaches Telegram. Covers: getUpdates is never
// called, the recipient cannot be overridden, the file sandbox, token redaction, splitting.

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const TOKEN = '123456789:AAFakeTokenForOfflineTestsOnly_abcdefghij';
const CHAT = '424242';
const work = mkdtempSync(join(tmpdir(), 'telegram-notify-test-'));
process.env.TELEGRAM_NOTIFY_HOME = join(work, 'home');

// --- mocked Telegram ---
type Call = { method: string; body: any };
const calls: Call[] = [];
let reply: (method: string) => any = () => ({ ok: true, result: { message_id: 1 } });
globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
  const u = String(url);
  const method = u.split('/').pop()!;
  assert.ok(u.startsWith(`https://api.telegram.org/bot${TOKEN}/`), 'only the Bot API is ever contacted');
  let body: any = init?.body;
  if (typeof body === 'string') body = JSON.parse(body);
  else if (body instanceof FormData) body = Object.fromEntries(body.entries());
  calls.push({ method, body });
  return new Response(JSON.stringify(reply(method)), { headers: { 'content-type': 'application/json' } });
}) as typeof fetch;

const { redact, splitText, markdownToHtml, escapeHtml, sendText, resolveAllowedFile } = await import('../src/telegram.js');
const { createServer } = await import('../src/server.js');
const { loadConfig, saveConfig, configPath } = await import('../src/config.js');

// --- redaction ---
assert.equal(redact(`GET https://api.telegram.org/bot${TOKEN}/sendMessage failed`, TOKEN), 'GET https://api.telegram.org/bot<redacted>/sendMessage failed');
assert.ok(!redact(`x ${TOKEN} y`).includes(TOKEN), 'redacts token-shaped strings even without the token');
assert.ok(!redact(`bot${TOKEN}`).includes('AAFake'));
console.log('✓ redaction');

// --- splitting ---
assert.deepEqual(splitText('hello'), ['hello']);
const long = Array.from({ length: 300 }, (_, i) => `line ${i} `.repeat(4)).join('\n');
const parts = splitText(long);
assert.ok(parts.length > 1 && parts.every((p) => p.length <= 4096));
assert.equal(parts.join('\n').replace(/\s+/g, ''), long.replace(/\s+/g, ''), 'nothing lost');
const noBreaks = 'א'.repeat(10_000);
assert.deepEqual(splitText(noBreaks).map((p) => p.length), [4096, 4096, 1808]);
const emoji = '😀'.repeat(3000); // surrogate pairs
for (const p of splitText(emoji)) assert.ok(p.length <= 4096 && !/^[\udc00-\udfff]|[\ud800-\udbff]$/.test(p));
console.log('✓ splitting');

// --- markdown / escaping ---
assert.equal(escapeHtml('<a & b>'), '&lt;a &amp; b&gt;');
assert.equal(markdownToHtml('**done** <script>'), '<b>done</b> &lt;script&gt;');
assert.equal(markdownToHtml('`a<b` and _it_'), '<code>a&lt;b</code> and <i>it</i>');
assert.equal(markdownToHtml('```ts\nif (a < b) {}\n```'), '<pre>if (a &lt; b) {}</pre>');
assert.equal(markdownToHtml('[x](https://e.com/?a=1&b="2")'), '<a href="https://e.com/?a=1&amp;b=&quot;2&quot;">x</a>');
assert.equal(markdownToHtml('[x](javascript:alert(1))'), '[x](javascript:alert(1))');
assert.equal(markdownToHtml('# Build\nsnake_case_name'), '<b>Build</b>\nsnake_case_name');
console.log('✓ markdown');

// --- config ---
assert.throws(() => { delete process.env.TELEGRAM_BOT_TOKEN; loadConfig(); }, /TELEGRAM_BOT_TOKEN is not set/);
const p = saveConfig({ token: TOKEN, chatId: CHAT });
assert.equal(p, configPath());
assert.equal(statSync(p).mode & 0o777, 0o600);
assert.deepEqual(loadConfig(), { token: TOKEN, chatId: CHAT, filesDir: undefined });
process.env.TELEGRAM_CHAT_ID = 'not a chat';
assert.throws(() => loadConfig(), /TELEGRAM_CHAT_ID must be/);
delete process.env.TELEGRAM_CHAT_ID;
console.log('✓ config (file mode 600)');

// --- file sandbox ---
const allowed = join(work, 'outbox');
mkdirSync(join(allowed, 'sub'), { recursive: true });
writeFileSync(join(allowed, 'report.txt'), 'ok');
writeFileSync(join(allowed, 'sub', 'deep.txt'), 'ok');
writeFileSync(join(work, 'secret.txt'), 'secret');
symlinkSync(join(work, 'secret.txt'), join(allowed, 'link-out.txt'));
symlinkSync(work, join(allowed, 'dir-out'));
symlinkSync(join(allowed, 'report.txt'), join(allowed, 'link-in.txt'));
await assert.rejects(resolveAllowedFile(undefined, join(allowed, 'report.txt')), /File sending is off/);
assert.match(await resolveAllowedFile(allowed, 'report.txt'), /outbox\/report\.txt$/);
assert.match(await resolveAllowedFile(allowed, join(allowed, 'sub/deep.txt')), /deep\.txt$/);
assert.match(await resolveAllowedFile(allowed, 'link-in.txt'), /report\.txt$/, 'a link that stays inside is fine');
for (const bad of ['../secret.txt', 'sub/../../secret.txt', join(work, 'secret.txt'), '/etc/passwd', 'link-out.txt', 'dir-out/secret.txt', '.', 'sub']) {
  await assert.rejects(resolveAllowedFile(allowed, bad), /outside the allowed folder|Not a regular file/, bad);
}
await assert.rejects(resolveAllowedFile(allowed, 'missing.txt'), /No such file/);
console.log('✓ file sandbox (.., absolute, symlinks)');

// --- MCP surface (in memory, mocked fetch) ---
async function connect(filesDir?: string) {
  const [a, b] = InMemoryTransport.createLinkedPair();
  await createServer({ token: TOKEN, chatId: CHAT, filesDir }).connect(a);
  const c = new Client({ name: 'test', version: '0' });
  await c.connect(b);
  return c;
}
const mcp = await connect(allowed);
const tools = (await mcp.listTools()).tools;
assert.deepEqual(tools.map((t) => t.name).sort(), ['notify', 'notify_file']);
for (const t of tools) {
  const props = Object.keys((t.inputSchema as any).properties ?? {});
  assert.ok(!props.some((k) => /chat|recipient|to$|user/i.test(k)), `${t.name} exposes no recipient: ${props}`);
}

calls.length = 0;
const r1 = await mcp.callTool({ name: 'notify', arguments: { text: 'hi', chat_id: '666', silent: true } });
assert.ok(!r1.isError, JSON.stringify(r1));
assert.equal(calls.length, 1);
assert.equal(calls[0].method, 'sendMessage');
assert.equal(calls[0].body.chat_id, CHAT, 'a smuggled chat_id is ignored');
assert.equal(calls[0].body.disable_notification, true);
assert.equal(calls[0].body.parse_mode, undefined, 'plain text by default');

calls.length = 0;
await mcp.callTool({ name: 'notify', arguments: { text: long } });
assert.equal(calls.length, parts.length);
assert.ok(calls.every((c) => c.body.chat_id === CHAT && c.body.text.length <= 4096));

calls.length = 0;
await mcp.callTool({ name: 'notify', arguments: { text: '**ok** <b>', format: 'markdown' } });
assert.deepEqual([calls[0].body.parse_mode, calls[0].body.text], ['HTML', '<b>ok</b> &lt;b&gt;']);

// HTML rejected by Telegram → resent as plain text
calls.length = 0;
reply = (m) => (calls.length === 1 ? { ok: false, error_code: 400, description: "Bad Request: can't parse entities" } : { ok: true, result: {} });
const r2 = await mcp.callTool({ name: 'notify', arguments: { text: '*x*', format: 'markdown' } });
assert.ok(!r2.isError);
assert.deepEqual(calls.map((c) => c.body.parse_mode), ['HTML', undefined]);

// Telegram errors come back redacted
reply = () => ({ ok: false, error_code: 401, description: `Unauthorized for bot${TOKEN}` });
const r3 = await mcp.callTool({ name: 'notify', arguments: { text: 'x' } });
assert.equal(r3.isError, true);
const errText = (r3.content as any)[0].text as string;
assert.ok(!errText.includes(TOKEN) && !errText.includes('AAFake'), errText);
assert.match(errText, /401.*token is wrong/);
// a network failure whose message carries the URL is redacted too
const realFetch = globalThis.fetch;
globalThis.fetch = (async (u: string) => { throw new TypeError(`fetch failed for ${u}`); }) as any;
const r4 = await mcp.callTool({ name: 'notify', arguments: { text: 'x' } });
assert.ok(r4.isError && !(r4.content as any)[0].text.includes(TOKEN));
globalThis.fetch = realFetch;
reply = () => ({ ok: true, result: {} });

calls.length = 0;
const f1 = await mcp.callTool({ name: 'notify_file', arguments: { path: 'report.txt', caption: 'weekly', chat_id: '666' } });
assert.ok(!f1.isError, JSON.stringify(f1));
assert.equal(calls[0].method, 'sendDocument');
assert.equal(calls[0].body.chat_id, CHAT);
assert.equal(calls[0].body.caption, 'weekly');
const f2 = await mcp.callTool({ name: 'notify_file', arguments: { path: '../secret.txt' } });
assert.equal(f2.isError, true);
const f3 = await mcp.callTool({ name: 'notify_file', arguments: { path: 'link-out.txt' } });
assert.equal(f3.isError, true);
assert.equal(calls.length, 1, 'refused files never reach Telegram');

const noFiles = await connect(undefined);
const f4 = await noFiles.callTool({ name: 'notify_file', arguments: { path: join(allowed, 'report.txt') } });
assert.equal(f4.isError, true);
assert.match((f4.content as any)[0].text, /File sending is off/);
console.log('✓ MCP tools (2 tools, fixed recipient, sandboxed files, redacted errors)');

// --- getUpdates is never called, and not even present in code ---
assert.ok(calls.length > 0 && calls.every((c) => c.method !== 'getUpdates'));
for (const f of readdirSync('src')) {
  const code = readFileSync(join('src', f), 'utf8').replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(!/getUpdates|setWebhook|deleteWebhook/.test(code), `src/${f} must not touch updates`);
}
console.log('✓ never calls getUpdates');

// --- the messages the CLI itself sends carry no emoji ---
const cliSends = readFileSync('src/cli.ts', 'utf8').split('\n').filter((l) => l.includes('sendText('));
assert.ok(cliSends.length >= 2);
for (const l of cliSends) assert.ok(!/\p{Extended_Pictographic}/u.test(l), l);
console.log('✓ no emoji in messages the CLI sends');

// --- stdio: refuses to start without config, never prints the token ---
const env = { ...process.env, TELEGRAM_NOTIFY_HOME: join(work, 'empty') } as Record<string, string>;
delete env.TELEGRAM_BOT_TOKEN;
const bad = spawnSync('npx', ['tsx', 'src/main.ts'], { env, encoding: 'utf8', input: '' });
assert.notEqual(bad.status, 0);
assert.match(bad.stderr, /TELEGRAM_BOT_TOKEN is not set/);
const stdio = new Client({ name: 'test', version: '0' });
await stdio.connect(new StdioClientTransport({ command: 'npx', args: ['tsx', 'src/main.ts'], env: { ...env, TELEGRAM_BOT_TOKEN: TOKEN, TELEGRAM_CHAT_ID: CHAT }, stderr: 'pipe' }));
assert.deepEqual((await stdio.listTools()).tools.map((t) => t.name).sort(), ['notify', 'notify_file']);
await stdio.close();
console.log('✓ stdio server');

console.log('\nall offline tests passed');
