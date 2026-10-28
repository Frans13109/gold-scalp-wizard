import { describe, expect, it } from "vitest";
import { validateDisposableDbTarget as guard, type DbGuardReason } from "@/lib/test-db-target-guard";

// Synthetic values only — no real hosts, secrets or databases.
const RUN = "a1b2c3d4e5";
const DB = `gsw_disposable_${RUN}`;
const att = (over: Record<string, unknown> = {}) => ({
  environmentId: "env-synthetic-01", expectedInstanceId: "inst-synthetic-01", expectedDatabase: DB,
  testRunId: RUN, provisioningEvidenceRef: "evidence-ref-0001", teardownOwner: "test_harness", ...over,
});
const cfg = (over: Record<string, unknown> = {}) => ({
  version: 1, url: `postgresql://127.0.0.1:55432/${DB}`, sslMode: "disable", disposableDeclared: true,
  forbiddenCredentialSourcesExcluded: true, attestation: att(), ...over,
});
const reason = (input: unknown) => { const r = guard(input); return r.status === "REJECTED" ? r.reason : r.status; };
const url = (u: string) => reason(cfg({ url: u }));

describe("candidate configurations", () => {
  it("accepts IPv4 loopback with explicit port as CANDIDATE_ONLY", () => {
    const r = guard(cfg());
    expect(r).toMatchObject({ status: "CANDIDATE_ONLY", reason: "LOCAL_CHECKS_PASSED", target: { hostKind: "ipv4_loopback", port: 55432 } });
  });
  it("accepts IPv6 loopback and postgres:// scheme", () => {
    expect(guard(cfg({ url: `postgres://[::1]:55433/${DB}` }))).toMatchObject({ status: "CANDIDATE_ONLY", target: { hostKind: "ipv6_loopback" } });
  });
  it("candidate always carries warnings and remaining verification", () => {
    const r = guard(cfg());
    if (r.status !== "CANDIDATE_ONLY") throw new Error("expected candidate");
    expect(r.warnings).toEqual(expect.arrayContaining(["LOOPBACK_MAY_BE_FORWARDED", "ATTESTATION_SELF_REPORTED", "NO_CONNECTION_AUTHORIZED", "CREDENTIAL_ORIGIN_NOT_ESTABLISHED"]));
    expect(r.remainingVerification).toEqual(expect.arrayContaining(["VERIFY_INSTANCE_IDENTITY", "SEPARATE_CONNECTION_APPROVAL"]));
  });
  it("is deterministic", () => { expect(guard(cfg())).toEqual(guard(cfg())); });
  it("does not mutate input", () => { const c = cfg(); const s = JSON.stringify(c); guard(c); expect(JSON.stringify(c)).toBe(s); });
});

describe("missing and malformed input", () => {
  it.each([
    ["undefined", undefined, "NOT_AN_OBJECT"], ["null", null, "NOT_AN_OBJECT"], ["string", "postgresql://x", "NOT_AN_OBJECT"],
    ["array", [], "NOT_AN_OBJECT"], ["empty object", {}, "MISSING_FIELD"],
  ])("%s → %s", (_n, input, r) => { expect(reason(input)).toBe(r); });
  it("missing url / empty url", () => {
    const { url: _u, ...rest } = cfg(); expect(reason(rest)).toBe("MISSING_FIELD");
    expect(url("")).toBe("INVALID_URL");
    expect(reason(cfg({ url: 42 }))).toBe("INVALID_URL");
  });
  it("overlong url", () => { expect(url(`postgresql://127.0.0.1:55432/${"a".repeat(300)}`)).toBe("INVALID_URL"); });
});

describe("unexpected keys and versions", () => {
  it("rejects extra top-level and attestation keys", () => {
    expect(reason({ ...cfg(), password: "synthetic" })).toBe("UNEXPECTED_FIELD");
    expect(reason({ ...cfg(), allowRemote: true })).toBe("UNEXPECTED_FIELD");
    expect(reason(cfg({ attestation: { ...att(), verified: true } }))).toBe("INVALID_ATTESTATION");
  });
  it.each([0, 2, "1", null])("version %s → UNSUPPORTED_VERSION", (v) => { expect(reason(cfg({ version: v }))).toBe("UNSUPPORTED_VERSION"); });
  it("rejects getters without executing them", () => {
    let called = false; const c: Record<string, unknown> = cfg(); delete c["url"];
    Object.defineProperty(c, "url", { enumerable: true, get() { called = true; return "x"; } });
    expect(reason(c)).toBe("ACCESSOR_FIELD"); expect(called).toBe(false);
  });
});

describe("schemes", () => {
  it.each(["mysql", "http", "https", "jdbc", "postgresql+psycopg", "file", "pgsql"])("%s → UNSUPPORTED_SCHEME", (s) => {
    expect(url(`${s}://127.0.0.1:55432/${DB}`)).toBe("UNSUPPORTED_SCHEME");
  });
  it("no scheme / unix socket forms", () => {
    expect(url(`127.0.0.1:55432/${DB}`)).toBe("INVALID_URL");
    expect(url("/var/run/postgresql")).toBe("UNIX_SOCKET");
    expect(url(`postgresql:///${DB}`)).toBe("UNIX_SOCKET");
  });
});

describe("credentials, query parameters and tricks", () => {
  it("rejects user/password in URL without echoing them", () => {
    const secret = "SyntheticPw123";
    const r = guard(cfg({ url: `postgresql://user:${secret}@127.0.0.1:55432/${DB}` }));
    expect(r).toMatchObject({ status: "REJECTED", reason: "CREDENTIALS_IN_URL" });
    expect(JSON.stringify(r)).not.toContain(secret);
    expect(JSON.stringify(r)).not.toContain("127.0.0.1");
  });
  it("candidate output never echoes the URL or database name", () => {
    const s = JSON.stringify(guard(cfg()));
    expect(s).not.toContain("postgresql://"); expect(s).not.toContain(DB);
  });
  it.each([
    [`postgresql://127.0.0.1:55432/${DB}?sslmode=disable`, "QUERY_PARAMETERS"],
    [`postgresql://127.0.0.1:55432/${DB}?host=db.example.com`, "QUERY_PARAMETERS"],
    [`postgresql://127.0.0.1:55432/${DB}?service=prod`, "QUERY_PARAMETERS"],
    [`postgresql://127.0.0.1:55432/${DB}#frag`, "URL_FRAGMENT"],
    [`postgresql://evil.example.com@127.0.0.1:55432/${DB}`, "CREDENTIALS_IN_URL"],
    [`postgresql://127.0.0.1:55432,db.example.com:5432/${DB}`, "MULTIPLE_HOSTS"],
    [`postgresql://127.0.0.1%2edb.example.com:55432/${DB}`, "UNSAFE_URL_CHARACTERS"],
    [`postgresql://127.0.0.1:55432/${DB} `, "UNSAFE_URL_CHARACTERS"],
    [`postgresql://127.0.0.1\\:55432/${DB}`, "UNSAFE_URL_CHARACTERS"],
    [`postgresql://127.0.0.1:55432/${DB}/extra`, "INVALID_DATABASE_NAME"],
  ])("%s → %s", (u, r) => { expect(url(u)).toBe(r); });
});

describe("hosts", () => {
  it.each([
    ["localhost", "LOCALHOST_AMBIGUOUS"], ["LOCALHOST", "LOCALHOST_AMBIGUOUS"], ["db.localhost", "LOCALHOST_AMBIGUOUS"],
    ["db.abcdefghijkl.supabase.co", "SUPABASE_HOST"], ["aws-0-eu-west-1.pooler.supabase.com", "SUPABASE_HOST"],
    ["8.8.8.8", "PUBLIC_IP"], ["203.0.113.5", "PUBLIC_IP"],
    ["127.0.0.2", "NON_LOOPBACK_HOST"], ["10.0.0.5", "NON_LOOPBACK_HOST"], ["192.168.1.10", "NON_LOOPBACK_HOST"],
    ["[::ffff:127.0.0.1]", "NON_LOOPBACK_HOST"], ["[2001:db8::1]", "NON_LOOPBACK_HOST"],
    ["postgres", "NON_LOOPBACK_HOST"], ["db", "NON_LOOPBACK_HOST"], ["host.docker.internal", "NON_LOOPBACK_HOST"],
    ["db.example.com", "NON_LOOPBACK_HOST"],
  ])("%s → %s", (h, r) => { expect(url(`postgresql://${h}:55432/${DB}`)).toBe(r); });
  it("missing host", () => { expect(url(`postgresql://:55432/${DB}`)).toBe("MISSING_HOST"); });
});

describe("ports", () => {
  it.each([
    [`postgresql://127.0.0.1/${DB}`, "MISSING_PORT"], [`postgresql://127.0.0.1:/${DB}`, "MISSING_PORT"],
    [`postgresql://127.0.0.1:5432/${DB}`, "DEFAULT_PORT"], [`postgresql://127.0.0.1:6543/${DB}`, "DEFAULT_PORT"],
    [`postgresql://127.0.0.1:5433/${DB}`, "DEFAULT_PORT"], [`postgresql://127.0.0.1:80/${DB}`, "INVALID_PORT"],
    [`postgresql://127.0.0.1:70000/${DB}`, "INVALID_PORT"], [`postgresql://127.0.0.1:055432/${DB}`, "INVALID_PORT"],
    [`postgresql://127.0.0.1:abc/${DB}`, "INVALID_PORT"],
  ])("%s → %s", (u, r) => { expect(url(u)).toBe(r); });
});

describe("database names", () => {
  it.each([
    ["postgres", "PRODUCTION_LIKE_DATABASE"], ["production", "PRODUCTION_LIKE_DATABASE"], ["preview_db", "PRODUCTION_LIKE_DATABASE"],
    ["dev", "PRODUCTION_LIKE_DATABASE"], ["staging", "PRODUCTION_LIKE_DATABASE"], ["template1", "PRODUCTION_LIKE_DATABASE"],
    ["gsw_disposable_prod1234", "PRODUCTION_LIKE_DATABASE"], ["gsw_disposable_live12345", "PRODUCTION_LIKE_DATABASE"],
    ["testdb", "INVALID_DATABASE_NAME"], ["gsw_disposable_short", "INVALID_DATABASE_NAME"],
    ["gsw_disposable_ABCDEFGH", "INVALID_DATABASE_NAME"], ["GSW_DISPOSABLE_abcdefgh", "INVALID_DATABASE_NAME"],
  ])("%s → %s", (name, r) => { expect(url(`postgresql://127.0.0.1:55432/${name}`)).toBe(r); });
  it("missing database", () => {
    expect(url("postgresql://127.0.0.1:55432")).toBe("MISSING_DATABASE");
    expect(url("postgresql://127.0.0.1:55432/")).toBe("MISSING_DATABASE");
  });
});

describe("flags and ssl", () => {
  it.each(["require", "verify-full", "prefer", "", null])("sslMode %s → UNSUPPORTED_SSL_MODE", (s) => {
    expect(reason(cfg({ sslMode: s }))).toBe("UNSUPPORTED_SSL_MODE");
  });
  it.each([false, "true", 1, null])("disposableDeclared %s rejected", (v) => { expect(reason(cfg({ disposableDeclared: v }))).toBe("DISPOSABLE_NOT_DECLARED"); });
  it.each([false, "yes", null])("credential exclusion %s rejected", (v) => {
    expect(reason(cfg({ forbiddenCredentialSourcesExcluded: v }))).toBe("CREDENTIAL_SOURCES_NOT_EXCLUDED");
  });
});

describe("attestation", () => {
  it("missing or non-object attestation", () => {
    expect(reason(cfg({ attestation: null }))).toBe("INVALID_ATTESTATION");
    expect(reason(cfg({ attestation: {} }))).toBe("INVALID_ATTESTATION");
  });
  it.each(["environmentId", "expectedInstanceId", "testRunId", "provisioningEvidenceRef"])("invalid %s", (k) => {
    expect(reason(cfg({ attestation: att({ [k]: "x" }) }))).toBe("INVALID_ATTESTATION");
    expect(reason(cfg({ attestation: att({ [k]: 123 }) }))).toBe("INVALID_ATTESTATION");
  });
  it("contradictions", () => {
    expect(reason(cfg({ attestation: att({ expectedDatabase: "gsw_disposable_zzzzzzzz" }) }))).toBe("ATTESTATION_DATABASE_MISMATCH");
    expect(reason(cfg({ attestation: att({ testRunId: "zzzzzzzz99" }) }))).toBe("ATTESTATION_RUN_MISMATCH");
    expect(reason(cfg({ attestation: att({ teardownOwner: "nobody" }) }))).toBe("INVALID_TEARDOWN_OWNER");
    expect(reason(cfg({ attestation: att({ expectedInstanceId: "env-synthetic-01" }) }))).toBe("INVALID_ATTESTATION");
  });
});

describe("never authorises or verifies", () => {
  const samples: unknown[] = [cfg(), cfg({ url: `postgres://[::1]:55433/${DB}` }), null, cfg({ url: "postgresql://localhost:55432/x" })];
  it("every result: no connection authorised, isolation unverified", () => {
    for (const s of samples) expect(guard(s)).toMatchObject({ connectionAuthorized: false, isolationVerified: false, unvalidated: true });
  });
  it("status is only REJECTED or CANDIDATE_ONLY", () => {
    for (const s of samples) expect(["REJECTED", "CANDIDATE_ONLY"]).toContain(guard(s).status);
    const s = JSON.stringify(samples.map((x) => guard(x)));
    expect(s).not.toMatch(/SAFE_TO_CONNECT|"VERIFIED"/);
  });
  it("self-reported disposable attestation never becomes verified", () => {
    expect(guard(cfg())).toMatchObject({ status: "CANDIDATE_ONLY", isolationVerified: false, connectionAuthorized: false });
  });
});

describe("purity and isolation", () => {
  it("module source has no env, network, fs, db, shell or Supabase imports", async () => {
    const mods = import.meta.glob("/src/lib/test-db-target-guard.ts", { query: "?raw", import: "default" });
    const src = (await Object.values(mods)[0]!()) as string;
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(code).not.toMatch(/\bimport\b/);
    expect(code).not.toMatch(/process\.env|fetch\(|XMLHttpRequest|WebSocket|require\(|child_process|node:|Deno|Bun\./);
  });
  it("reason codes are stable strings", () => {
    const expected: DbGuardReason[] = ["LOCALHOST_AMBIGUOUS", "SUPABASE_HOST", "CREDENTIALS_IN_URL", "DEFAULT_PORT"];
    expect([url("postgresql://localhost:55432/x"), url(`postgresql://x.supabase.co:55432/${DB}`),
      url(`postgresql://u:p@127.0.0.1:55432/${DB}`), url(`postgresql://127.0.0.1:5432/${DB}`)]).toEqual(expected);
  });
});
