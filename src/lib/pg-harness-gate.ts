/** Phase 2H: pure, deterministic, FAIL-CLOSED gate for a FUTURE disposable PostgreSQL integration-test harness.
 * Not wired to any caller. Reads ONLY its explicit argument: no process.env, files, network, database, shell,
 * clock or randomness. It never connects, provisions, runs SQL or tears anything down.
 *
 * RESULTS: only BLOCKED (fixed reason code) or READY_FOR_APPROVAL. READY_FOR_APPROVAL means the supplied
 * declarations are internally consistent enough for HUMAN REVIEW. It is NOT safe-to-connect, verified, authorised,
 * safe-to-provision, safe-to-delete or safe-to-run-SQL. Every authorisation flag is always false.
 *
 * BOOTSTRAP TRUST PROBLEM: a loopback address can be tunnelled/forwarded to a production database, and querying a
 * database after connecting cannot retroactively prove the initial connection was safe. Instance ownership must be
 * established OUTSIDE PostgreSQL, independently, before any connection. Nothing here can do that.
 *
 * LIMITATIONS (by design):
 * - Passing unit tests does not prove disposable PostgreSQL isolation.
 * - The provisioning manifest is only a self-reported declaration; nonce, timestamp, process/container ID and port
 *   are never proof of ownership or isolation. No signatures are generated or verified.
 * - The environment check covers a caller-supplied list of NAMES only; it cannot prove the real process environment
 *   is clean (the snapshot may omit inherited credentials). Values are never accepted or returned.
 * - A structurally valid teardown plan is not deletion authorisation.
 * - Input is copied once via own-property descriptors (getters never invoked). A JS Proxy cannot be detected by pure
 *   code; its traps may run during that single copy, but all checks then use the frozen copy only.
 * - A separately approved connection gate is still required. Provisioning, SQL execution, integration testing and
 *   teardown each require separate approval.
 */
import { validateDisposableDbTarget } from "./test-db-target-guard";

export const PG_GATE_CONFIG_VERSION = 1 as const;
export const PG_GATE_MANIFEST_VERSION = 1 as const;
export const PG_GATE_TEARDOWN_VERSION = 1 as const;
/** Run ID: 8–32 lowercase letters/digits, identical to the Phase 2F database-name suffix. */
export const PG_GATE_RUN_ID = /^[a-z0-9]{8,32}$/;
/** Positive allowlist of environment variable NAMES for the proposed harness. Everything else BLOCKS. */
export const PG_GATE_ENV_ALLOWLIST = Object.freeze([
  "GSW_PG_HARNESS", "GSW_PG_HARNESS_CONFIG", "PATH", "HOME", "TMPDIR", "TZ", "LANG", "NODE_ENV",
] as const);
/** Diagnostic only (gives a clearer reason); the allowlist alone already rejects these. */
const FORBIDDEN_ENV_PATTERNS: readonly RegExp[] = [
  /SUPABASE/, /DATABASE_URL/, /POSTGRES/, /^PG[A-Z_]*$/, /BRIDGE/, /MT5/, /EXNESS/, /SERVICE_ROLE/,
  /SECRET/, /TOKEN/, /PASSWORD/, /PASSWD/, /API_?KEY/, /CREDENTIAL/, /_URL$/, /_DSN$/, /CONNECTION/,
];
const ID = /^[a-z0-9][a-z0-9._-]{7,63}$/;
const ENV_NAME = /^[A-Z_][A-Z0-9_]{0,63}$/;
const MAX_ENV_NAMES = 64;
const MAX_RESOURCES = 4;
const MAX_STRING = 256;
const MAX_NODES = 256;
const MAX_MS = 8.64e15;
const PROVISIONING_OWNER = "test_harness_provisioner" as const;
const TEARDOWN_OWNER = "test_harness" as const;

const TOP_KEYS = ["version", "runId", "target", "environmentNames", "manifest", "teardown"];
const MANIFEST_KEYS = ["version", "runId", "environmentId", "instanceId", "databaseName", "processIdentity", "host",
  "port", "nonceId", "createdAtMsc", "provisioningEvidenceRef", "provisioningOwner", "teardownOwner"];
const PROCESS_KEYS = ["kind", "id"];
const TEARDOWN_KEYS = ["version", "runId", "instanceId", "databaseName", "resources", "ownership",
  "independentOwnershipVerificationRequired", "owner"];
const RESOURCE_KEYS = ["kind", "id"];
const EXECUTABLE_KEYS = ["sql", "command", "commands", "script", "shell", "exec", "statement", "statements", "query"];
const SHARED_RESOURCE_KINDS = ["volume", "network", "image", "cluster", "host", "bucket", "schema", "role", "all"];

export type PgGateReason =
  | "NOT_AN_OBJECT" | "INHERITED_OR_EXOTIC_OBJECT" | "ACCESSOR_FIELD" | "SYMBOL_KEY" | "UNEXPECTED_FIELD"
  | "MISSING_FIELD" | "INPUT_TOO_LARGE" | "INVALID_FIELD_TYPE" | "STRING_TOO_LONG" | "UNSUPPORTED_VERSION"
  | "INVALID_RUN_ID"
  | "TARGET_REJECTED" | "TARGET_RUN_MISMATCH"
  | "INVALID_ENV_SNAPSHOT" | "ENV_NAME_MALFORMED" | "ENV_NAME_DUPLICATE" | "ENV_FORBIDDEN_NAME" | "ENV_NAME_NOT_ALLOWED"
  | "ENV_HARNESS_FLAG_MISSING"
  | "INVALID_MANIFEST" | "UNSUPPORTED_MANIFEST_VERSION" | "MANIFEST_RUN_MISMATCH" | "MANIFEST_ENVIRONMENT_MISMATCH"
  | "MANIFEST_INSTANCE_MISMATCH" | "MANIFEST_DATABASE_MISMATCH" | "MANIFEST_HOST_MISMATCH" | "MANIFEST_PORT_MISMATCH"
  | "MANIFEST_EVIDENCE_MISMATCH" | "MANIFEST_INVALID_PROCESS_IDENTITY" | "MANIFEST_INVALID_NONCE"
  | "MANIFEST_INVALID_TIMESTAMP" | "MANIFEST_INVALID_OWNER" | "MANIFEST_IDENTIFIER_REUSE"
  | "TEARDOWN_MISSING" | "TEARDOWN_EXECUTABLE_CONTENT" | "INVALID_TEARDOWN" | "UNSUPPORTED_TEARDOWN_VERSION"
  | "TEARDOWN_RUN_MISMATCH" | "TEARDOWN_INSTANCE_MISMATCH" | "TEARDOWN_DATABASE_MISMATCH" | "TEARDOWN_WILDCARD_SCOPE"
  | "TEARDOWN_SHARED_RESOURCE" | "TEARDOWN_UNRECOGNISED_RESOURCE" | "TEARDOWN_RESOURCE_MISMATCH"
  | "TEARDOWN_DUPLICATE_RESOURCE" | "TEARDOWN_DATABASE_RESOURCE_REQUIRED" | "TEARDOWN_OWNERSHIP_UNDECLARED"
  | "TEARDOWN_VERIFICATION_NOT_REQUIRED" | "TEARDOWN_INVALID_OWNER";

export type PgGateStage = "INPUT" | "RUN_ID" | "TARGET" | "ENVIRONMENT" | "MANIFEST" | "TEARDOWN";

export type PgGateRequirement =
  | "VERIFY_INSTANCE_OWNERSHIP_OUT_OF_BAND" | "VERIFY_NO_LOOPBACK_TUNNEL" | "VERIFY_REAL_PROCESS_ENVIRONMENT"
  | "VERIFY_PROVISIONING_EVIDENCE" | "VERIFY_DATABASE_IDENTITY_AND_EMPTINESS" | "VERIFY_LEAST_PRIVILEGE_TEST_ROLE"
  | "VERIFY_TEARDOWN_RESOURCE_OWNERSHIP" | "HUMAN_APPROVAL_FOR_CONNECTION" | "HUMAN_APPROVAL_FOR_PROVISIONING"
  | "HUMAN_APPROVAL_FOR_SQL" | "HUMAN_APPROVAL_FOR_TEARDOWN";

export type PgGateDeclaration =
  | "RUN_ID" | "TARGET_ATTESTATION" | "ENVIRONMENT_NAME_SNAPSHOT" | "PROVISIONING_MANIFEST" | "PROCESS_IDENTITY"
  | "NONCE" | "CREATION_TIMESTAMP" | "TEARDOWN_PLAN";

type Flags = {
  connectionAuthorized: false; provisioningAuthorized: false; destructiveSqlAuthorized: false;
  teardownAuthorized: false; isolationVerified: false; unvalidated: true;
};
const FLAGS: Flags = Object.freeze({
  connectionAuthorized: false, provisioningAuthorized: false, destructiveSqlAuthorized: false,
  teardownAuthorized: false, isolationVerified: false, unvalidated: true,
}) as Flags;

export type PgHarnessGateResult = Flags & (
  | { status: "BLOCKED"; stage: PgGateStage; reason: PgGateReason }
  | {
      status: "READY_FOR_APPROVAL";
      reason: "DECLARATIONS_CONSISTENT";
      /** Everything accepted is self-reported. */
      selfReported: readonly PgGateDeclaration[];
      /** Always empty: this pure gate cannot independently establish any fact. */
      independentlyEstablished: readonly never[];
      outstanding: readonly PgGateRequirement[];
    });

const SELF_REPORTED: readonly PgGateDeclaration[] = Object.freeze(["RUN_ID", "TARGET_ATTESTATION",
  "ENVIRONMENT_NAME_SNAPSHOT", "PROVISIONING_MANIFEST", "PROCESS_IDENTITY", "NONCE", "CREATION_TIMESTAMP",
  "TEARDOWN_PLAN"]);
const OUTSTANDING: readonly PgGateRequirement[] = Object.freeze(["VERIFY_INSTANCE_OWNERSHIP_OUT_OF_BAND",
  "VERIFY_NO_LOOPBACK_TUNNEL", "VERIFY_REAL_PROCESS_ENVIRONMENT", "VERIFY_PROVISIONING_EVIDENCE",
  "VERIFY_DATABASE_IDENTITY_AND_EMPTINESS", "VERIFY_LEAST_PRIVILEGE_TEST_ROLE", "VERIFY_TEARDOWN_RESOURCE_OWNERSHIP",
  "HUMAN_APPROVAL_FOR_CONNECTION", "HUMAN_APPROVAL_FOR_PROVISIONING", "HUMAN_APPROVAL_FOR_SQL",
  "HUMAN_APPROVAL_FOR_TEARDOWN"]);
const EMPTY: readonly never[] = Object.freeze([]);

const blocked = (stage: PgGateStage, reason: PgGateReason): PgHarnessGateResult =>
  Object.freeze({ ...FLAGS, status: "BLOCKED", stage, reason });

class Fail { constructor(readonly reason: PgGateReason) {} }
type Snap = string | number | boolean | null | readonly Snap[] | { readonly [k: string]: Snap };

/** One-pass copy: plain objects/arrays only, own string keys, data properties only; getters never invoked. */
function snapshot(v: unknown, depth: number, budget: { n: number }): Snap {
  if (--budget.n < 0 || depth > 5) throw new Fail("INPUT_TOO_LARGE");
  if (v === null || typeof v === "boolean") return v;
  if (typeof v === "number") return v;
  if (typeof v === "string") { if (v.length > MAX_STRING) throw new Fail("STRING_TOO_LONG"); return v; }
  if (typeof v !== "object") throw new Fail("INVALID_FIELD_TYPE");
  const isArr = Array.isArray(v);
  const proto = Object.getPrototypeOf(v);
  if (isArr ? proto !== Array.prototype : proto !== Object.prototype && proto !== null)
    throw new Fail("INHERITED_OR_EXOTIC_OBJECT");
  const keys = Reflect.ownKeys(v);
  if (keys.some((k) => typeof k !== "string")) throw new Fail("SYMBOL_KEY");
  if (isArr) {
    const ld = Object.getOwnPropertyDescriptor(v, "length");
    if (!ld || !("value" in ld) || typeof ld.value !== "number") throw new Fail("INHERITED_OR_EXOTIC_OBJECT");
    const len = ld.value;
    if (keys.length !== len + 1) throw new Fail("INHERITED_OR_EXOTIC_OBJECT"); // holes or extra keys
    const out: Snap[] = [];
    for (let i = 0; i < len; i++) {
      const d = Object.getOwnPropertyDescriptor(v, String(i));
      if (!d) throw new Fail("INHERITED_OR_EXOTIC_OBJECT");
      if (!("value" in d)) throw new Fail("ACCESSOR_FIELD");
      out.push(snapshot(d.value, depth + 1, budget));
    }
    return Object.freeze(out);
  }
  const out: Record<string, Snap> = Object.create(null);
  for (const k of keys as string[]) {
    if (k.length > 64) throw new Fail("UNEXPECTED_FIELD");
    const d = Object.getOwnPropertyDescriptor(v, k);
    if (!d) throw new Fail("MISSING_FIELD");
    if (!("value" in d)) throw new Fail("ACCESSOR_FIELD");
    out[k] = snapshot(d.value, depth + 1, budget);
  }
  return Object.freeze(out);
}

type Obj = { readonly [k: string]: Snap };
const isObj = (s: Snap | undefined): s is Obj => typeof s === "object" && s !== null && !Array.isArray(s);
function exact(s: Snap | undefined, keys: readonly string[], notObj: PgGateReason): Obj {
  if (!isObj(s)) throw new Fail(notObj);
  const own = Object.keys(s);
  if (own.some((k) => !keys.includes(k))) throw new Fail("UNEXPECTED_FIELD");
  if (keys.some((k) => !(k in s))) throw new Fail("MISSING_FIELD");
  return s;
}
const str = (o: Obj, k: string, re: RegExp, bad: PgGateReason): string => {
  const v = o[k];
  if (typeof v !== "string" || !re.test(v)) throw new Fail(bad);
  return v;
};

/** Thaws the frozen null-prototype snapshot into plain objects for the Phase 2F guard (which requires exact keys). */
function plain(s: Snap): unknown {
  if (Array.isArray(s)) return s.map(plain);
  if (isObj(s)) { const o: Record<string, unknown> = {}; for (const k of Object.keys(s)) o[k] = plain(s[k] as Snap); return o; }
  return s;
}

const WILDCARD = /[*%?]|^(all|any|everything)$/i;

function checkEnvironment(names: Snap | undefined): void {
  if (!Array.isArray(names)) throw new Fail("INVALID_ENV_SNAPSHOT");
  const list = names as readonly Snap[];
  if (list.length > MAX_ENV_NAMES) throw new Fail("INVALID_ENV_SNAPSHOT");
  const seen = new Set<string>();
  for (const n of list) {
    if (typeof n !== "string" || !ENV_NAME.test(n)) throw new Fail("ENV_NAME_MALFORMED");
    if (seen.has(n)) throw new Fail("ENV_NAME_DUPLICATE");
    seen.add(n);
  }
  for (const n of seen) if (FORBIDDEN_ENV_PATTERNS.some((p) => p.test(n))) throw new Fail("ENV_FORBIDDEN_NAME");
  for (const n of seen)
    if (!(PG_GATE_ENV_ALLOWLIST as readonly string[]).includes(n)) throw new Fail("ENV_NAME_NOT_ALLOWED");
  if (!seen.has("GSW_PG_HARNESS")) throw new Fail("ENV_HARNESS_FLAG_MISSING");
}

interface TargetFacts { runId: string; db: string; environmentId: string; instanceId: string; evidenceRef: string; host: string; port: number }

function checkManifest(m: Snap | undefined, t: TargetFacts): { processKind: string; processId: string } {
  const o = exact(m, MANIFEST_KEYS, "INVALID_MANIFEST");
  if (o["version"] !== PG_GATE_MANIFEST_VERSION) throw new Fail("UNSUPPORTED_MANIFEST_VERSION");
  if (o["runId"] !== t.runId) throw new Fail("MANIFEST_RUN_MISMATCH");
  const env = str(o, "environmentId", ID, "INVALID_MANIFEST");
  const inst = str(o, "instanceId", ID, "INVALID_MANIFEST");
  const ref = str(o, "provisioningEvidenceRef", ID, "INVALID_MANIFEST");
  if (env !== t.environmentId) throw new Fail("MANIFEST_ENVIRONMENT_MISMATCH");
  if (inst !== t.instanceId) throw new Fail("MANIFEST_INSTANCE_MISMATCH");
  if (o["databaseName"] !== t.db) throw new Fail("MANIFEST_DATABASE_MISMATCH");
  if (o["host"] !== t.host) throw new Fail("MANIFEST_HOST_MISMATCH");
  if (o["port"] !== t.port) throw new Fail("MANIFEST_PORT_MISMATCH");
  if (ref !== t.evidenceRef) throw new Fail("MANIFEST_EVIDENCE_MISMATCH");
  let p: Obj;
  try { p = exact(o["processIdentity"], PROCESS_KEYS, "MANIFEST_INVALID_PROCESS_IDENTITY"); }
  catch { throw new Fail("MANIFEST_INVALID_PROCESS_IDENTITY"); }
  if (p["kind"] !== "container" && p["kind"] !== "process") throw new Fail("MANIFEST_INVALID_PROCESS_IDENTITY");
  const pid = str(p, "id", ID, "MANIFEST_INVALID_PROCESS_IDENTITY");
  const nonce = str(o, "nonceId", ID, "MANIFEST_INVALID_NONCE");
  const ts = o["createdAtMsc"];
  if (typeof ts !== "number" || !Number.isSafeInteger(ts) || ts < 0 || ts > MAX_MS) throw new Fail("MANIFEST_INVALID_TIMESTAMP");
  if (o["provisioningOwner"] !== PROVISIONING_OWNER || o["teardownOwner"] !== TEARDOWN_OWNER) throw new Fail("MANIFEST_INVALID_OWNER");
  const ids = [env, inst, ref, pid, nonce];
  if (new Set(ids).size !== ids.length) throw new Fail("MANIFEST_IDENTIFIER_REUSE");
  return { processKind: p["kind"], processId: pid };
}

function checkTeardown(td: Snap | undefined, t: TargetFacts, proc: { processKind: string; processId: string }): void {
  if (td === undefined || td === null) throw new Fail("TEARDOWN_MISSING");
  if (!isObj(td)) throw new Fail("INVALID_TEARDOWN");
  if (Object.keys(td).some((k) => EXECUTABLE_KEYS.includes(k.toLowerCase()))) throw new Fail("TEARDOWN_EXECUTABLE_CONTENT");
  const o = exact(td, TEARDOWN_KEYS, "INVALID_TEARDOWN");
  if (o["version"] !== PG_GATE_TEARDOWN_VERSION) throw new Fail("UNSUPPORTED_TEARDOWN_VERSION");
  for (const k of ["runId", "instanceId", "databaseName"]) {
    const v = o[k];
    if (typeof v === "string" && WILDCARD.test(v)) throw new Fail("TEARDOWN_WILDCARD_SCOPE");
  }
  if (o["runId"] !== t.runId) throw new Fail("TEARDOWN_RUN_MISMATCH");
  if (o["instanceId"] !== t.instanceId) throw new Fail("TEARDOWN_INSTANCE_MISMATCH");
  if (o["databaseName"] !== t.db) throw new Fail("TEARDOWN_DATABASE_MISMATCH");
  if (o["ownership"] !== "run_owned") throw new Fail("TEARDOWN_OWNERSHIP_UNDECLARED");
  if (o["independentOwnershipVerificationRequired"] !== true) throw new Fail("TEARDOWN_VERIFICATION_NOT_REQUIRED");
  if (o["owner"] !== TEARDOWN_OWNER) throw new Fail("TEARDOWN_INVALID_OWNER");
  const res = o["resources"];
  if (!Array.isArray(res) || res.length === 0 || res.length > MAX_RESOURCES) throw new Fail("INVALID_TEARDOWN");
  const seen = new Set<string>();
  let hasDb = false;
  for (const r of res as readonly Snap[]) {
    if (isObj(r) && Object.keys(r).some((k) => EXECUTABLE_KEYS.includes(k.toLowerCase()))) throw new Fail("TEARDOWN_EXECUTABLE_CONTENT");
    const ro = exact(r, RESOURCE_KEYS, "INVALID_TEARDOWN");
    const kind = ro["kind"], id = ro["id"];
    if (typeof kind !== "string" || typeof id !== "string") throw new Fail("INVALID_TEARDOWN");
    if (WILDCARD.test(kind) || WILDCARD.test(id)) throw new Fail("TEARDOWN_WILDCARD_SCOPE");
    if (SHARED_RESOURCE_KINDS.includes(kind)) throw new Fail("TEARDOWN_SHARED_RESOURCE");
    const key = `${kind}\u0000${id}`;
    if (seen.has(key) || (kind === "database" && hasDb)) throw new Fail("TEARDOWN_DUPLICATE_RESOURCE");
    seen.add(key);
    if (kind === "database") { if (id !== t.db) throw new Fail("TEARDOWN_RESOURCE_MISMATCH"); hasDb = true; }
    else if (kind === "container" || kind === "process") {
      if (kind !== proc.processKind || id !== proc.processId) throw new Fail("TEARDOWN_RESOURCE_MISMATCH");
    } else if (kind === "temp_directory") { if (id !== `gsw-run-${t.runId}`) throw new Fail("TEARDOWN_RESOURCE_MISMATCH"); }
    else throw new Fail("TEARDOWN_UNRECOGNISED_RESOURCE");
  }
  if (!hasDb) throw new Fail("TEARDOWN_DATABASE_RESOURCE_REQUIRED");
}

export function evaluatePgHarnessGate(input: unknown): PgHarnessGateResult {
  let stage: PgGateStage = "INPUT";
  try {
    const snap = snapshot(input, 0, { n: MAX_NODES });
    const top = exact(snap, TOP_KEYS, "NOT_AN_OBJECT");
    if (top["version"] !== PG_GATE_CONFIG_VERSION) throw new Fail("UNSUPPORTED_VERSION");

    stage = "RUN_ID";
    const runId = top["runId"];
    if (typeof runId !== "string" || !PG_GATE_RUN_ID.test(runId)) throw new Fail("INVALID_RUN_ID");

    stage = "TARGET";
    const targetSnap = top["target"];
    const g = validateDisposableDbTarget(plain(targetSnap as Snap));
    if (g.status !== "CANDIDATE_ONLY") throw new Fail("TARGET_REJECTED");
    // Guard passed on this same frozen copy, so these reads are exact data fields.
    const att = (targetSnap as Obj)["attestation"] as Obj;
    if (att["testRunId"] !== runId || att["expectedDatabase"] !== `gsw_disposable_${runId}`) throw new Fail("TARGET_RUN_MISMATCH");
    const facts: TargetFacts = {
      runId, db: `gsw_disposable_${runId}`, environmentId: att["environmentId"] as string,
      instanceId: att["expectedInstanceId"] as string, evidenceRef: att["provisioningEvidenceRef"] as string,
      host: g.target.hostKind === "ipv4_loopback" ? "127.0.0.1" : "::1", port: g.target.port,
    };

    stage = "ENVIRONMENT";
    checkEnvironment(top["environmentNames"]);

    stage = "MANIFEST";
    const proc = checkManifest(top["manifest"], facts);

    stage = "TEARDOWN";
    checkTeardown(top["teardown"], facts, proc);

    return Object.freeze({
      ...FLAGS, status: "READY_FOR_APPROVAL", reason: "DECLARATIONS_CONSISTENT",
      selfReported: SELF_REPORTED, independentlyEstablished: EMPTY, outstanding: OUTSTANDING,
    });
  } catch (e) {
    return blocked(stage, e instanceof Fail ? e.reason : "INVALID_FIELD_TYPE");
  }
}
