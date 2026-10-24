import type { AzureConfig } from '../config.js';
import type { AiProvider, AiRequest } from './contract.js';
import { RESPONSE_JSON_SCHEMA, SYSTEM_PROMPT, buildUserMessage } from './prompt.js';

/**
 * Optional server-side adapter for Azure OpenAI. Off by default.
 *
 * UNVERIFIED: this adapter has never been run against a live Azure deployment.
 * It is written from the documented REST contract and covered by tests that
 * stub fetch. Treat it as scaffolding until an organization runs it against
 * its own resource. See docs/TEAMS-INTEGRATION.md.
 *
 * The model is given no tools, no browsing, and no way to reach the store.
 * Its reply is parsed and validated by ai/contract.ts before anything is used.
 */
export class AzureAiProvider implements AiProvider {
  readonly kind = 'azure' as const;
  readonly label: string;
  private readonly config: AzureConfig;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(config: AzureConfig, fetchImpl: typeof fetch = fetch, timeoutMs = 20_000) {
    this.config = config;
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
    this.label = `Azure OpenAI deployment "${config.deployment}" (server-side)`;
  }

  async analyze(request: AiRequest): Promise<unknown> {
    const url =
      `${this.config.endpoint}/openai/deployments/${encodeURIComponent(this.config.deployment)}` +
      `/chat/completions?api-version=${encodeURIComponent(this.config.apiVersion)}`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          // The key stays on the server. It is never sent to the browser.
          'api-key': this.config.apiKey,
        },
        signal: controller.signal,
        body: JSON.stringify({
          temperature: 0,
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: buildUserMessage(request) },
          ],
          response_format: {
            type: 'json_schema',
            json_schema: { name: 'huddle_analysis', strict: true, schema: RESPONSE_JSON_SCHEMA },
          },
        }),
      });

      if (!response.ok) {
        throw new Error(`Azure OpenAI returned HTTP ${response.status}`);
      }
      const payload = (await response.json()) as {
        choices?: { message?: { content?: string } }[];
      };
      const content = payload.choices?.[0]?.message?.content;
      if (!content) throw new Error('Azure OpenAI returned no message content');
      return JSON.parse(content) as unknown;
    } finally {
      clearTimeout(timer);
    }
  }
}
