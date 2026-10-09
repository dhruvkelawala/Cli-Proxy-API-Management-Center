/**
 * PROTOTYPE — friendly Client routes (throwaway; branch prototype/client-routes-friendly only).
 *
 * Question: can "which Claude account does each Mac use, and is it healthy?" be answered at a
 * glance and changed in one or two clicks?
 *
 * Brief: the page only needs to answer "who goes first, who's the backup, are they healthy".
 * Three structurally different variants on `#/client-routes?variant=A|B|C` (`0` = today's page),
 * switched by the floating bar or ← → keys (dev builds only). Real data, stubbed writes.
 */
import { useCallback, useEffect, useState } from 'react';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { useHeaderRefresh } from '@/hooks/useHeaderRefresh';
import { ClientRoutesPage } from '../ClientRoutesPage';
import { useProtoRoutesModel, type ProtoModel } from './useProtoRoutesModel';
import { ProtoToast } from './shared';
import { VariantFlow } from './VariantFlow';
import { VariantCards } from './VariantCards';
import { VariantWeek } from './VariantWeek';
import styles from './Prototype.module.scss';

const VARIANTS = [
  { key: 'A', name: 'Flow · drag to reorder' },
  { key: 'B', name: 'Two cards · swap' },
  { key: 'C', name: 'The week · resets' },
  { key: '0', name: 'Current page' },
] as const;

type VariantKey = (typeof VARIANTS)[number]['key'];

let lastVariant: VariantKey = 'A';

const isVariant = (value: string | null): value is VariantKey =>
  VARIANTS.some((v) => v.key === value);

const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));

function VariantSwitcher({ current, go }: { current: VariantKey; go: (step: number) => void }) {
  const index = VARIANTS.findIndex((v) => v.key === current);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || event.defaultPrevented) return;
      if (isTyping(event.target)) return;
      // Inside a widget that uses arrows itself (segmented control, lanes, popover).
      if (event.target instanceof HTMLElement && event.target.closest('[data-arrow-keys]')) return;
      if (event.key === 'ArrowLeft') go(-1);
      if (event.key === 'ArrowRight') go(1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go]);
  return (
    <div className={styles.switcher} role="group" aria-label="Prototype variant switcher">
      <button type="button" onClick={() => go(-1)} aria-label="Previous variant">
        ←
      </button>
      <span aria-live="polite">
        <strong>{current}</strong> {VARIANTS[index].name}
      </span>
      <button type="button" onClick={() => go(1)} aria-label="Next variant">
        →
      </button>
    </div>
  );
}

function PrototypeBody({ variant }: { variant: Exclude<VariantKey, '0'> }) {
  const model: ProtoModel = useProtoRoutesModel();
  useHeaderRefresh(async () => model.refresh(), true);

  let body;
  if (model.status === 'loading') {
    body = (
      <div className={styles.status} role="status">
        <LoadingSpinner size={18} /> Loading your Macs and accounts…
      </div>
    );
  } else if (model.status !== 'ready') {
    body = (
      <div className={styles.status}>
        {model.status === 'unsupported'
          ? 'This gateway doesn’t support per-Mac routing yet.'
          : 'Couldn’t load client routes. Use the refresh button to retry.'}
      </div>
    );
  } else if (variant === 'A') {
    body = <VariantFlow model={model} />;
  } else if (variant === 'B') {
    body = <VariantCards model={model} />;
  } else {
    body = <VariantWeek model={model} />;
  }

  return (
    <div className={styles.root} data-proto-variant={variant}>
      {body}
      <ProtoToast model={model} />
    </div>
  );
}

/**
 * The page transition layer keeps a frozen location for the route element, so search-only
 * changes inside the hash never reach useLocation here. Read and write the hash directly.
 */
const readHashVariant = (): VariantKey | null => {
  const hash = window.location.hash;
  const query = hash.includes('?') ? hash.slice(hash.indexOf('?')) : '';
  const value = new URLSearchParams(query).get('variant');
  return isVariant(value) ? value : null;
};

export function ClientRoutesPrototype() {
  const [current, setCurrent] = useState<VariantKey>(() => readHashVariant() ?? lastVariant);

  useEffect(() => {
    lastVariant = current;
  }, [current]);

  useEffect(() => {
    const onHash = () => {
      const next = readHashVariant();
      if (next) setCurrent(next);
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const go = useCallback(
    (step: number) => {
      const index = VARIANTS.findIndex((v) => v.key === current);
      const next = VARIANTS[(index + step + VARIANTS.length) % VARIANTS.length].key;
      const hash = window.location.hash || '#/client-routes';
      const [path, query = ''] = hash.split('?');
      const params = new URLSearchParams(query);
      params.set('variant', next);
      window.history.replaceState(window.history.state, '', `${path}?${params.toString()}`);
      setCurrent(next);
    },
    [current]
  );

  return (
    <>
      {current === '0' ? <ClientRoutesPage /> : <PrototypeBody variant={current} />}
      <VariantSwitcher current={current} go={go} />
    </>
  );
}
