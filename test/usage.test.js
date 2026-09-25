import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  describeDailyAllowance,
  formatAllowancePercent,
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

test('formatAllowancePercent never rounds a remaining allowance up to 100', () => {
  assert.equal(formatAllowancePercent(5.5), '6%');
  assert.equal(formatAllowancePercent(99.6), '99%');
  assert.equal(formatAllowancePercent(100), '100%');
  assert.equal(formatAllowancePercent(140), '100%');
});

test('describeDailyAllowance computes a percent from the legacy token shape', () => {
  assert.deepEqual(
    describeDailyAllowance({
      amount: 20_000_000,
      units: 'tokens',
      consumed: 12_400_000,
      remaining: 7_600_000,
    }),
    { kind: 'tokens', percent: 62 },
  );
});

test('formatUsageDisplay renders a credit allowance as a percent', () => {
  const output = formatUsageDisplay({
    billingMode: 'subscription',
    plan: {
      label: 'Heavy',
      status: 'active',
      isUnlimitedComp: false,
      dailyAllowance: {
        basis: 'credit',
        percent: 5.5,
        resetAt: '2026-09-24T00:00:00.000Z',
      },
    },
    credits: { balanceDollars: 47479.24, overageThisPeriodDollars: 0 },
    models: [{ slug: 'subconscious/glm-5.3-marathon', consumedToday: 44_500_000 }],
  });

  assert.match(output, /6% of daily credit used/);
  assert.match(output, /Resets midnight UTC/);
  assert.match(output, /\$47479\.24/);
  assert.doesNotMatch(output, /\/ .* tokens/);
  assert.doesNotMatch(output, /[Cc]ents/);
});

test('formatUsageDisplay warns when the daily credit is spent', () => {
  const output = formatUsageDisplay({
    billingMode: 'subscription',
    plan: {
      label: 'Heavy',
      status: 'active',
      isUnlimitedComp: false,
      dailyAllowance: { basis: 'credit', percent: 112.4, resetAt: '2026-09-24T00:00:00.000Z' },
    },
    credits: { balanceDollars: 10, overageThisPeriodDollars: 1.2 },
    models: [],
  });

  assert.match(output, /100% of daily credit used/);
  assert.match(output, /Past today's allowance/);
});

test('formatUsageDisplay renders an unavailable daily credit', () => {
  const output = formatUsageDisplay({
    billingMode: 'subscription',
    plan: {
      label: 'Heavy',
      status: 'active',
      isUnlimitedComp: false,
      dailyAllowance: { basis: 'unavailable', resetAt: '2026-09-24T00:00:00.000Z' },
    },
    credits: { balanceDollars: 10, overageThisPeriodDollars: 0 },
    models: [],
  });

  assert.match(output, /Daily credit unavailable/);
  assert.match(output, /could not be read just now/);
  assert.doesNotMatch(output, /% of daily/);
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
  assert.match(output, /62% of daily tokens used/);
  assert.doesNotMatch(output, /12\.4M \/ 20M tokens/);
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
  assert.doesNotMatch(output, /% of daily/);
});

test('renderProgressBar fills proportionally', () => {
  const bar = renderProgressBar(50, 10);
  assert.match(bar, /█{5}/);
  assert.match(bar, /░{5}/);
});
