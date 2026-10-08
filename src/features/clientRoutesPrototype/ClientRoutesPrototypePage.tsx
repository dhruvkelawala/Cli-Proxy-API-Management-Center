/**
 * PROTOTYPE (throwaway; lives only on branch prototype/cpa-005-client-routes).
 *
 * Question: "What should choosing a subscription per client (CPA-005), plus the shared
 * load-balancing settings that Automatic clients use (CPA-008), look like?"
 *
 * Three structurally different variants on one dev-only route, switchable via ?variant=A|B|C and
 * the floating bottom bar (or ←/→). All data is synthetic and in memory; nothing calls the
 * Management API. Strings are hard-coded English on purpose (no i18n for throwaway code).
 */
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PrototypeSwitcher, type VariantInfo } from './PrototypeSwitcher';
import { VariantA, VARIANT_A_NAME } from './VariantA';
import { VariantB, VARIANT_B_NAME } from './VariantB';
import { VariantC, VARIANT_C_NAME } from './VariantC';

const VARIANTS: VariantInfo[] = [
  { key: 'A', name: VARIANT_A_NAME },
  { key: 'B', name: VARIANT_B_NAME },
  { key: 'C', name: VARIANT_C_NAME },
];

// MainLayout renders routes with a pathname-keyed transition location, so search-only changes
// don't reach useSearchParams here. Read the variant from the real hash instead.
const readVariant = () => {
  const query = window.location.hash.split('?')[1] ?? '';
  const raw = (new URLSearchParams(query).get('variant') ?? 'A').toUpperCase();
  return VARIANTS.some((v) => v.key === raw) ? raw : 'A';
};

export function ClientRoutesPrototypePage() {
  const navigate = useNavigate();
  const [variant, setVariant] = useState(readVariant);

  useEffect(() => {
    const sync = () => setVariant(readVariant());
    window.addEventListener('hashchange', sync);
    window.addEventListener('popstate', sync);
    return () => {
      window.removeEventListener('hashchange', sync);
      window.removeEventListener('popstate', sync);
    };
  }, []);

  const change = useCallback(
    (key: string) => {
      setVariant(key);
      navigate(`/prototype/client-routes?variant=${key}`, { replace: true });
      window.scrollTo({ top: 0 });
    },
    [navigate]
  );

  return (
    <>
      {variant === 'A' && <VariantA />}
      {variant === 'B' && <VariantB />}
      {variant === 'C' && <VariantC />}
      {import.meta.env.DEV && (
        <PrototypeSwitcher variants={VARIANTS} current={variant} onChange={change} />
      )}
    </>
  );
}
