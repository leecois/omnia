// Env var loader and validator for the Omnia AI bot.
//
// All values come from process.env, which Bun populates from any .env.local,
// .env, or --env-file flag the runtime sees. Fail fast on missing required
// values instead of crashing mid-request with an opaque error.

export type Provider = 'openai' | 'gemini';

export interface BotConfig {
  // SpacetimeDB connection
  spacetimeHost: string;
  spacetimeDbName: string;
  botToken: string | null;
  botTokenPath: string;

  // Qdrant vector store
  qdrantUrl: string;
  qdrantApiKey: string;
  qdrantCollection: string;
  qdrantVectorSize: number;

  // LLM provider selection
  provider: Provider;

  // OpenAI
  openaiApiKey: string | null;
  openaiEmbeddingModel: string;
  openaiChatModel: string;

  // Gemini
  geminiApiKey: string | null;
  geminiEmbeddingModel: string;
  geminiChatModel: string;

  // Behaviour knobs
  topK: number;
  maxContextChars: number;
  ingestBackoffMs: number;
}

function req(name: string): string {
  const v = process.env[name];
  if (!v || v.trim() === '') {
    throw new Error(
      `Missing required environment variable: ${name}. Check your .env.local or environment.`
    );
  }
  return v.trim();
}

function opt(name: string, fallback = ''): string {
  return (process.env[name] ?? fallback).trim();
}

function optNum(name: string, fallback: number): number {
  const v = process.env[name];
  if (v === undefined || v === '') return fallback;
  const n = Number(v);
  if (Number.isNaN(n)) {
    throw new Error(`Environment variable ${name} must be a number, got: ${v}`);
  }
  return n;
}

export function loadConfig(): BotConfig {
  const provider = opt('AI_PROVIDER', 'openai').toLowerCase() as Provider;
  if (provider !== 'openai' && provider !== 'gemini') {
    throw new Error(`AI_PROVIDER must be 'openai' or 'gemini', got: ${provider}`);
  }

  // Both providers are pinned to 1536-dim vectors so the Qdrant collection
  // is provider-agnostic — you can flip AI_PROVIDER without rebuilding the
  // index. OpenAI's text-embedding-3-small is natively 1536. Gemini's
  // gemini-embedding-001 is 3072 natively but supports outputDimensionality.
  const defaultVectorSize = 1536;

  const cfg: BotConfig = {
    spacetimeHost: req('VITE_SPACETIMEDB_HOST'),
    spacetimeDbName: req('VITE_SPACETIMEDB_DB_NAME'),
    botToken: opt('OMNIA_BOT_TOKEN') || null,
    botTokenPath: opt('OMNIA_BOT_TOKEN_PATH', './.bot-token'),

    qdrantUrl: req('QDRANT_URL'),
    qdrantApiKey: req('QDRANT_API_KEY'),
    qdrantCollection: opt('QDRANT_COLLECTION', 'omnia_messages'),
    qdrantVectorSize: optNum('QDRANT_VECTOR_SIZE', defaultVectorSize),

    provider,

    openaiApiKey: provider === 'openai' ? req('OPENAI_API_KEY') : opt('OPENAI_API_KEY') || null,
    openaiEmbeddingModel: opt('OPENAI_EMBEDDING_MODEL', 'text-embedding-3-small'),
    openaiChatModel: opt('OPENAI_CHAT_MODEL', 'gpt-4o-mini'),

    geminiApiKey:
      provider === 'gemini'
        ? req('GOOGLE_GENERATIVE_AI_API_KEY')
        : opt('GOOGLE_GENERATIVE_AI_API_KEY') || null,
    geminiEmbeddingModel: opt('GEMINI_EMBEDDING_MODEL', 'gemini-embedding-001'),
    geminiChatModel: opt('GEMINI_CHAT_MODEL', 'gemini-2.5-flash'),

    topK: optNum('AI_TOP_K', 8),
    maxContextChars: optNum('AI_MAX_CONTEXT_CHARS', 6000),
    ingestBackoffMs: optNum('AI_INGEST_BACKOFF_MS', 250),
  };

  return cfg;
}
