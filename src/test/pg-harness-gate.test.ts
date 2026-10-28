import { describe, expect, it } from "vitest";
import { evaluatePgHarnessGate as gate, PG_GATE_ENV_ALLOWLIST, type PgGateReason } from "@/lib/pg-harness-gate";

// Synthetic, invented values only — no real hosts, credentials, databases or live data.
const RUN = "a1b2c3d4e5";
const DB = `gsw_disposable_${RUN}`;
const PORT = 55432;
const att = (o: Record<string, unknown> = {}) => ({
  environmentId: "env-synthetic-01", expectedInstanceId: "inst-synthetic-01", expectedDatabase: DB,
  testRunId: RUN, provisioningEvidenceRef: "evidence-ref-0001", teardownOwner: "test_harness", ...o,
});
const target = (o: Record<string, unknown> = {}) => ({
  version: 1, url: `postgresql://127.0.0.1:${PORT}/${DB}`, sslMode: "disable", disposableDeclared: true,
  forbiddenCredentialSourcesExcluded: true, attestation: att(), ...o,
});
const manifest = (o: Record<string, unknown> = {}) => ({
  version: 1, runId: RUN, environmentId: "env-synthetic-01", instanceId: "inst-synthetic-01", databaseName: DB,
  processIdentity: { kind: "container", id: "ctr-synthetic-01" }, host: "127.0.0.1", port: PORT,
  nonceId: "nonce-synthetic-01", createdAtMsc: 1_800_000_000_000, provisioningEvidenceRef: "evidence-ref-0001",
  provisioningOwner: "test_harness_provisioner", teardownOwner: "test_harness", ...o,
});
const teardown = (o: Record<string, unknown> = {}) => ({
  version: 1, runId: RUN, instanceId: "inst-synthetic-01", databaseName: DB,
  resources: [{ kind: "database", id: DB }, { kind: "container", id: "ctr-synthetic-01" }, { kind: "temp_directory", id: `gsw-run-${RUN}` }],
  ownership: "run_owned", independentOwnershipVerificationRequired: true, owner: "test_harness", ...o,
});
const cfg = (o: Record<string, unknown> = {}) => ({
  version: 1, runId: RUN, target: target(), environmentNames: ["GSW_PG_HARNESS", "PATH", "HOME"],
  manifest: manifest(), teardown: teardown(), ...o,
});
const reason = (i: unknown) => { const r = gate(i); return r.status === "BLOCKED" ? r.reason : r.status; };
const res = (resources: unknown) => reason(cfg({ teardown: teardown({ resources }) }));
const FLAG_KEYS = ["connectionAuthorized", "provisioningAuthorized", "destructiveSqlAuthorized", "teardownAuthorized", "isolationVerified"];

describe("1. valid-looking configuration", () => {
  it("returns READY_FOR_APPROVAL only, never an authorisation", () => {
    const r = gate(cfg());
    expect(r).toMatchObject({ status: "READY_FOR_APPROVAL", reason: "DECLARATIONS_CONSISTENT" });
    for (const k of FLAG_KEYS) expect((r as Record<string, unknown>)[k]).toBe(false);
    expect(r.unvalidated).toBe(true);
  });
  it("accepts IPv6 loopback when manifest matches", () => {
    expect(reason(cfg({ target: target({ url: `postgresql://[::1]:${PORT}/${DB}` }), manifest: manifest({ host: "::1" }) }))).toBe("READY_FOR_APPROVAL");
  });
  it("is deterministic and does not mutate input", () => {
    const c = cfg(); const s = JSON.stringify(c);
    expect(gate(c)).toEqual(gate(cfg())); expect(JSON.stringify(c)).toBe(s);
  });
  it("result is frozen", () => { expect(Object.isFrozen(gate(cfg()))).toBe(true); });
});

describe("2. invalid input", () => {
  it.each([["undefined", undefined], ["null", null], ["string", "x"], ["number", 1], ["array", []]])("%s → NOT_AN_OBJECT", (_n, i) => {
    expect(reason(i)).toBe("NOT_AN_OBJECT");
  });
  it("empty object → MISSING_FIELD", () => { expect(reason({})).toBe("MISSING_FIELD"); });
  it("overlong string → STRING_TOO_LONG", () => { expect(reason(cfg({ runId: "a".repeat(300) }))).toBe("STRING_TOO_LONG"); });
  it("undefined nested value → INVALID_FIELD_TYPE", () => { expect(reason(cfg({ manifest: undefined }))).toBe("INVALID_FIELD_TYPE"); });
  it("function value → INVALID_FIELD_TYPE", () => { expect(reason(cfg({ manifest: () => 1 }))).toBe("INVALID_FIELD_TYPE"); });
  it("oversized env list → INPUT_TOO_LARGE or INVALID_ENV_SNAPSHOT", () => {
    expect(["INPUT_TOO_LARGE", "INVALID_ENV_SNAPSHOT"]).toContain(reason(cfg({ environmentNames: Array.from({ length: 300 }, (_, i) => `N${i}`) })));
  });
});

describe("3. versions", () => {
  it.each([0, 2, "1", null])("config version %s → UNSUPPORTED_VERSION", (v) => { expect(reason(cfg({ version: v }))).toBe("UNSUPPORTED_VERSION"); });
  it("manifest version 2 blocks", () => { expect(reason(cfg({ manifest: manifest({ version: 2 }) }))).toBe("UNSUPPORTED_MANIFEST_VERSION"); });
  it("teardown version 2 blocks", () => { expect(reason(cfg({ teardown: teardown({ version: 2 }) }))).toBe("UNSUPPORTED_TEARDOWN_VERSION"); });
});

describe("4. unexpected fields and inherited properties", () => {
  it("extra top-level field", () => { expect(reason({ ...cfg(), authorize: true })).toBe("UNEXPECTED_FIELD"); });
  it("extra manifest field", () => { expect(reason(cfg({ manifest: { ...manifest(), password: "x" } }))).toBe("UNEXPECTED_FIELD"); });
  it("inherited configuration object", () => { expect(reason(Object.assign(Object.create(cfg()), {}))).toBe("INHERITED_OR_EXOTIC_OBJECT"); });
  it("class instance rejected", () => { class C { version = 1; } expect(reason(new C())).toBe("INHERITED_OR_EXOTIC_OBJECT"); });
  it("prototype-manipulated nested manifest", () => {
    const m = Object.setPrototypeOf(manifest(), { injected: true });
    expect(reason(cfg({ manifest: m }))).toBe("INHERITED_OR_EXOTIC_OBJECT");
  });
  it("symbol key rejected", () => { expect(reason({ ...cfg(), [Symbol("x")]: 1 })).toBe("SYMBOL_KEY"); });
  it("sparse array rejected", () => {
    const a: string[] = ["GSW_PG_HARNESS"]; a[3] = "PATH";
    expect(reason(cfg({ environmentNames: a }))).toBe("INHERITED_OR_EXOTIC_OBJECT");
  });
  it("Map/Date rejected", () => {
    expect(reason(cfg({ manifest: new Map() }))).toBe("INHERITED_OR_EXOTIC_OBJECT");
    expect(reason(cfg({ manifest: manifest({ createdAtMsc: new Date(0) }) }))).toBe("INHERITED_OR_EXOTIC_OBJECT");
  });
});

describe("5. getters rejected without invocation", () => {
  it("top-level getter", () => {
    let called = false; const c = cfg();
    Object.defineProperty(c, "runId", { get: () => { called = true; return RUN; }, enumerable: true });
    expect(reason(c)).toBe("ACCESSOR_FIELD"); expect(called).toBe(false);
  });
  it("nested teardown getter", () => {
    let called = false; const t = teardown();
    Object.defineProperty(t, "owner", { get: () => { called = true; return "test_harness"; }, enumerable: true });
    expect(reason(cfg({ teardown: t }))).toBe("ACCESSOR_FIELD"); expect(called).toBe(false);
  });
  it("array element getter", () => {
    let called = false; const a = ["GSW_PG_HARNESS"];
    Object.defineProperty(a, "0", { get: () => { called = true; return "PATH"; } });
    expect(reason(cfg({ environmentNames: a }))).toBe("ACCESSOR_FIELD"); expect(called).toBe(false);
  });
});

describe("6. run identifiers", () => {
  it.each(["", "short", "UPPERCASE1", "a1b2-c3d4", "a".repeat(33), 12345678])("malformed %s → INVALID_RUN_ID", (r) => {
    expect(reason(cfg({ runId: r }))).toBe("INVALID_RUN_ID");
  });
  it("config run ID different from target suffix", () => { expect(reason(cfg({ runId: "zzzzzzzz99" }))).toBe("TARGET_RUN_MISMATCH"); });
  it("manifest run mismatch", () => { expect(reason(cfg({ manifest: manifest({ runId: "zzzzzzzz99" }) }))).toBe("MANIFEST_RUN_MISMATCH"); });
  it("case-variant run ID is not equal", () => { expect(reason(cfg({ manifest: manifest({ runId: RUN.toUpperCase() }) }))).toBe("MANIFEST_RUN_MISMATCH"); });
});

describe("7–8. Phase 2F compatibility", () => {
  it.each([
    ["supabase host", { url: `postgresql://db.x.supabase.co:${PORT}/${DB}` }],
    ["default port", { url: `postgresql://127.0.0.1:5432/${DB}` }],
    ["credentials in url", { url: `postgresql://u:p@127.0.0.1:${PORT}/${DB}` }],
    ["production db name", { url: `postgresql://127.0.0.1:${PORT}/prod_main` }],
    ["ssl mode", { sslMode: "require" }],
    ["not disposable", { disposableDeclared: false }],
  ])("Phase 2F rejection (%s) → TARGET_REJECTED", (_n, o) => {
    const r = gate(cfg({ target: target(o) }));
    expect(r).toMatchObject({ status: "BLOCKED", stage: "TARGET", reason: "TARGET_REJECTED" });
  });
  it("caller-supplied 'passed' claim is not accepted as a target", () => {
    expect(reason(cfg({ target: { status: "CANDIDATE_ONLY", connectionAuthorized: true } }))).toBe("TARGET_REJECTED");
  });
  it("Phase 2F candidate never becomes connection authorisation", () => {
    const r = gate(cfg());
    expect(r.connectionAuthorized).toBe(false);
    if (r.status !== "READY_FOR_APPROVAL") throw new Error("expected ready");
    expect(r.outstanding).toContain("HUMAN_APPROVAL_FOR_CONNECTION");
  });
});

describe("9–10. environment allowlist", () => {
  it("accepts allowlisted names only", () => { expect(reason(cfg({ environmentNames: [...PG_GATE_ENV_ALLOWLIST] }))).toBe("READY_FOR_APPROVAL"); });
  it("requires the harness flag", () => { expect(reason(cfg({ environmentNames: ["PATH"] }))).toBe("ENV_HARNESS_FLAG_MISSING"); });
  it.each(["SUPABASE_URL", "VITE_SUPABASE_PUBLISHABLE_KEY", "SUPABASE_SERVICE_ROLE_KEY", "DATABASE_URL", "POSTGRES_URL",
    "PGHOST", "PGPORT", "PGUSER", "PGPASSWORD", "PGDATABASE", "PGSERVICE", "PGSSLMODE", "PGPASSFILE",
    "BRIDGE_HMAC_SECRET", "MT5_LOGIN", "EXNESS_SERVER", "MY_API_KEY", "GITHUB_TOKEN", "REDIS_URL"])("forbidden %s", (n) => {
    expect(reason(cfg({ environmentNames: ["GSW_PG_HARNESS", n] }))).toBe("ENV_FORBIDDEN_NAME");
  });
  it.each(["FOO", "USER", "SHELL", "AWS_REGION"])("unknown %s → ENV_NAME_NOT_ALLOWED", (n) => {
    expect(reason(cfg({ environmentNames: ["GSW_PG_HARNESS", n] }))).toBe("ENV_NAME_NOT_ALLOWED");
  });
  it.each(["lower", "HAS SPACE", "A=B", "", "1ABC"])("malformed %s", (n) => {
    expect(reason(cfg({ environmentNames: ["GSW_PG_HARNESS", n] }))).toBe("ENV_NAME_MALFORMED");
  });
  it("duplicates", () => { expect(reason(cfg({ environmentNames: ["GSW_PG_HARNESS", "GSW_PG_HARNESS"] }))).toBe("ENV_NAME_DUPLICATE"); });
  it("name=value pairs are not names", () => { expect(reason(cfg({ environmentNames: ["GSW_PG_HARNESS=1"] }))).toBe("ENV_NAME_MALFORMED"); });
  it("non-array snapshot", () => { expect(reason(cfg({ environmentNames: { PATH: "/bin" } }))).toBe("INVALID_ENV_SNAPSHOT"); });
});

describe("11–12. provisioning manifest", () => {
  it.each<[string, Record<string, unknown>, PgGateReason]>([
    ["environment", { environmentId: "env-synthetic-99" }, "MANIFEST_ENVIRONMENT_MISMATCH"],
    ["instance", { instanceId: "inst-synthetic-99" }, "MANIFEST_INSTANCE_MISMATCH"],
    ["database", { databaseName: "gsw_disposable_zzzzzzzz99" }, "MANIFEST_DATABASE_MISMATCH"],
    ["database substring", { databaseName: `${DB}x` }, "MANIFEST_DATABASE_MISMATCH"],
    ["host", { host: "localhost" }, "MANIFEST_HOST_MISMATCH"],
    ["host ipv6 vs ipv4", { host: "::1" }, "MANIFEST_HOST_MISMATCH"],
    ["port", { port: 55433 }, "MANIFEST_PORT_MISMATCH"],
    ["port as string", { port: String(PORT) }, "MANIFEST_PORT_MISMATCH"],
    ["evidence", { provisioningEvidenceRef: "evidence-ref-0002" }, "MANIFEST_EVIDENCE_MISMATCH"],
    ["process kind", { processIdentity: { kind: "vm", id: "ctr-synthetic-01" } }, "MANIFEST_INVALID_PROCESS_IDENTITY"],
    ["process id", { processIdentity: { kind: "container", id: "x" } }, "MANIFEST_INVALID_PROCESS_IDENTITY"],
    ["process extra", { processIdentity: { kind: "container", id: "ctr-synthetic-01", pid: 1 } }, "MANIFEST_INVALID_PROCESS_IDENTITY"],
    ["nonce", { nonceId: "n" }, "MANIFEST_INVALID_NONCE"],
    ["timestamp negative", { createdAtMsc: -1 }, "MANIFEST_INVALID_TIMESTAMP"],
    ["timestamp fractional", { createdAtMsc: 1.5 }, "MANIFEST_INVALID_TIMESTAMP"],
    ["timestamp string", { createdAtMsc: "2026-10-28" }, "MANIFEST_INVALID_TIMESTAMP"],
    ["timestamp too large", { createdAtMsc: 9e15 }, "MANIFEST_INVALID_TIMESTAMP"],
    ["provisioning owner", { provisioningOwner: "someone" }, "MANIFEST_INVALID_OWNER"],
    ["teardown owner", { teardownOwner: "ops" }, "MANIFEST_INVALID_OWNER"],
    ["nonce reuses instance id", { nonceId: "inst-synthetic-01" }, "MANIFEST_IDENTIFIER_REUSE"],
  ])("%s mismatch", (_n, o, r) => { expect(reason(cfg({ manifest: manifest(o) }))).toBe(r); });
  it("missing manifest field", () => {
    const m: Record<string, unknown> = manifest(); delete m["nonceId"];
    expect(reason(cfg({ manifest: m }))).toBe("MISSING_FIELD");
  });
  it("null manifest", () => { expect(reason(cfg({ manifest: null }))).toBe("INVALID_MANIFEST"); });
});

describe("13. self-reported identity never becomes verified isolation", () => {
  it("lists every declaration as self-reported and nothing as established", () => {
    const r = gate(cfg());
    if (r.status !== "READY_FOR_APPROVAL") throw new Error("expected ready");
    expect(r.independentlyEstablished).toEqual([]);
    expect(r.selfReported).toEqual(expect.arrayContaining(["PROVISIONING_MANIFEST", "PROCESS_IDENTITY", "NONCE", "TEARDOWN_PLAN"]));
    expect(r.outstanding).toEqual(expect.arrayContaining(["VERIFY_INSTANCE_OWNERSHIP_OUT_OF_BAND", "VERIFY_NO_LOOPBACK_TUNNEL", "VERIFY_REAL_PROCESS_ENVIRONMENT"]));
    expect(r.isolationVerified).toBe(false);
  });
  it("has no VERIFIED / SAFE status anywhere in output", () => {
    expect(JSON.stringify(gate(cfg()))).not.toMatch(/"status":"(VERIFIED|SAFE|AUTHORI)/);
  });
});

describe("14. teardown plan presence and shape", () => {
  it("null teardown → TEARDOWN_MISSING", () => { expect(reason(cfg({ teardown: null }))).toBe("TEARDOWN_MISSING"); });
  it("absent teardown → MISSING_FIELD", () => { const c: Record<string, unknown> = cfg(); delete c["teardown"]; expect(reason(c)).toBe("MISSING_FIELD"); });
  it("string teardown → INVALID_TEARDOWN", () => { expect(reason(cfg({ teardown: "drop everything" }))).toBe("INVALID_TEARDOWN"); });
  it("empty resources", () => { expect(res([])).toBe("INVALID_TEARDOWN"); });
  it("too many resources", () => { expect(res(Array.from({ length: 5 }, () => ({ kind: "database", id: DB })))).toBe("INVALID_TEARDOWN"); });
  it("no database resource", () => { expect(res([{ kind: "container", id: "ctr-synthetic-01" }])).toBe("TEARDOWN_DATABASE_RESOURCE_REQUIRED"); });
  it("duplicate database", () => { expect(res([{ kind: "database", id: DB }, { kind: "database", id: DB }])).toBe("TEARDOWN_DUPLICATE_RESOURCE"); });
  it("ownership undeclared", () => { expect(reason(cfg({ teardown: teardown({ ownership: "shared" }) }))).toBe("TEARDOWN_OWNERSHIP_UNDECLARED"); });
  it("independent verification must be required", () => {
    expect(reason(cfg({ teardown: teardown({ independentOwnershipVerificationRequired: false }) }))).toBe("TEARDOWN_VERIFICATION_NOT_REQUIRED");
  });
  it("teardown owner", () => { expect(reason(cfg({ teardown: teardown({ owner: "root" }) }))).toBe("TEARDOWN_INVALID_OWNER"); });
});

describe("15–16. cross-run, cross-instance, cross-resource", () => {
  it("other run", () => { expect(reason(cfg({ teardown: teardown({ runId: "zzzzzzzz99" }) }))).toBe("TEARDOWN_RUN_MISMATCH"); });
  it("other instance", () => { expect(reason(cfg({ teardown: teardown({ instanceId: "inst-synthetic-99" }) }))).toBe("TEARDOWN_INSTANCE_MISMATCH"); });
  it("other database", () => { expect(reason(cfg({ teardown: teardown({ databaseName: "gsw_disposable_zzzzzzzz99" }) }))).toBe("TEARDOWN_DATABASE_MISMATCH"); });
  it.each([
    ["production database resource", [{ kind: "database", id: "postgres" }]],
    ["other run's database", [{ kind: "database", id: "gsw_disposable_zzzzzzzz99" }]],
    ["unrelated container", [{ kind: "database", id: DB }, { kind: "container", id: "ctr-other-0001" }]],
    ["process vs container kind", [{ kind: "database", id: DB }, { kind: "process", id: "ctr-synthetic-01" }]],
    ["other temp dir", [{ kind: "database", id: DB }, { kind: "temp_directory", id: "/tmp" }]],
  ])("%s → TEARDOWN_RESOURCE_MISMATCH", (_n, r) => { expect(res(r)).toBe("TEARDOWN_RESOURCE_MISMATCH"); });
  it("unrecognised resource kind", () => { expect(res([{ kind: "database", id: DB }, { kind: "file", id: "x" }])).toBe("TEARDOWN_UNRECOGNISED_RESOURCE"); });
});

describe("17–18. wildcard, broad and shared resources", () => {
  it.each(["*", "%", "gsw_disposable_%", "all", "ALL", "any", "everything", "a?b"])("wildcard id %s", (id) => {
    expect(res([{ kind: "database", id }])).toBe("TEARDOWN_WILDCARD_SCOPE");
  });
  it("wildcard run scope", () => { expect(reason(cfg({ teardown: teardown({ runId: "*" }) }))).toBe("TEARDOWN_WILDCARD_SCOPE"); });
  it("wildcard instance scope", () => { expect(reason(cfg({ teardown: teardown({ instanceId: "all" }) }))).toBe("TEARDOWN_WILDCARD_SCOPE"); });
  it.each(["volume", "network", "image", "cluster", "host", "bucket", "schema", "role"])("shared kind %s", (kind) => {
    expect(res([{ kind: "database", id: DB }, { kind, id: "res-synthetic-01" }])).toBe("TEARDOWN_SHARED_RESOURCE");
  });
});

describe("19. no raw SQL or shell cleanup", () => {
  it.each(["sql", "command", "commands", "script", "shell", "exec", "statement", "query", "SQL"])("teardown key %s", (k) => {
    expect(reason(cfg({ teardown: { ...teardown(), [k]: "DROP DATABASE x" } }))).toBe("TEARDOWN_EXECUTABLE_CONTENT");
  });
  it("executable content inside a resource", () => {
    expect(res([{ kind: "database", id: DB, sql: "DROP SCHEMA public CASCADE" }])).toBe("TEARDOWN_EXECUTABLE_CONTENT");
  });
  it("DROP statement as resource id is not accepted", () => {
    expect(res([{ kind: "database", id: `DROP DATABASE ${DB}` }])).toBe("TEARDOWN_RESOURCE_MISMATCH");
  });
});

describe("20. purity: no network, filesystem, database or environment access", () => {
  it("module source imports only the Phase 2F guard and uses no I/O", async () => {
    const mods = import.meta.glob("/src/lib/pg-harness-gate.ts", { query: "?raw", import: "default" });
    const src = (await Object.values(mods)[0]!()) as string;
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    const imports = code.match(/\bimport\b[^;]*;/g) ?? [];
    expect(imports).toEqual([`import { validateDisposableDbTarget } from "./test-db-target-guard";`]);
    expect(code).not.toMatch(/process\.|fetch\(|XMLHttpRequest|WebSocket|require\(|child_process|node:|Deno|Bun\.|Date\.now|new Date|Math\.random|crypto|supabase|import\(/i);
  });
});

describe("21. no sensitive data leakage", () => {
  it("output never echoes input values", () => {
    const outs = [gate(cfg()), gate(cfg({ manifest: manifest({ port: 55433 }) })),
      gate(cfg({ target: target({ url: `postgresql://u:s3cr3t@127.0.0.1:${PORT}/${DB}` }) })),
      gate(cfg({ environmentNames: ["GSW_PG_HARNESS", "SUPABASE_SERVICE_ROLE_KEY"] }))];
    for (const o of outs) {
      const s = JSON.stringify(o);
      for (const needle of [RUN, DB, "127.0.0.1", "s3cr3t", "inst-synthetic-01", "ctr-synthetic-01", "nonce-synthetic-01", "evidence-ref-0001", "SUPABASE_SERVICE_ROLE_KEY", String(PORT)])
        expect(s).not.toContain(needle);
    }
  });
});

describe("22. every authorisation flag remains false", () => {
  it.each([["ready", cfg()], ["blocked", cfg({ runId: "x" })], ["garbage", 42]])("%s", (_n, i) => {
    const r = gate(i) as Record<string, unknown>;
    for (const k of FLAG_KEYS) expect(r[k]).toBe(false);
    expect(r["unvalidated"]).toBe(true);
  });
  it("caller cannot inject authorisation", () => {
    expect(reason({ ...cfg(), connectionAuthorized: true })).toBe("UNEXPECTED_FIELD");
  });
});

describe("23. stable reason codes and stages", () => {
  it("fixed codes", () => {
    expect([reason(cfg({ runId: "x" })), reason(cfg({ environmentNames: ["GSW_PG_HARNESS", "PGHOST"] })),
      reason(cfg({ teardown: teardown({ runId: "zzzzzzzz99" }) }))]).toEqual(["INVALID_RUN_ID", "ENV_FORBIDDEN_NAME", "TEARDOWN_RUN_MISMATCH"]);
  });
  it("stage reported", () => {
    expect(gate(cfg({ manifest: manifest({ port: 1 }) }))).toMatchObject({ status: "BLOCKED", stage: "MANIFEST" });
    expect(gate(cfg({ teardown: null }))).toMatchObject({ status: "BLOCKED", stage: "TEARDOWN" });
    expect(gate(cfg({ environmentNames: [] }))).toMatchObject({ status: "BLOCKED", stage: "ENVIRONMENT" });
  });
});

describe("24. fail-closed on unsupported or ambiguous cases", () => {
  it("proxy whose trap throws is BLOCKED, not thrown", () => {
    const p = new Proxy(cfg(), { ownKeys: () => { throw new Error("trap"); } });
    expect(gate(p).status).toBe("BLOCKED");
  });
  it("deep nesting blocks", () => {
    let deep: unknown = 1; for (let i = 0; i < 10; i++) deep = { x: deep };
    expect(reason(cfg({ manifest: deep }))).toBe("INPUT_TOO_LARGE");
  });
  it("NaN / Infinity port blocks", () => {
    expect(reason(cfg({ manifest: manifest({ port: Number.NaN }) }))).toBe("MANIFEST_PORT_MISMATCH");
    expect(reason(cfg({ manifest: manifest({ port: Infinity }) }))).toBe("MANIFEST_PORT_MISMATCH");
  });
});
