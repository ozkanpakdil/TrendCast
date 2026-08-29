/**
 * Unit tests for the correlation-engine migration (zeroshot removal).
 *
 * Verifies `migrateCorrelationEngine` maps a stored `correlationEngine: 'zeroshot'`
 * (a removed engine literal) to `'heuristic'` so users who had zero-shot selected
 * don't end up with an invalid engine after updating. It must be pure, idempotent,
 * and a no-op for every still-valid engine.
 */

import { describe, it, expect } from 'vitest';
import { migrateCorrelationEngine, migrateLLMModel } from '@/utils/settings';
import type { ExtensionSettings } from '@/types';

describe('migrateCorrelationEngine (zeroshot removal)', () => {
  it('returns null for undefined stored', () => {
    expect(migrateCorrelationEngine(undefined)).toBeNull();
  });

  it('maps stored zeroshot to heuristic and preserves other keys', () => {
    const stored = {
      collectionIntervalMinutes: 60,
      theme: 'dark',
      correlationEngine: 'zeroshot',
    } as unknown as Partial<ExtensionSettings>;
    const out = migrateCorrelationEngine(stored);
    expect(out).not.toBeNull();
    expect(out!.correlationEngine).toBe('heuristic');
    // Other stored fields preserved.
    expect(out!.collectionIntervalMinutes).toBe(60);
    expect(out!.theme).toBe('dark');
  });

  it('is a no-op (null) for every still-valid engine', () => {
    for (const engine of ['heuristic', 'embedding', 'sentiment', 'ner', 'llm'] as const) {
      const stored = { correlationEngine: engine } as Partial<ExtensionSettings>;
      expect(migrateCorrelationEngine(stored)).toBeNull();
    }
  });

  it('is idempotent — migrating an already-migrated result is a no-op', () => {
    const stored = { correlationEngine: 'zeroshot' } as unknown as Partial<ExtensionSettings>;
    const once = migrateCorrelationEngine(stored)!;
    expect(migrateCorrelationEngine(once)).toBeNull();
  });
});

describe('migrateLLMModel (≥1 GB model removal)', () => {
  it('returns null for undefined stored', () => {
    expect(migrateLLMModel(undefined)).toBeNull();
  });

  it('maps each removed model to Qwen2.5-0.5B and preserves other keys', () => {
    const removedModels = [
      'onnx-community/Qwen2.5-1.5B-Instruct',
      'onnx-community/Qwen2.5-1.5B-Instruct-ONNX', // pre-fix repo id (HF 401)
      'onnx-community/Phi-3.5-mini-instruct-onnx-web',
      'onnx-community/DeepSeek-R1-Distill-Qwen-1.5B-ONNX',
      'onnx-community/glm-edge-1.5b-chat-ONNX',
    ];
    for (const model of removedModels) {
      const stored = {
        collectionIntervalMinutes: 60,
        theme: 'dark',
        llmModel: model,
      } as unknown as Partial<ExtensionSettings>;
      const out = migrateLLMModel(stored);
      expect(out).not.toBeNull();
      expect(out!.llmModel).toBe('onnx-community/Qwen2.5-0.5B-Instruct-ONNX');
      // Other stored fields preserved.
      expect(out!.collectionIntervalMinutes).toBe(60);
      expect(out!.theme).toBe('dark');
    }
  });

  it('is a no-op (null) for every still-valid LLM model', () => {
    for (const model of [
      'HuggingFaceTB/SmolLM2-135M-Instruct',
      'HuggingFaceTB/SmolLM2-360M-Instruct',
      'onnx-community/Qwen2.5-0.5B-Instruct-ONNX',
    ] as const) {
      const stored = { llmModel: model } as Partial<ExtensionSettings>;
      expect(migrateLLMModel(stored)).toBeNull();
    }
  });

  it('is idempotent — migrating an already-migrated result is a no-op', () => {
    const stored = {
      llmModel: 'onnx-community/Phi-3.5-mini-instruct-onnx-web',
    } as unknown as Partial<ExtensionSettings>;
    const once = migrateLLMModel(stored)!;
    expect(migrateLLMModel(once)).toBeNull();
  });
});