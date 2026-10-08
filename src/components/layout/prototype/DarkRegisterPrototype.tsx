/**
 * PROTOTYPE — dark register (throwaway; lives on branch prototype/dark-register only).
 *
 * Question: what should this dashboard's dark mode look like, given "Linear style"
 * and SumoStudio's chosen shell (sumostudio/prototypes/shell-prototype/final-shell.html)?
 *
 * Plan: three dark registers across every authenticated route, switched by `?variant=`
 * (inside the hash, e.g. `#/auth-files?variant=B`) or the floating bar / ← → keys.
 * `0` is today's warm dark theme for comparison. Forces dark while mounted; nothing persists.
 */
import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import './DarkRegisterPrototype.scss';

const VARIANTS = [
  { key: 'A', name: 'Studio · flat true black' },
  { key: 'B', name: 'Linear · inset canvas, indigo' },
  { key: 'C', name: 'Hybrid · black inset, one violet' },
  { key: '0', name: 'Current warm dark' },
] as const;

type VariantKey = (typeof VARIANTS)[number]['key'];

let lastVariant: VariantKey = 'A';

const isVariant = (value: string | null): value is VariantKey =>
  VARIANTS.some((v) => v.key === value);

const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));

export function DarkRegisterPrototype() {
  const location = useLocation();
  const navigate = useNavigate();
  const param = new URLSearchParams(location.search).get('variant');
  if (isVariant(param)) lastVariant = param;
  const [, force] = useState(0);
  const current = isVariant(param) ? param : lastVariant;
  const index = VARIANTS.findIndex((v) => v.key === current);

  const go = (step: number) => {
    const next = VARIANTS[(index + step + VARIANTS.length) % VARIANTS.length].key;
    lastVariant = next;
    const params = new URLSearchParams(location.search);
    params.set('variant', next);
    navigate({ pathname: location.pathname, search: params.toString() }, { replace: true });
    force((n) => n + 1);
  };

  useEffect(() => {
    const root = document.documentElement;
    const apply = () => {
      if (root.getAttribute('data-theme') !== 'dark') root.setAttribute('data-theme', 'dark');
      if (root.getAttribute('data-proto-dark') !== current) {
        root.setAttribute('data-proto-dark', current);
      }
    };
    apply();
    const observer = new MutationObserver(apply);
    observer.observe(root, { attributes: true, attributeFilter: ['data-theme', 'data-proto-dark'] });
    return () => {
      observer.disconnect();
      root.removeAttribute('data-proto-dark');
    };
  }, [current]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || isTyping(event.target)) return;
      if (event.key === 'ArrowLeft') go(-1);
      if (event.key === 'ArrowRight') go(1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return (
    <div className="proto-dark-switcher" role="group" aria-label="Prototype variant switcher">
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
