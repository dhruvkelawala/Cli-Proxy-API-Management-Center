import { describe, expect, test } from 'bun:test';
import i18n from '@/i18n';
import {
  buildOrder,
  describeServing,
  healthCopy,
} from '@/features/clientProfiles/routing/routingOrder';
import {
  buildProviderGroups,
  describeOverview,
  flowStateOf,
} from '@/features/overview/overviewModel';
import type { AuthFileItem } from '@/types';

const claude = (name: string, extra: Partial<AuthFileItem> = {}): AuthFileItem => ({
  id: name,
  name,
  type: 'claude',
  status: 'active',
  note: name,
  ...extra,
});
const join = (names: string[]) => names.join(' and ');
const when = () => 'soon';
const en = (copy: { key: string; values?: Record<string, unknown> }) =>
  i18n.t(copy.key, { ...copy.values, lng: 'en' });

describe('weights in the routing order', () => {
  const files = [claude('A', { weight: 3 }), claude('B', { weight: 0 }), claude('C')];

  test('weighted round robin leaves weight 0 out, like the backend', () => {
    const model = buildOrder({
      files,
      provider: 'claude',
      strategy: 'weighted-round-robin',
      sessionAffinity: false,
    });
    expect(model.serving.map((a) => a.label).sort()).toEqual(['A', 'C']);
    const b = model.order.find((a) => a.label === 'B')!;
    expect(b.role).toBe('resting');
    expect(b.weightExcluded).toBe(true);
    expect(en(healthCopy(b, when))).toBe('Not used: weight is 0');
    expect(en(describeServing(model, join, when).title)).toBe(
      'New conversations are shared between A and C.'
    );
  });

  test('weights do not matter for round robin', () => {
    const model = buildOrder({
      files,
      provider: 'claude',
      strategy: 'round-robin',
      sessionAffinity: false,
    });
    expect(model.serving).toHaveLength(3);
    expect(model.order.some((a) => a.weightExcluded)).toBe(false);
  });

  test('Overview does not call a weight-0 account a problem or a switch', () => {
    const groups = buildProviderGroups({
      files,
      strategy: 'weighted-round-robin',
      sessionAffinity: false,
    });
    const sentence = describeOverview({
      connection: 'connected',
      groups,
      providerLabel: () => 'Claude',
      formatWhen: when,
      join,
    });
    const text = [...sentence.title, ...sentence.subtitle].map(en).join(' ');
    expect(text).toContain('Claude is shared between A and C.');
    expect(text).not.toContain('needs a look');
    expect(text).not.toContain('switched');
    const b = groups[0].accounts.find((item) => item.account.label === 'B')!;
    expect(flowStateOf(b.account)).toBe('off');
  });
});
