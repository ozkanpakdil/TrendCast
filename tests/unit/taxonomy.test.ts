import { describe, it, expect } from 'vitest';
import {
  classifyCategory,
  CATEGORY_ORDER,
  CATEGORY_RULES,
  type NewsCategory,
} from '@/config/taxonomy';

describe('classifyCategory', () => {
  it('returns finance when a finance keyword is present and no politics keyword is present', () => {
    expect(classifyCategory('Fed raises rates to fight inflation')).toBe('finance');
  });

  it('returns politics when politics precedence beats finance and tech keywords (D-04)', () => {
    // 'tariff' is a politics keyword; 'tech' is a technology keyword; politics wins.
    expect(classifyCategory('Senate passes tariff bill on tech imports')).toBe('politics');
  });

  it('returns technology for a tech headline', () => {
    expect(classifyCategory('AI chip startup raises funding')).toBe('technology');
  });

  it('falls back to finance when no category matches', () => {
    expect(classifyCategory('unrelated headline about weather')).toBe('finance');
  });

  it('maps a headline with keywords from multiple categories to exactly one (highest precedence)', () => {
    // Contains 'stock' (finance), 'ai' (tech), and 'senate' (politics) → politics.
    const result = classifyCategory('Senate stock market AI chip bill');
    expect(result).toBe('politics');
    // Contains 'stock' (finance) and 'ai' (tech) → finance (finance beats tech).
    expect(classifyCategory('stock market AI rally')).toBe('finance');
  });

  it('is case-insensitive', () => {
    expect(classifyCategory('FED RAISES RATES')).toBe('finance');
    expect(classifyCategory('Senate Passes Bill')).toBe('politics');
  });
});

describe('taxonomy constants', () => {
  it('CATEGORY_ORDER equals politics > finance > technology (D-03/D-04)', () => {
    expect(CATEGORY_ORDER).toEqual(['politics', 'finance', 'technology']);
  });

  it('CATEGORY_RULES has exactly the 3 v1 categories', () => {
    const keys = Object.keys(CATEGORY_RULES) as NewsCategory[];
    expect(keys.sort()).toEqual(['finance', 'politics', 'technology']);
  });

  it('every CATEGORY_ORDER entry has a matching rule with a label and keywords', () => {
    for (const cat of CATEGORY_ORDER) {
      const rule = CATEGORY_RULES[cat];
      expect(rule.id).toBe(cat);
      expect(rule.label.length).toBeGreaterThan(0);
      expect(rule.keywords.length).toBeGreaterThan(0);
    }
  });
});
