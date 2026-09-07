/**
 * Usage display for `subc usage` — fetches billing/quota from the platform API.
 */

import { c } from './colors.js';
import { getApiKey, getPlatformUrl } from './auth.js';
import { DEFAULT_PROFILE } from './profiles.js';
import { printLoginUpgradeWarning } from './upgrade.js';

export const USAGE_API_PATH = '/api/v1/usage';

export function formatTokens(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return '0';
  if (n >= 1_000_000_000) {
    const scaled = n / 1_000_000_000;
    return `${scaled.toFixed(n % 1_000_000_000 ? 1 : 0)}B`;
  }
  if (n >= 1_000_000) {
    const scaled = n / 1_000_000;
    return `${scaled.toFixed(n % 1_000_000 ? 1 : 0)}M`;
  }
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`;
  return n.toLocaleString('en-US');
}

export function formatCurrency(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '$0.00';
  const sign = n < 0 ? '-' : '';
  return `${sign}$${Math.abs(n).toFixed(2)}`;
}

export function shortModelSlug(slug) {
  const text = String(slug ?? '').trim();
  return text.startsWith('subconscious/') ? text.slice('subconscious/'.length) : text;
}

export function isLegacyUsagePayload(data) {
  if (!data || typeof data !== 'object') return true;
  if ('credits' in data && data.plan && typeof data.plan === 'object') return false;
  return 'dailyTokenCeiling' in data || 'consumedToday' in data || !('plan' in data);
}

export function meterColor(percentage) {
  if (percentage >= 100) return c.red;
  if (percentage >= 80) return c.yellow;
  return c.green;
}

export function renderProgressBar(percentage, width = 20) {
  const pct = Math.max(0, Math.min(100, percentage));
  const filled = Math.round((pct / 100) * width);
  const empty = Math.max(0, width - filled);
  const color = meterColor(pct);
  return `${color}${'█'.repeat(filled)}${c.dim}${'░'.repeat(empty)}${c.reset}`;
}

export function formatUsageDisplay(data) {
  const lines = [];
  lines.push(`\n  ${c.bold}Subconscious Usage${c.reset}\n`);

  const billingMode = data.billingMode ?? null;
  const plan = data.plan ?? {};
  const credits = data.credits ?? {};
  const models = Array.isArray(data.models) ? data.models : [];

  const planLabel = plan.label || 'No plan';
  const planStatus = plan.status ? plan.status.replace(/_/g, ' ') : null;
  const planLine = planStatus ? `${planLabel} · ${planStatus}` : planLabel;

  lines.push(`  ${c.dim}Plan${c.reset}            ${planLine}`);
  if (billingMode) {
    lines.push(`  ${c.dim}Billing${c.reset}         ${billingMode}`);
  }

  const allowance = plan.dailyAllowance;
  const unlimitedComp = Boolean(plan.isUnlimitedComp);

  if (unlimitedComp) {
    lines.push('');
    lines.push(`  ${c.dim}Daily allowance${c.reset}`);
    lines.push(`  ${c.green}Unlimited${c.reset} ${c.dim}(comp)${c.reset}`);
  } else if (allowance && allowance.amount > 0) {
    const consumed = Number(allowance.consumed) || 0;
    const amount = Number(allowance.amount) || 0;
    const remaining = Number(allowance.remaining) || 0;
    const pct = amount > 0 ? Math.min((consumed / amount) * 100, 100) : 0;
    const overage = Math.max(0, consumed - amount);

    lines.push('');
    lines.push(`  ${c.dim}Daily allowance${c.reset}`);
    lines.push(
      `  ${renderProgressBar(pct)}  ${formatTokens(consumed)} / ${formatTokens(amount)} tokens`,
    );
    const resetNote = allowance.resetAt
      ? `${formatTokens(remaining)} remaining · resets midnight UTC`
      : `${formatTokens(remaining)} remaining`;
    lines.push(`  ${c.dim}${resetNote}${c.reset}`);
    if (overage > 0) {
      lines.push(`  ${c.yellow}+${formatTokens(overage)} over daily allowance${c.reset}`);
    }
  }

  lines.push('');
  lines.push(
    `  ${c.dim}Credits${c.reset}         ${formatCurrency(credits.balanceDollars ?? 0)}`,
  );
  if (billingMode === 'subscription' || billingMode === 'comp' || allowance) {
    const overage = Number(credits.overageThisPeriodDollars) || 0;
    const overageColor = overage > 0 ? c.yellow : c.reset;
    lines.push(
      `  ${c.dim}Overage${c.reset}         ${overageColor}${formatCurrency(overage)} this period${c.reset}`,
    );
  }

  if (models.length > 0) {
    lines.push('');
    lines.push(`  ${c.dim}Models today${c.reset}`);
    const slugWidth = Math.max(
      12,
      ...models.map((model) => shortModelSlug(model.slug).length),
    );
    for (const model of models) {
      const label = shortModelSlug(model.slug).padEnd(slugWidth);
      lines.push(
        `    ${label}  ${formatTokens(model.consumedToday ?? 0)}`,
      );
    }
  }

  lines.push('');
  return lines.join('\n');
}

export async function fetchUsage(apiKey, platformUrl, fetchImpl = fetch) {
  const res = await fetchImpl(`${platformUrl.replace(/\/$/, '')}${USAGE_API_PATH}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(5000),
  });
  return res;
}

export async function usageCommand(argv = [], options = {}) {
  const jsonOutput = argv.includes('--json');
  const profileFlag =
    options.profileName && options.profileName !== DEFAULT_PROFILE
      ? `--profile ${options.profileName} `
      : '';

  const auth = await getApiKey(options.profile);
  if (!auth) {
    console.log(`\n  ${c.dim}Not logged in.${c.reset}`);
    console.log(`  Run ${c.cyan}subc ${profileFlag}login${c.reset} to get started.\n`);
    return;
  }

  const platformUrl = getPlatformUrl(options.profile);

  try {
    const res = await fetchUsage(auth.key, platformUrl);

    if (res.status === 404) {
      printLoginUpgradeWarning();
      return;
    }

    let data;
    try {
      data = await res.json();
    } catch {
      throw new Error('Platform returned an invalid response');
    }

    if (!res.ok) {
      const message = data?.error || `Request failed (${res.status})`;
      if (res.status === 401) {
        console.log(`\n  ${c.red}✗ ${message}${c.reset}`);
        console.log(
          `  Run ${c.cyan}subc ${profileFlag}logout${c.reset} then ${c.cyan}subc ${profileFlag}login${c.reset} to re-authenticate.\n`,
        );
        return;
      }
      if (res.status === 403) {
        console.log(`\n  ${c.red}✗ ${message}${c.reset}\n`);
        return;
      }
      throw new Error(message);
    }

    if (isLegacyUsagePayload(data)) {
      console.log(`\n  ${c.yellow}Platform upgrade required.${c.reset}`);
      console.log(
        `  ${c.dim}This platform host returns a legacy usage shape. Deploy the latest platform or point PLATFORM_URL at a current host.${c.reset}\n`,
      );
      return;
    }

    if (jsonOutput) {
      console.log(JSON.stringify(data, null, 2));
      return;
    }

    console.log(formatUsageDisplay(data));
  } catch (error) {
    if (error.name === 'TimeoutError' || error.name === 'AbortError') {
      console.log(`\n  ${c.yellow}Could not reach the platform (timed out).${c.reset}`);
      console.log(`  ${c.dim}Host: ${platformUrl}${c.reset}\n`);
      return;
    }
    console.error(`\n  ${c.red}${error.message}${c.reset}\n`);
    process.exitCode = 1;
  }
}

export function printUsageHelp() {
  console.log(`
Usage:
  subc usage
  subc -p NAME usage
  subc usage --json
  subc usage help

Show billing mode, daily token allowance, credit balance, and per-model usage
for the authenticated organization.

  --json   Print the raw platform JSON response
`);
}
