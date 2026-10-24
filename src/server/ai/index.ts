import type { AppConfig } from '../config.js';
import { AzureAiProvider } from './azure.js';
import type { AiProvider } from './contract.js';
import { MockAiProvider } from './mock.js';

/**
 * Provider selection happens once, at startup, from configuration only.
 * There is no runtime switch and no fallback: if the configured provider fails
 * during a brief, the brief is produced without the AI sections and says so.
 */
export function createAiProvider(config: AppConfig): AiProvider {
  if (config.aiProvider === 'azure') {
    if (!config.azure) {
      throw new Error('AI_PROVIDER=azure requires the Azure settings. Refusing to start.');
    }
    return new AzureAiProvider(config.azure);
  }
  return new MockAiProvider();
}

export * from './contract.js';
export { MockAiProvider } from './mock.js';
export { AzureAiProvider } from './azure.js';
