# AI-Assisted OODA Architecture

**Status:** contracts and adapter foundation only; production execution disabled
**Updated:** 30 July 2026

## Decision

Firewatch will use AI for a cited **orientation draft**, not as an autonomous
incident commander:

```text
Observe  deterministic, persisted evidence
   ↓
Orient   AI-generated, cited, non-authoritative draft
   ↓
Decide   authenticated human review
   ↓
Act      deterministic publication and delivery rules
```

An OpenRouter key does not activate the loop. `OPENROUTER_OODA_ENABLED` remains
`false` until a reviewed model/provider policy, cost ceiling, evidence bundle,
audit ledger, and reviewer workflow all exist.

## Allowed output

The first contract in [`lib/assist`](../lib/assist) can summarize a bounded
web-feed evidence bundle into:

- a short situation statement;
- noteworthy official, sensor, weather, publisher, or source-health changes;
- explicit conflicts;
- missing, stale, unavailable, or unconfigured information;
- questions for a human reviewer; and
- limitations.

Every claim must cite an immutable evidence ID from the exact input manifest.
The server rejects unknown references, extra fields, malformed output, and a
conservative set of obvious or modal public-action wording. That text filter is
only defense in depth, not a complete safety classifier; the model remains
reviewer-only and has no publication authority.

The model cannot output or decide `protectiveAction`, `officialStatus`,
`notificationEligible`, `route`, `perimeter`, `allClear`, or personalized
move/stay advice. It receives no tool access, browsing capability, raw user
prompt, user location, upstream credential, or database credential.

## Evidence bundle

The future runner builds an `OodaEvidenceBundle` deterministically from one
incident, one immutable AOI version, one snapshot, and explicit `asOf` and
`knownAt` cutoffs. It includes only accepted, incident-linked, license-approved
excerpts plus structured source-health states. Raw HTML, full upstream
responses, arbitrary URLs, and unmoderated user content remain outside the
model boundary.

Feed text is untrusted data. The adapter puts fixed rules in a system message
and the bundle in a separate, clearly delimited JSON user message. Structured
output is still locally validated; provider enforcement is defense in depth,
not the authority boundary.

## OpenRouter boundary

The adapter uses native server-side `fetch` and:

- the exact `openrouter/free` route, never `openrouter/auto` or a paid model;
- rejection of any response whose resolved model is not a `:free` variant or
  whose reported cost is non-zero;
- a provider allowlist;
- strict JSON Schema output with parameter-compatible routing;
- zero-data-retention routing and providers that deny data collection;
- no tools, plugins, web search, streaming, or response healing;
- input, output, response-size, token, and timeout bounds;
- safe error classes without upstream response bodies; and
- generation/model/provider/token/cost metadata for later reconciliation.

OpenRouter documents [strict structured outputs](https://openrouter.ai/docs/guides/features/structured-outputs),
[the free-model router](https://openrouter.ai/docs/guides/routing/routers/free-router),
[provider routing and privacy controls](https://openrouter.ai/docs/guides/routing/provider-selection),
[per-request zero data retention](https://openrouter.ai/docs/guides/features/zdr),
and its [error and retry contract](https://openrouter.ai/docs/api/reference/errors-and-debugging).

The free router randomly selects from currently available free models, then
reports the actual model used. Its availability, latency, and output quality
can vary, so this lane is suitable only for low-volume reviewer drafts and must
fail closed rather than fall through to a paid route. Use a dedicated API key
with its own OpenRouter hard limit. None of the variables may use a
`NEXT_PUBLIC_` prefix. Never paste the key into source, issues, logs, or chat.

## Cost policy

- Never call a model on page views, browser polling, or each upstream poll.
- Trigger at most once per unique persisted material change or explicit
  authenticated operator request.
- Before enabling, start at four attempts per incident/hour, 8k input tokens,
  800 completion tokens, an OpenRouter hard limit on the dedicated key, and a
  $10/month transactional local ledger cap.
- Reserve maximum cost transactionally before the network call, then reconcile
  actual cost afterward.
- Invalid or uncited output is a failed run and is not silently “repaired.”
- A retryable provider failure is requeued; a serverless request never sleeps
  through a long `Retry-After` interval.

## Later private database slice

Add a private `assist` schema only after incident evidence is persisted:

- immutable prompt releases, runs, candidates, reviews, and usage entries;
- mutable lease-fenced job state only;
- a no-login, `NOBYPASSRLS` `firewatch_ai_worker` capability;
- a narrow security-invoker evidence-bundle projection;
- forced RLS and no `anon`, `authenticated`, or `service_role` mutation; and
- one separately provisioned serverless login through Supavisor transaction
  pooling.

The worker may never mutate `core`, `ingest`, `truth`, publications, or outbox.
Human review is append-only. Approved text still enters the existing
deterministic publication gate rather than being published by the model.

## Production gates

1. Persisted v3 incident evidence and material changes are live.
2. Each source endpoint has an explicit model-processing/license decision.
3. The allowed provider set and a representative sample of free-router models
   pass offline citation, safety, multilingual, stale-source, conflict, and
   prompt-injection fixtures; every run records the resolved model/provider.
4. Dedicated key hard limits and the database reservation ledger agree.
5. Operator authentication, membership, review UI, retention, and audit export
   are approved.
6. Shadow runs demonstrate that no candidate enters a public feed without a
   recorded human decision.
