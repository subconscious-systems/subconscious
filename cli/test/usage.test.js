import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  formatCurrency,
  formatTokens,
  formatUsageDisplay,
  isLegacyUsagePayload,
  renderProgressBar,
  shortModelSlug,
} from '../bin/usage.js';

test('formatTokens abbreviates large counts', () => {
  assert.equal(formatTokens(500), '500');
  assert.equal(formatTokens(12_400), '12K');
  assert.equal(formatTokens(12_400_000), '12.4M');
  assert.equal(formatTokens(2_000_000_000), '2B');
});

test('formatCurrency renders signed dollars', () => {
  assert.equal(formatCurrency(42.5), '$42.50');
  assert.equal(formatCurrency(-1.2), '-$1.20');
});

test('shortModelSlug strips subconscious prefix', () => {
  assert.equal(shortModelSlug('subconscious/glm-5.3-marathon'), 'glm-5.3-marathon');
  assert.equal(shortModelSlug('other/model'), 'other/model');
});

test('isLegacyUsagePayload detects old quota-only responses', () => {
  assert.equal(isLegacyUsagePayload({ dailyTokenCeiling: 100, consumedToday: 1 }), true);
  assert.equal(isLegacyUsagePayload(null), true);
  assert.equal(
    isLegacyUsagePayload({
      billingMode: 'subscription',
      plan: { label: 'Pro', dailyAllowance: null, isUnlimitedComp: false },
      credits: { balanceDollars: 1, overageThisPeriodDollars: 0 },
      models: [],
    }),
    false,
  );
});

test('formatUsageDisplay renders subscription meter and models', () => {
  const output = formatUsageDisplay({
    billingMode: 'subscription',
    plan: {
      label: 'Pro',
      status: 'active',
      isUnlimitedComp: false,
      dailyAllowance: {
        amount: 20_000_000,
        units: 'tokens',
        consumed: 12_400_000,
        remaining: 7_600_000,
        resetAt: '2026-09-08T00:00:00.000Z',
      },
    },
    credits: { balanceDollars: 42.5, overageThisPeriodDollars: 0 },
    models: [
      { slug: 'subconscious/tim-qwen3.6-27b', consumedToday: 8_200_000 },
      { slug: 'subconscious/glm-5.3-marathon', consumedToday: 4_200_000 },
    ],
  });

  assert.match(output, /Subconscious Usage/);
  assert.match(output, /Pro · active/);
  assert.match(output, /12\.4M \/ 20M tokens/);
  assert.match(output, /\$42\.50/);
  assert.match(output, /tim-qwen3\.6-27b/);
});

test('formatUsageDisplay renders unlimited comp without meter', () => {
  const output = formatUsageDisplay({
    billingMode: 'comp',
    plan: {
      label: 'Custom',
      status: 'active',
      isUnlimitedComp: true,
      dailyAllowance: null,
    },
    credits: { balanceDollars: 0, overageThisPeriodDollars: 0 },
    models: [],
  });

  assert.match(output, /Unlimited/);
  assert.doesNotMatch(output, /Daily allowance[\s\S]*\/ .* tokens/);
});

test('renderProgressBar fills proportionally', () => {
  const bar = renderProgressBar(50, 10);
  assert.match(bar, /█{5}/);
  assert.match(bar, /░{5}/);
});
