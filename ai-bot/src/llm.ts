// Provider-agnostic wrapper around OpenAI and Google Gemini.
//
// Both providers expose two primitives we need:
//   1. embed(text) -> number[]   (vectorize a message or question)
//   2. chat(system, user) -> { text, inputTokens, outputTokens }
//
// Swapping providers is a one-line change in .env.local (AI_PROVIDER=gemini).

import OpenAI from 'openai';
import { GoogleGenAI } from '@google/genai';
import type { BotConfig } from './config.ts';

export interface ChatResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
  costMicros: bigint;
}

export interface LLMAdapter {
  embed(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<number[][]>;
  chat(system: string, user: string): Promise<ChatResult>;
}

// ── Cost estimates (USD per 1M tokens) ─────────────────────────────────────
// These are deliberate over-estimates to avoid surprises. Update when pricing
// changes. Values here as of 2026-04; adjust via code change, not env.
const COST_PER_1M_TOKENS = {
  'text-embedding-3-small': { in: 0.02, out: 0 },
  'text-embedding-3-large': { in: 0.13, out: 0 },
  'text-embedding-004':     { in: 0,    out: 0 }, // Gemini embeddings are free
  'gpt-4o-mini':            { in: 0.15, out: 0.60 },
  'gpt-4o':                 { in: 2.50, out: 10.0 },
  'gemini-2.5-flash':       { in: 0.075, out: 0.30 },
  'gemini-2.5-pro':         { in: 1.25, out: 5.00 },
} as const;

function costMicros(model: string, inTok: number, outTok: number): bigint {
  const rates = (COST_PER_1M_TOKENS as Record<string, { in: number; out: number }>)[model];
  if (!rates) return 0n;
  const usd = (rates.in * inTok + rates.out * outTok) / 1_000_000;
  return BigInt(Math.round(usd * 1_000_000));
}

// ── OpenAI implementation ──────────────────────────────────────────────────

class OpenAIAdapter implements LLMAdapter {
  private client: OpenAI;
  constructor(private cfg: BotConfig) {
    if (!cfg.openaiApiKey) throw new Error('OpenAI adapter requires OPENAI_API_KEY');
    this.client = new OpenAI({ apiKey: cfg.openaiApiKey });
  }

  async embed(text: string): Promise<number[]> {
    const res = await this.client.embeddings.create({
      model: this.cfg.openaiEmbeddingModel,
      input: text,
    });
    return res.data[0]!.embedding;
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    const res = await this.client.embeddings.create({
      model: this.cfg.openaiEmbeddingModel,
      input: texts,
    });
    return res.data.map(d => d.embedding);
  }

  async chat(system: string, user: string): Promise<ChatResult> {
    const res = await this.client.chat.completions.create({
      model: this.cfg.openaiChatModel,
      messages: [
        { role: 'system', content: system },
        { role: 'user',   content: user },
      ],
      temperature: 0.3,
    });
    const text = res.choices[0]?.message?.content ?? '';
    const inputTokens = res.usage?.prompt_tokens ?? 0;
    const outputTokens = res.usage?.completion_tokens ?? 0;
    return {
      text,
      inputTokens,
      outputTokens,
      costMicros: costMicros(this.cfg.openaiChatModel, inputTokens, outputTokens),
    };
  }
}

// ── Gemini implementation ──────────────────────────────────────────────────

class GeminiAdapter implements LLMAdapter {
  private client: GoogleGenAI;
  constructor(private cfg: BotConfig) {
    if (!cfg.geminiApiKey) throw new Error('Gemini adapter requires GOOGLE_GENERATIVE_AI_API_KEY');
    this.client = new GoogleGenAI({ apiKey: cfg.geminiApiKey });
  }

  async embed(text: string): Promise<number[]> {
    const res = await this.client.models.embedContent({
      model: this.cfg.geminiEmbeddingModel,
      contents: text,
      config: { outputDimensionality: this.cfg.qdrantVectorSize },
    });
    const values = res.embeddings?.[0]?.values;
    if (!values) throw new Error('Gemini returned no embedding values');
    return values;
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    // Gemini's embedContent accepts an array of contents.
    if (texts.length === 0) return [];
    const res = await this.client.models.embedContent({
      model: this.cfg.geminiEmbeddingModel,
      contents: texts,
      config: { outputDimensionality: this.cfg.qdrantVectorSize },
    });
    const out = (res.embeddings ?? []).map(e => e.values ?? []);
    if (out.length !== texts.length) {
      throw new Error(`Gemini returned ${out.length} embeddings for ${texts.length} inputs`);
    }
    return out;
  }

  async chat(system: string, user: string): Promise<ChatResult> {
    const res = await this.client.models.generateContent({
      model: this.cfg.geminiChatModel,
      contents: [{ role: 'user', parts: [{ text: user }] }],
      config: {
        systemInstruction: system,
        temperature: 0.3,
      },
    });
    const text = res.text ?? '';
    const inputTokens = res.usageMetadata?.promptTokenCount ?? 0;
    const outputTokens = res.usageMetadata?.candidatesTokenCount ?? 0;
    return {
      text,
      inputTokens,
      outputTokens,
      costMicros: costMicros(this.cfg.geminiChatModel, inputTokens, outputTokens),
    };
  }
}

// ── Factory ────────────────────────────────────────────────────────────────

export function makeLLM(cfg: BotConfig): LLMAdapter {
  return cfg.provider === 'openai' ? new OpenAIAdapter(cfg) : new GeminiAdapter(cfg);
}
