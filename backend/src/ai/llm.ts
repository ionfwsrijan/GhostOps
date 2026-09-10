import OpenAI from 'openai';
import { z } from 'zod';
import { env, hasOpenAI } from '../config.js';

let client: OpenAI | null = null;

export function llm(): OpenAI | null {
  if (client) return client;
  if (!hasOpenAI()) return null;
  client = new OpenAI({ apiKey: env.OPENAI_API_KEY });
  return client;
}

export function isLlmAvailable(): boolean {
  return Boolean(llm());
}

const RETRY_LIMIT = 2;

/**
 * Ask the LLM for a structured JSON object that matches `schema`.
 *
 * Tries, in order:
 *  1. OpenAI Structured Outputs (`json_schema` mode)
 *  2. JSON mode (`json_object`) with schema + instructions
 *  3. plain text mode
 *
 * Returns `null` if parsing keeps failing (caller falls back to heuristics).
 */
export async function structuredCompletion<T>(opts: {
  system: string;
  user: string;
  schema: z.ZodType<T>;
  jsonSchema: object;
  temperature?: number;
}): Promise<T | null> {
  const openai = llm();
  if (!openai) return null;

  const { system, user, schema, jsonSchema, temperature = 0.2 } = opts;
  const strictSchema = jsonSchema as OpenAI.ResponseFormatJSONSchema['json_schema'];

  for (let attempt = 0; attempt < RETRY_LIMIT; attempt++) {
    try {
      // 1) strict structured outputs
      try {
        const res = await openai.chat.completions.create({
          model: env.OPENAI_MODEL,
          temperature,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
          response_format: { type: 'json_schema', json_schema: strictSchema },
        });
        const content = res.choices[0]?.message?.content;
        if (content) {
          const parsed = schema.safeParse(JSON.parse(content));
          if (parsed.success) return parsed.data;
        }
      } catch {
        // fall through to JSON mode
      }

      // 2) json_object mode (no strict schema server-side)
      const res = await openai.chat.completions.create({
        model: env.OPENAI_MODEL,
        temperature,
        messages: [
          {
            role: 'system',
            content: `${system}\n\nYou MUST respond with a single valid JSON object that conforms to this JSON Schema:\n${JSON.stringify(
              jsonSchema
            )}`,
          },
          { role: 'user', content: user },
        ],
        response_format: { type: 'json_object' },
      });
      const content = res.choices[0]?.message?.content;
      if (!content) continue;
      const parsed = schema.safeParse(JSON.parse(content));
      if (parsed.success) return parsed.data;
    } catch (err) {
      console.warn(`[llm] attempt ${attempt + 1} failed: ${(err as Error).message}`);
      // last resort: plain completion that still parses
      if (attempt === RETRY_LIMIT - 1) {
        try {
          const res = await openai.chat.completions.create({
            model: env.OPENAI_MODEL,
            temperature,
            messages: [
              { role: 'system', content: `Return a JSON object matching this schema: ${JSON.stringify(jsonSchema)}` },
              { role: 'user', content: user },
            ],
          });
          const content = res.choices[0]?.message?.content;
          if (content) {
            const jsonLike = content.replace(/```json/g, '').replace(/```/g, '').trim();
            const parsed = schema.safeParse(JSON.parse(jsonLike));
            if (parsed.success) return parsed.data;
          }
        } catch {
          /* ignore */
        }
      }
    }
  }
  return null;
}

export function ambientSystemPrompt(): string {
  return [
    'You are GhostOps AI — an autonomous AI operations agent for a movie-ticket booking platform.',
    'You own operational problems from DETECTION to RESOLUTION.',
    'Rules:',
    '- Never invent facts. Only reason from tool results and system data.',
    '- Only select actions from the allowed action registry.',
    '- Never suggest arbitrary SQL, shell commands, or raw API calls.',
    '- Be concise. Produce safe, user-facing reasoning summaries (no hidden chain-of-thought).',
    '- Prioritize resolution over blame. Default to safe, idempotent remediation.',
  ].join('\n');
}