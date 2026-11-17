// M11.3 read-only pilot worker. One process handles many concurrent provider
// calls so SSH/Node startup is not mistaken for model latency.
const fs = require('node:fs');
const {
  OpenAiChatProvider,
} = require('/opt/langoo/app/dist/ai/providers/openai-chat.provider.js');
const cfg = require('/opt/langoo/app/node_modules/dotenv').parse(
  fs.readFileSync('/opt/langoo/app/.env'),
);
const apiKey = cfg.AI_QUIZ_API_KEY || cfg.AI_API_KEY;
const baseUrl =
  cfg.AI_QUIZ_BASE_URL || cfg.AI_BASE_URL || 'https://api.openai.com/v1';
if (!apiKey) {
  console.log(JSON.stringify({ kind: 'fatal', name: 'ProviderNotConfigured' }));
  process.exit(1);
}
const transport = new OpenAiChatProvider({ apiKey, baseUrl });
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  input += chunk;
  let newline = input.indexOf('\n');
  while (newline >= 0) {
    const line = input.slice(0, newline).trim();
    input = input.slice(newline + 1);
    if (line) void handle(line);
    newline = input.indexOf('\n');
  }
});
process.stdin.on('end', () => {
  // All handlers were started; keep the process alive until they finish.
  void Promise.allSettled(inFlight).then(() => process.exit(0));
});
const inFlight = [];
async function handle(line) {
  let request;
  try {
    request = JSON.parse(line);
  } catch {
    return;
  }
  const task = (async () => {
    const started = Date.now();
    try {
      const result = await transport.chat(request.chat);
      console.log(
        JSON.stringify({
          id: request.id,
          kind: 'reply',
          ok: true,
          elapsedMs: Date.now() - started,
          result,
        }),
      );
    } catch (error) {
      console.log(
        JSON.stringify({
          id: request.id,
          kind: 'reply',
          ok: false,
          elapsedMs: Date.now() - started,
          name: error.name || 'Error',
          status: error.status || null,
          code: typeof error.code === 'string' ? error.code : undefined,
        }),
      );
    }
  })();
  inFlight.push(task);
  await task;
}
