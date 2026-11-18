// Read-only pilot transport. Credentials remain on the VPS; only synthetic
// prompts, model outputs and usage cross SSH. Never writes ENV/app/DB files.
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const root = '/opt/langoo/app';
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  input += chunk;
});
process.stdin.on('end', async () => {
  try {
    const cfg = require(`${root}/node_modules/dotenv`).parse(
      fs.readFileSync(`${root}/.env`),
    );
    const request = JSON.parse(input);
    const apiKey = cfg.AI_QUIZ_API_KEY || cfg.AI_API_KEY;
    const baseUrl =
      cfg.AI_QUIZ_BASE_URL || cfg.AI_BASE_URL || 'https://api.openai.com/v1';
    if (request.kind === 'metadata') {
      let sha = null;
      try {
        sha = execFileSync(
          'git',
          ['-c', 'safe.directory=*', '-C', root, 'rev-parse', 'HEAD'],
          { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
        ).trim();
      } catch {
        // Root may not see the repository as safe; read the ref directly.
        try {
          const head = fs.readFileSync(`${root}/.git/HEAD`, 'utf8').trim();
          if (head.startsWith('ref: ')) {
            const ref = head.slice(5);
            sha = fs.readFileSync(`${root}/.git/${ref}`, 'utf8').trim();
          } else sha = head;
        } catch {}
      }
      console.log(
        JSON.stringify({
          ok: true,
          configured: !!apiKey,
          provider: cfg.AI_PROVIDER,
          generatorModel: cfg.AI_QUIZ_MODEL,
          validatorModel: cfg.AI_QUIZ_VALIDATOR_MODEL,
          reasoningEffort: cfg.AI_QUIZ_REASONING_EFFORT || undefined,
          providerOrigin: new URL(baseUrl).origin,
          serverCommit: sha,
        }),
      );
      return;
    }
    if (!apiKey) throw new Error('ProviderNotConfigured');
    if (request.kind === 'models') {
      const response = await fetch(`${baseUrl.replace(/\/+$/, '')}/models`, {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) {
        console.log(JSON.stringify({ ok: false, status: response.status }));
        return;
      }
      const body = await response.json();
      console.log(
        JSON.stringify({
          ok: true,
          models: (body.data || []).map((model) => model.id),
        }),
      );
      return;
    }
    const nativeFetch = global.fetch;
    let finishReason = null,
      reasoningTokens = null;
    global.fetch = async (...args) => {
      const response = await nativeFetch(...args);
      try {
        const body = await response.clone().json();
        finishReason = body.choices?.[0]?.finish_reason ?? null;
        reasoningTokens =
          body.usage?.completion_tokens_details?.reasoning_tokens ?? null;
      } catch {}
      return response;
    };
    const { OpenAiChatProvider } = require(
      `${root}/dist/ai/providers/openai-chat.provider.js`,
    );
    const transport = new OpenAiChatProvider({ apiKey, baseUrl });
    const started = Date.now();
    const result = await transport.chat(request.chat);
    console.log(
      JSON.stringify({
        ok: true,
        elapsedMs: Date.now() - started,
        finishReason,
        reasoningTokens,
        result,
      }),
    );
  } catch (error) {
    // Do not echo provider bodies, ENV, request headers or stack traces.
    console.log(
      JSON.stringify({
        ok: false,
        name: error.name || 'Error',
        code: typeof error.code === 'string' ? error.code : undefined,
        status: error.status || null,
      }),
    );
    process.exitCode = 1;
  }
});
