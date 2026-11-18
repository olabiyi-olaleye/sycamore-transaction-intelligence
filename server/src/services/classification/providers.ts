import { config } from '../../config/env.js';
import { mockLlmProvider } from './mockLlmProvider.js';
import type { ClassificationProvider } from './provider.js';

// Every provider the app knows about, keyed by the CLASSIFIER_PROVIDER value
// that selects it. Adding a real vendor means writing one ClassificationProvider
// (an openai.ts next to mockLlmProvider.ts, say), adding it here and to the
// enum in config/env.ts. The worker, retries, breaker and history don't change.
export const PROVIDERS = {
  mock: mockLlmProvider,
} satisfies Record<string, ClassificationProvider>;

export type ProviderName = keyof typeof PROVIDERS;

let active: ClassificationProvider = PROVIDERS[config.CLASSIFIER_PROVIDER];

export function getClassificationProvider(): ClassificationProvider {
  return active;
}

/** Swaps the provider at runtime. Used by tests to prove nothing else needs to change. */
export function setClassificationProvider(provider: ClassificationProvider): void {
  active = provider;
}

export function resetClassificationProvider(): void {
  active = PROVIDERS[config.CLASSIFIER_PROVIDER];
}
