# Prototype verdict: client routes and shared routing (CPA-005 / CPA-008)

Question: what should choosing a subscription per client, plus the shared load-balancing settings used by Automatic clients, look like?

This branch holds three throwaway variants (`#/prototype/client-routes?variant=A|B|C`, dev-only). Run steps: `/tmp/cpa-ship/mock-proto/README.md` at the time of writing; mock key `proto-mock-key`.

Decided by the product owner on 2026-10-08:

1. **Layout: hybrid.** Client routes page uses B's client × provider matrix as the overview. A cell opens a side sheet holding A's editor and policy preview. The Accounts cards get C's pinned-client chips and a "Use only this subscription for…" action. C's request journey explains the Automatic preview; it is not an editing surface.
2. **Shared pool settings: reused inline.** A compact band on Client routes reuses the Config page's editor and config store (one source of state), with the global scope ("affects N Automatic clients on Mini and MacBook") beside Save. Priority and weight open in a sheet.
3. **Only X while X is disabled: allowed with a "will fail" warning.** Requests error until X is enabled; no other account substitutes.
4. **Priority: raw numbers.** Existing values are preserved; hint "Higher wins new assignments".

Defaults taken without asking: weight inputs dimmed (still editable) when the strategy isn't Weighted split; backend strategy names shown as small mono text under the friendly labels; unknown availability shown with an amber ring and striped bar segments.

Implementation note: MainLayout renders routes with a location that only changes on path changes, so `useSearchParams` misses query-only updates. The real page must account for that if it uses `?profile=`-style params.
