# Stage 1.5 — isolated prototype plan and test design

## Scope and approval boundary

Prepare a disposable research prototype only after separate approval. No production integration, production records, Supabase changes, migrations, secrets, bridge changes, strategy changes, publishing, deployment or trading. All synthetic signals and outcomes remain **UNVALIDATED**; preserve `is_demo=true`. Do not import or backfill legacy records.

A separate database test environment has **not been verified or provisioned**. The architecture, code contract and tests below are proposals, not implemented safeguards or completed tests. Creating this plan does not authorize running the prototype.

**Verified repository facts:** `src/routes/api/public/bridge/ingest.ts` records replay IDs before separate market writes and overwrites candle projections; `src/lib/signal-store.server.ts` separately reads candles/tick and saves signals without immutable input manifests. `src/lib/signal-outcomes.ts` requires aligned creation/expiry and full closed coverage, with 24-hour/2,048-bar limits. Existing Vitest configuration establishes no disposable database lifecycle. These are code findings, not verification of deployed database behavior.

## 1. Test architecture

Use a separate source directory and disposable PostgreSQL instance on an isolated runner, not the current app, Preview or production Supabase. Use Vitest for deterministic unit/contract tests and two independent PostgreSQL connections for real transaction/race tests. An in-memory store can test state transitions but cannot prove PostgreSQL locking, rollback or concurrency.

Copy only the pure evaluator, engine and their browser-safe dependencies into the prototype; record source hashes. Do not import the production route, signal-store module, generated clients, authentication configuration or app bootstrap. An isolated adapter supplies the unchanged engine with the exact stored input snapshot and fixed evaluation time. Do not connect the evaluator to current signal saving.

Proposed test-only storage:
- Committed upload receipts with unique request ID, raw-body hash, validation version and accepted UTC time.
- Immutable candle versions and upload-to-version links; current-version projection.
- Quotes referenced by synthetic signals: exact bid, ask, tick time and accepted-upload reference.
- Synthetic signal input manifests: ordered M5/M15 version IDs, quote ID, original engine output, evaluation time, effective configuration, source-code/strategy version and snapshot hash.
- Final results, evidence manifest and durable review/retry state. Unique final result per synthetic signal.

Provisioning scripts, if later approved, operate **only** on the disposable instance; they are not app migrations. Tests use barriers and a fake clock, not timing sleeps or live market feeds.

### Isolation acceptance checks

Before any write, require an explicit test-environment flag, a random run-specific database name and matching database sentinel. A name or flag alone is insufficient. Use only a newly created restricted test role; allow connections only to that disposable database. Run without inherited app credentials and deny network access to Supabase, the published/Preview app and brokers. Separate test-only signing material must never reuse the real HMAC secret.

Allow outbound traffic only for provisioning dependencies before tests; during tests use a network-isolated runner with the database as its sole peer. Capture connection destinations without credentials. Verify fixture-only record IDs, zero external HTTP calls, unchanged application-file hashes before/after, and destruction of the disposable instance afterward. Fail closed if the destination or isolation checks cannot be verified. No production query is needed to verify isolation.

## 2. Required fixtures

All fixtures are explicitly synthetic, not fabricated live signals:

- Fixed UTC clock; aligned M5/M15 opening times, plus signals created between M5 boundaries. Include equivalent timestamps with explicit offsets and invalid timestamps.
- At least 60 closed M15 and 50 closed M5 bars for engine reproducibility, a fresh synthetic quote, and unchanged engine settings. Use reviewed deterministic inputs that genuinely qualify under the existing rules; otherwise expect NO_TRADE, never force an engine signal.
- BUY: entry 2000, SL 1990, TP1 2020. SELL: entry 2000, SL 2010, TP1 1980. Full-window target hits yield +2R; exact stop hits yield -1R. Adverse opening gaps may yield less than -1R. Target gaps do not invent improved fills.
- Complete no-touch expiry returns no exit price or R; never invent an expiry fill. Hit timestamps represent candle close, not known intrabar execution time.
- Exact touches, both-level touches, symmetric gaps, malformed/conflicting duplicates, corrected versions before/after finalization.
- Complete creation-to-expiry closed-M5 coverage; missing first/middle/last bars; late arrivals; still-forming bars; off-grid creation; unknown provenance; preserved `is_demo=true` legacy-like exclusion fixtures.
- Identical raw request bytes, semantically equivalent but differently encoded payloads, reused IDs with changed bytes, invalid authentication and failure injection at each write step.

Every expected result must reference concrete fixture values and the current evaluator contract. Coverage is checked for the entire required window **before** any terminal TP1/SL/expiry estimate, including malformed evidence after an apparent early hit.

## 3. Test cases and expected results

| Test | Injection / operation | Expected invariant and recovery |
|---|---|---|
| Atomic acceptance | Fail after receipt, candle version, quote, links or projection write, before commit | Transaction leaves none of that upload committed. Previous state remains intact. Retry commits one complete receipt/evidence set. |
| Lost acknowledgement | Commit succeeds; response is dropped | Same ID/body returns the committed acknowledgement; no second application. Outcome retry work remains discoverable even when receipt handling short-circuits. |
| Identical retry | Sequential and concurrent same ID/raw bytes | Exactly one receipt and one application. Other requests return the same result. |
| Conflicting request ID | Same ID with changed raw bytes | Reject conflict without changing committed evidence. Concurrent conflicting first submissions have one winner, never mixed data. |
| Signature age and content dedupe | Original signature expires; submit fresh ID with same validated candle content | Expired signature rejected. Fresh authenticated upload may create a new receipt/link but no duplicate candle version or signal; hashes are checked against content. |
| Immutable corrections | Upload same candle key with altered OHLC | Append a version; original remains unchanged. Exact duplicate content reuses its version. Arrival order never silently decides which conflicting content is authoritative. |
| Ambiguous correction order | Old upload arrives after a correction, with no trustworthy revision sequence | Mark disputed/unresolved and block affected finalization. Require an approved ordering contract; do not assume receipt time proves market correctness. |
| Reproducible snapshot | Regenerate from pinned IDs/config/time/quote after projections advance | Identical unchanged-engine output and reasons. Missing/modified evidence or mismatched hashes blocks generation/finalization. No latest-row substitution. |
| Snapshot capture race | Correction occurs while inputs are read | Snapshot contains one consistent selected version set and exactly the values used by the engine. Transactional capture or validated manifest retry prevents mixed/replaced inputs. |
| Quote ordering race | Older and newer tick uploads commit in reversed order | Preserve both signal-used quotes; latest projection never regresses by tick time. Conflicting equal-time quotes require a defined conflict policy, not arbitrary overwrite. |
| Missing/delayed coverage | Remove a middle candle, then deliver it late | Initially INCOMPLETE, no final row. Arrival triggers retry using market-time order; only complete closed coverage permits a terminal estimate. |
| Unclosed/invalid evidence | Clock before bar close; invalid/conflicting bar after an apparent hit | No confirmed win/loss/expiry. Invalid evidence is rejected or deferred with a durable reason; it is not skipped. |
| Partway-M5 creation | Create 10:02 UTC; next bar opens 10:05; possible 10:02–10:05 touch | Do not count the 10:00 bar, round creation backward or extend original expiry. Full original-window outcome remains INCOMPLETE with M5-only evidence, even if later bars hit a level. |
| Expiry interaction | Validity deadline passes while coverage is missing | Validity ending is distinct from outcome finalization. No fabricated expired outcome. Retry eligibility remains durable after signal validity ends. Existing production expiry code is not changed. |
| Atomic finalization | Inject failure after outcome insert but before status update | Both roll back. Retry produces one matching result/status pair; lost response is resolved by reading existing committed result. |
| Concurrent finalizers | Two workers pause at the same signal lock | One immutable final result; loser reads it. Different proposed evidence cannot overwrite it. |
| Revision/finalizer race | Force correction commit before/after finalizer evidence check | Shared locks/version validation produce a defined order. Correction first: retry/review before saving. Finalization first: preserve result/evidence and persist review-required flag; never silently overwrite. |
| Generation-input correction | Revise a candle pinned to signal generation | Preserve original signal snapshot; flag its premise as revised and prevent unqualified automatic finalization pending approved adjudication policy. |
| Restart/outage | Kill worker before commit, after commit or before retry acknowledgement | Resume from durable eligible/retry state. No memory-only progress or busy infinite loop. Bounded batches and backoff; no uploads means ingestion-driven retries pause. |
| Unknown lineage | Synthetic legacy-like signal with no evidence manifest | Excluded; no backfill or `is_demo` promotion. Caller provenance string alone never authorizes a final result. |
| Retention/quota | Prune referenced/unreferenced evidence; exceed limits | Referenced evidence cannot be deleted. Quota refusal is atomic/retryable; no partial acceptance or eviction that makes results unauditable. |

Race tests must assert database rows and evidence hashes, not only returned promises. Repeat deterministic interleavings with both worker orders. A transaction commit covers upload acceptance only; post-commit signal/outcome processing failures need a durable work record and retry tests, not rollback claims about an already committed upload.

## 4. Timing, SELL estimates and evidence retention

Use UTC instants and M5 opening times with explicit five-minute close boundaries; fixed caller-supplied now. Preserve original creation/expiry. The current evaluator's strict aligned-window rule is not changed: ordinary partway-created signals cannot receive full-window outcomes from M5-only observations. Show separate synthetic History reasons for missing coverage, awaiting close, validity ended/incomplete, excluded lineage and revision review.

SELL bid-candle TP1/SL estimates do not establish historical ask-side fills, spread, fees or slippage. Preserve the UNVALIDATED bid-candle limitation in every test result. Never describe R as executed or net profit.

Minimum evidence: committed authenticated receipts, hashes plus immutable validated candle values and upload links, signal-used quotes and exact ordered generation manifests, finalization manifests and decision/config/code versions. Store evidence-validation versions; a hash or source label alone proves neither input values nor that MT5 itself was truthful. Full raw payload retention is not required when all relevant validated evidence is reconstructible; use raw synthetic payloads only for retry/parser tests.

Provisional prototype limits, subject to measurement: retain the evaluator's 24-hour window and 2,048 input-bar ceiling; generation fixtures capped at 300 bars per timeframe; 1 MiB raw test payload; 100 pending signals per work batch; 100 MiB test database budget. Refuse larger work without partial writes; never truncate required coverage. These are prototype safety limits, not changes to the bridge or strategy.

Pin all evidence referenced by a signal, final result or review case. Simulate 30-day retention for unreferenced committed receipts/versions, retaining request-ID conflict tombstones for the approved replay/audit horizon. Prune only when links and required receipt metadata remain reconstructible. Measure bytes per receipt/version/snapshot and duplicate-upload growth; exceeding retention/budget expectations is a design blocker, not permission to discard pinned evidence. No personal data, broker passwords or real payloads are needed.

## 5. Proposed files and code contract — not created

Separate prototype directory only:

```text
prototype/
  README.md
  isolation-guard.ts
  contracts.ts
  upload-store.ts
  evidence-store.ts
  snapshot-adapter.ts
  finalization-store.ts
  retry-worker.ts
  fixtures.ts
  tests/{isolation,uploads,versions,snapshots,coverage,races,recovery,retention}.test.ts
  vendor/                  # reviewed copies of unchanged pure modules
```

Illustrative API contract for later review, not executable implementation:

```ts
interface PrototypeStore {
  acceptUpload(input: AuthenticatedTestUpload): Promise<CommittedReceipt>;
  captureInputs(input: SyntheticGenerationRequest): Promise<PinnedManifest>;
  finalize(input: EvidenceBoundDecision): Promise<SavedOrDeferred>;
  pendingWork(limit: number): Promise<RetryItem[]>;
}
// acceptUpload: verify test signature, bind request ID to raw-body hash,
// then commit receipt + immutable evidence + links + projection + retry work.
// captureInputs: pin exactly what the unchanged engine receives.
// finalize: lock signal AND relevant revision state, verify full coverage,
// provenance and unchanged evidence; insert one result + status atomically.
// UNKNOWN/INCOMPLETE: persist retry/review reason, not a terminal outcome.
```

No proposed production file changes or executable SQL are part of this stage.

## 6. Implementation sequence and go/no-go gates

1. **Approve test contract and isolated runner.** No-go without verifiable credential/network isolation or agreement that M5-only partial windows remain incomplete.
2. **Build pure fixture/contract tests.** Go only with unchanged engine/evaluator hashes, deterministic concrete assertions and no live-data claims.
3. **Build disposable PostgreSQL prototype.** Go only after atomic acceptance, replay, snapshot and failure tests pass against a real database; mocks are insufficient.
4. **Exercise concurrency, corrections and recovery.** No-go if any interleaving produces mixed evidence, duplicate final rows, half-finalized states or stranded retries.
5. **Measure retention and review synthetic History output.** No-go if evidence cannot reconstruct decisions, pinned data can be pruned, or labels suggest real/executed/complete outcomes.
6. **Report evidence and destroy environment.** Provide test counts/results, failures, source/isolation checks and storage measurements. Any production design, integration or deployment requires another explicit approval.

Rollback is deletion of the disposable runner/database and prototype directory. It must never involve restoring or modifying Gold Scalp Wizard, because the prototype must not touch it.

**Current result:** plan prepared only; no prototype environment, tests or integration executed. Await approval before implementation.