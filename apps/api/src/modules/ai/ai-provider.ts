import { z } from 'zod';
import { aiOutputSchema, type AIOutput } from '@flowsync/contracts';
import type { Environment } from '../../config/environment';
export interface AIProvider {
  generate(input: { instructions: string; context: string }): Promise<AIOutput>;
}
export const AI_PROVIDER = Symbol('AI_PROVIDER');
export class AIProviderError extends Error {
  constructor(readonly retryable: boolean) {
    super('AI provider unavailable');
  }
}
const openAIResponse = z.object({
  status: z.literal('completed'),
  output: z.array(
    z.object({
      type: z.string(),
      content: z.array(z.object({ type: z.string(), text: z.string().optional() })).optional(),
    }),
  ),
});
const geminiResponse = z.object({
  status: z.literal('completed'),
  steps: z.array(
    z.object({
      type: z.string(),
      content: z.array(z.object({ type: z.string(), text: z.string().optional() })).optional(),
    }),
  ),
});
export function createAIProvider(env: Environment, http: typeof fetch = fetch): AIProvider {
  return {
    async generate({ instructions, context }) {
      if (env.AI_PROVIDER === 'disabled') throw new AIProviderError(false);
      const schema = z.toJSONSchema(aiOutputSchema, { target: 'draft-7' });
      delete schema.$schema;
      const openai = env.AI_PROVIDER === 'openai';
      let response: Response;
      try {
        response = await http(
          openai
            ? 'https://api.openai.com/v1/responses'
            : 'https://generativelanguage.googleapis.com/v1beta/interactions',
          {
            method: 'POST',
            signal: AbortSignal.timeout(45000),
            redirect: 'error',
            headers: {
              'Content-Type': 'application/json',
              ...(openai
                ? { Authorization: `Bearer ${env.OPENAI_API_KEY}` }
                : { 'x-goog-api-key': env.GEMINI_API_KEY! }),
            },
            body: JSON.stringify(
              openai
                ? {
                    model: env.AI_MODEL,
                    instructions,
                    input: context,
                    store: false,
                    max_output_tokens: 6000,
                    text: {
                      format: {
                        type: 'json_schema',
                        name: 'flowsync_project_assistant',
                        schema,
                        strict: true,
                      },
                    },
                  }
                : {
                    model: env.AI_MODEL,
                    system_instruction: instructions,
                    input: context,
                    store: false,
                    generation_config: { max_output_tokens: 6000 },
                    response_format: { type: 'text', mime_type: 'application/json', schema },
                  },
            ),
          },
        );
      } catch {
        throw new AIProviderError(true);
      }
      if (!response.ok)
        throw new AIProviderError(response.status === 429 || response.status >= 500);
      // Refusals, incomplete generations and malformed provider responses never become executable suggestions.
      try {
        const text = await response.text();
        if (text.length > 200000) throw new Error();
        const body: unknown = JSON.parse(text);
        const blocks = openai
          ? openAIResponse.parse(body).output
          : geminiResponse.parse(body).steps;
        const output = blocks
          .filter((block) => block.type === (openai ? 'message' : 'model_output'))
          .flatMap((block) => block.content ?? [])
          .filter((block) => block.type === (openai ? 'output_text' : 'text'))
          .map((block) => block.text ?? '')
          .join('');
        return aiOutputSchema.parse(JSON.parse(output));
      } catch {
        throw new AIProviderError(false);
      }
    },
  };
}
