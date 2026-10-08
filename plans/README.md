# Pickup guide: subscription selection and management dashboard

[Tracking issue](https://github.com/dhruvkelawala/CLIProxyAPI/issues/5) · [This fork](https://github.com/dhruvkelawala/Cli-Proxy-API-Management-Center) · [Other repository](https://github.com/dhruvkelawala/CLIProxyAPI)

The goal is a dashboard control that enforces the selected subscription at CLIProxyAPI. Both subscriptions can stay enabled. An Only policy fails when its target is unavailable; another subscription never silently substitutes. T3 source stays unchanged.

## Start here

[CPA-004](https://github.com/dhruvkelawala/Cli-Proxy-API-Management-Center/issues/1) is ready now for Accounts presentation. [CPA-005](https://github.com/dhruvkelawala/Cli-Proxy-API-Management-Center/issues/2) is the required subscription-selection control; it waits for the server contract/enforcement in CPA-002/003.

Use `sumo/main` as the base for a new ticket branch. The plan linked from each issue is self-contained: read its scope, drift check and stop conditions before editing. Dependencies must be done before dependent implementation. Tickets are open, unassigned and in the Subscription selection and dashboard v1 milestone.

## Backlog

| Ticket | Work | Repository | Depends on | Status |
|---|---|---|---|---|
| [CPA-001](https://github.com/dhruvkelawala/CLIProxyAPI/issues/1) | Prove strict client account routing with an isolated recording fixture | Backend | Ready now | TODO |
| [CPA-002](https://github.com/dhruvkelawala/CLIProxyAPI/issues/2) | Add durable client profiles and a v8 management contract | Backend | CPA-001 | TODO |
| [CPA-003](https://github.com/dhruvkelawala/CLIProxyAPI/issues/3) | Enforce the selected subscription across retries, helpers, streams and WebSockets | Backend | CPA-001, CPA-002 | TODO |
| [CPA-004](https://github.com/dhruvkelawala/Cli-Proxy-API-Management-Center/issues/1) | Make account labels, enablement, availability and preference clear | Dashboard | Ready now | IN REVIEW (branch `cpa-004-account-presentation`) |
| [CPA-005](https://github.com/dhruvkelawala/Cli-Proxy-API-Management-Center/issues/2) | Let the dashboard choose and enforce a subscription for each client | Dashboard | CPA-002, CPA-003, CPA-004 | IN REVIEW (branch `cpa-005-client-routes`; E2E proof pending CPA-003) |
| [CPA-006](https://github.com/dhruvkelawala/Cli-Proxy-API-Management-Center/issues/3) | Make account and client-route controls accessible in both themes | Dashboard | CPA-004, CPA-005 | IN REVIEW (branch `cpa-006-accessibility-part2`; part 1 merged in #5; browser proof recorded) |
| [CPA-007](https://github.com/dhruvkelawala/CLIProxyAPI/issues/4) | Package pinned releases and configure both Macs through existing T3 instances | Backend | CPA-001, CPA-002, CPA-003, CPA-004, CPA-005, CPA-006 | TODO |
| [CPA-008](https://github.com/dhruvkelawala/Cli-Proxy-API-Management-Center/issues/4) | Expose shared load-balancing strategies with priority, weights and session affinity | Dashboard | CPA-004, CPA-005, CPA-006 | TODO |

This repository's ticket copies are in this directory. `TICKETS.json` mirrors the cross-repository index. Update statuses here and in the tracking issue when work lands; close the individual issue with implementation evidence.

## Source baseline and remotes

- This checkout starts from v1.25.4, commit `6abace9ffb83a9ac349464ded04bb4e7f7cb309e`.
- `origin` is this fork; `upstream` is router-for-me's original repository.
- `sumo/main` is the fork development base; topic PRs should target it.
- Retain Go module identity and upstream license/attribution.

To start a ticket after confirming the working tree is clean:

```sh
git fetch origin
git switch sumo/main
git pull --ff-only origin sumo/main
git switch -c cpa-ticket-topic
```

Fetch upstream deliberately when preparing an upgrade. Do not overwrite the fork branch with upstream or automatically follow every release. Re-run subscription-enforcement proof after rebases.

## Development commands

Bun 1.3.14 is pinned by the repository, and CI uses Node 24. Dependencies are already installed in this local checkout. Use the pinned runtime without replacing the host's global Bun:

```sh
bunx bun@1.3.14 install --frozen-lockfile
bunx bun@1.3.14 run verify
bunx bun@1.3.14 run dev --host 127.0.0.1 --port 18769 --strictPort
```

The T3 project has Install, Verify and Dashboard development preview actions. The preview is frontend-only until connected to a disposable backend fixture. `dashboard-concept.html` is an illustration, not implemented account-routing behavior; its Prefer option is exploratory and deferred from release 1.

## Product boundaries

Release 1 is Automatic plus Only a named subscription, with provider-specific client policies. Profile scope is all matching requests using that client identity; dedicated T3 provider instances can separate thread choices. Stock/native auxiliary generation and explicit other-provider delegates remain separate. Do not claim that a configured target proves the account that served a past request.

The proxy and custom panel are separate artifacts. The deployment to support later is one Mini gateway plus the MacBook's existing localhost tunnel. No production cutover, credential change, subscription re-enable, or T3 configuration change was made during setup. CPA-007 owns staging, both-machine checks and rollback before an authorized cutover.

## Verified during setup

See [BASELINE.md](BASELINE.md). Backend tests/build passed. Dashboard passed 1,493 tests, lint and TypeScript/production build. Source and workflows remain upstream-identical at this point; only plans and the illustrative concept were added. The proposed subscription enforcement is still TODO.

## Approved load-balancing follow-up

[CPA-008](https://github.com/dhruvkelawala/Cli-Proxy-API-Management-Center/issues/4) collects the existing global round-robin, weighted-round-robin and fill-first strategies, account priority/weights and session affinity into one clear routing flow. Pick it up after CPA-005/006; strict subscription selection remains first. It is an optional follow-up and does not block the core rollout in CPA-007.

Global strategy changes affect Automatic clients across provider pools on the shared gateway, including both Macs. Only profiles remain strict. Preserve saved defaults on upgrade. Per-client/provider pools and strategy overrides, quota-aware routing and least-busy routing are deferred; they need separate backend contracts or reliable telemetry.
