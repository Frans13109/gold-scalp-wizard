/** Phase 2F: pure, deterministic, FAIL-CLOSED guard for a FUTURE disposable PostgreSQL test target.
 * Not wired to any caller. No process.env, no files, no network, no database, no shell, no Supabase client.
 *
 * LIMITATIONS (by design):
 * - Local validation does NOT prove database isolation. A loopback address can be a forwarded/proxied remote DB.
 * - A disposable-looking database name can still refer to real data.
 * - Attestation fields are self-reported, UNVERIFIED declarations; they are never sufficient on their own.
 * - Independent instance verification by a separately approved connection gate remains mandatory.
 * - This module is NOT permission to connect to any database; no database integration test is authorised.
 *
 * FUTURE CALLER CONTRACT:
 * - Test config is supplied separately from application config; credentials are never part of this input.
 * - The harness must never import production Supabase env vars, service-role keys or bridge secrets, and must
 *   refuse to start when forbidden credential sources are present or cannot be excluded. This guard cannot see the
 *   environment, so it only records the caller's declaration and reports that the origin is NOT established.
 * - Results never echo input values (no URLs, names, hosts or credentials).
 */

export const DB_GUARD_CONFIG_VERSION = 1 as const;
export const DB_GUARD_ALLOWED_HOSTS = ["127.0.0.1", "[::1]"] as const;
export const DB_GUARD_FORBIDDEN_PORTS = [5432, 5433, 6543] as const;
export const DB_GUARD_DB_NAME = /^gsw_disposable_[a-z0-9]{8,32}$/;
const ID = /^[a-z0-9][a-z0-9._-]{7,63}$/;
const FORBIDDEN_DB_TOKENS = ["prod", "preview", "dev", "stag", "live", "main", "real", "supabase", "postgres", "template"];
const CONFIG_KEYS = ["version", "url", "sslMode", "disposableDeclared", "forbiddenCredentialSourcesExcluded", "attestation"];
const ATTEST_KEYS = ["environmentId", "expectedInstanceId", "expectedDatabase", "testRunId", "provisioningEvidenceRef", "teardownOwner"];

export type DbGuardReason =
  | "NOT_AN_OBJECT" | "ACCESSOR_FIELD" | "UNEXPECTED_FIELD" | "MISSING_FIELD" | "UNSUPPORTED_VERSION"
  | "INVALID_URL" | "UNSUPPORTED_SCHEME" | "CREDENTIALS_IN_URL" | "QUERY_PARAMETERS" | "URL_FRAGMENT"
  | "UNSAFE_URL_CHARACTERS" | "MULTIPLE_HOSTS" | "UNIX_SOCKET" | "MISSING_HOST" | "LOCALHOST_AMBIGUOUS"
  | "SUPABASE_HOST" | "PUBLIC_IP" | "NON_LOOPBACK_HOST" | "MISSING_PORT" | "INVALID_PORT" | "DEFAULT_PORT"
  | "MISSING_DATABASE" | "INVALID_DATABASE_NAME" | "PRODUCTION_LIKE_DATABASE" | "UNSUPPORTED_SSL_MODE"
  | "DISPOSABLE_NOT_DECLARED" | "CREDENTIAL_SOURCES_NOT_EXCLUDED" | "INVALID_ATTESTATION"
  | "ATTESTATION_DATABASE_MISMATCH" | "ATTESTATION_RUN_MISMATCH" | "INVALID_TEARDOWN_OWNER";

export interface DisposableAttestation {
  environmentId: string;
  expectedInstanceId: string;
  /** Must equal the URL database name. */
  expectedDatabase: string;
  /** Must equal the suffix after `gsw_disposable_`. */
  testRunId: string;
  provisioningEvidenceRef: string;
  teardownOwner: "test_harness";
}

/** Accepted candidate format. No username/password: credentials are supplied separately by a future harness. */
export interface DisposableDbTargetConfig {
  version: typeof DB_GUARD_CONFIG_VERSION;
  /** `postgresql://127.0.0.1:<port>/gsw_disposable_<run>` or `postgresql://[::1]:<port>/...` only. */
  url: string;
  sslMode: "disable";
  disposableDeclared: true;
  /** Caller's declaration; the guard cannot verify it. */
  forbiddenCredentialSourcesExcluded: true;
  attestation: DisposableAttestation;
}

type Base = { connectionAuthorized: false; isolationVerified: false; unvalidated: true };
const base: Base = { connectionAuthorized: false, isolationVerified: false, unvalidated: true };

export type DbTargetGuardResult = Base & (
  | { status: "REJECTED"; reason: DbGuardReason }
  | {
      status: "CANDIDATE_ONLY";
      reason: "LOCAL_CHECKS_PASSED";
      /** Non-sensitive summary; never includes the URL or credentials. */
      target: { hostKind: "ipv4_loopback" | "ipv6_loopback"; port: number };
      warnings: readonly DbGuardWarning[];
      remainingVerification: readonly DbGuardRequirement[];
    });

export type DbGuardWarning =
  | "LOOPBACK_MAY_BE_FORWARDED" | "DATABASE_NAME_NOT_PROOF" | "ATTESTATION_SELF_REPORTED"
  | "CREDENTIAL_ORIGIN_NOT_ESTABLISHED" | "NO_CONNECTION_AUTHORIZED";
export type DbGuardRequirement =
  | "VERIFY_INSTANCE_IDENTITY" | "VERIFY_DATABASE_IDENTITY_AND_EMPTINESS" | "VERIFY_NO_PRODUCTION_CREDENTIALS_IN_PROCESS"
  | "VERIFY_PROVISIONING_EVIDENCE" | "CONFIRM_TEARDOWN_PROCEDURE" | "SEPARATE_CONNECTION_APPROVAL";

const WARNINGS: readonly DbGuardWarning[] = Object.freeze(["LOOPBACK_MAY_BE_FORWARDED", "DATABASE_NAME_NOT_PROOF",
  "ATTESTATION_SELF_REPORTED", "CREDENTIAL_ORIGIN_NOT_ESTABLISHED", "NO_CONNECTION_AUTHORIZED"]);
const REQUIREMENTS: readonly DbGuardRequirement[] = Object.freeze(["VERIFY_INSTANCE_IDENTITY",
  "VERIFY_DATABASE_IDENTITY_AND_EMPTINESS", "VERIFY_NO_PRODUCTION_CREDENTIALS_IN_PROCESS", "VERIFY_PROVISIONING_EVIDENCE",
  "CONFIRM_TEARDOWN_PROCEDURE", "SEPARATE_CONNECTION_APPROVAL"]);

const reject = (reason: DbGuardReason): DbTargetGuardResult => ({ ...base, status: "REJECTED", reason });

/** Own data properties only; getters never executed; exact key set required. */
function readExact(v: unknown, keys: readonly string[]): Record<string, unknown> | DbGuardReason {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return "NOT_AN_OBJECT";
  const own = Reflect.ownKeys(v);
  if (own.some((k) => typeof k !== "string" || !keys.includes(k))) return "UNEXPECTED_FIELD";
  const out: Record<string, unknown> = {};
  for (const k of keys) {
    const d = Object.getOwnPropertyDescriptor(v, k);
    if (!d) return "MISSING_FIELD";
    if (!("value" in d)) return "ACCESSOR_FIELD";
    out[k] = d.value;
  }
  return out;
}

function classifyHost(host: string): DbGuardReason | "ipv4_loopback" | "ipv6_loopback" {
  const h = host.toLowerCase();
  if (h === "") return "MISSING_HOST";
  if (h === "127.0.0.1") return "ipv4_loopback";
  if (h === "[::1]") return "ipv6_loopback";
  if (h === "localhost" || h.endsWith(".localhost")) return "LOCALHOST_AMBIGUOUS";
  if (/(^|\.)supabase\.(co|com|in|net)$/.test(h) || h.includes("supabase") || h.includes("pooler")) return "SUPABASE_HOST";
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h) || h.startsWith("[")) {
    // Any other IP literal (incl. other 127.x, private ranges, IPv4-mapped IPv6) is not on the strict allowlist.
    const priv = /^(10\.|127\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|0\.)/.test(h) || h.startsWith("[");
    return priv ? "NON_LOOPBACK_HOST" : "PUBLIC_IP";
  }
  return "NON_LOOPBACK_HOST"; // hostnames, container/service aliases, etc.
}

export function validateDisposableDbTarget(input: unknown): DbTargetGuardResult {
  const c = readExact(input, CONFIG_KEYS);
  if (typeof c === "string") return reject(c);
  if (c["version"] !== DB_GUARD_CONFIG_VERSION) return reject("UNSUPPORTED_VERSION");

  const url = c["url"];
  if (typeof url !== "string" || url.length === 0 || url.length > 256) return reject("INVALID_URL");
  const scheme = /^([A-Za-z][A-Za-z0-9+.-]*):\/\//.exec(url);
  if (!scheme) return reject(url.startsWith("/") || /host=\//i.test(url) ? "UNIX_SOCKET" : "INVALID_URL");
  if (scheme[1] !== "postgresql" && scheme[1] !== "postgres") return reject("UNSUPPORTED_SCHEME");
  const rest = url.slice(scheme[0].length);
  if (rest.includes("@")) return reject("CREDENTIALS_IN_URL");
  if (rest.includes("?")) return reject("QUERY_PARAMETERS");
  if (rest.includes("#")) return reject("URL_FRAGMENT");
  if (rest.includes(",")) return reject("MULTIPLE_HOSTS");
  if (/[^A-Za-z0-9.:/\[\]_-]/.test(rest)) return reject("UNSAFE_URL_CHARACTERS");
  const slash = rest.indexOf("/");
  const authority = slash === -1 ? rest : rest.slice(0, slash);
  const path = slash === -1 ? "" : rest.slice(slash + 1);
  if (authority === "" && path !== "") return reject("UNIX_SOCKET");
  const m = /^(\[[0-9A-Fa-f:.]+\]|[^:\[\]]*)(?::([^:]*))?$/.exec(authority);
  if (!m) return reject("INVALID_URL");
  const hostKind = classifyHost(m[1] ?? "");
  if (hostKind !== "ipv4_loopback" && hostKind !== "ipv6_loopback") return reject(hostKind);
  const portStr = m[2];
  if (portStr === undefined || portStr === "") return reject("MISSING_PORT");
  if (!/^[1-9]\d{0,4}$/.test(portStr)) return reject("INVALID_PORT");
  const port = Number(portStr);
  if (port < 1024 || port > 65535) return reject("INVALID_PORT");
  if ((DB_GUARD_FORBIDDEN_PORTS as readonly number[]).includes(port)) return reject("DEFAULT_PORT");
  if (path === "") return reject("MISSING_DATABASE");
  if (path.includes("/")) return reject("INVALID_DATABASE_NAME");
  if (!path.startsWith("gsw_disposable_")) {
    const low = path.toLowerCase();
    return reject(FORBIDDEN_DB_TOKENS.some((t) => low.includes(t)) ? "PRODUCTION_LIKE_DATABASE" : "INVALID_DATABASE_NAME");
  }
  if (!DB_GUARD_DB_NAME.test(path)) return reject("INVALID_DATABASE_NAME");
  const runSuffix = path.slice("gsw_disposable_".length);
  if (FORBIDDEN_DB_TOKENS.some((t) => runSuffix.includes(t))) return reject("PRODUCTION_LIKE_DATABASE");

  if (c["sslMode"] !== "disable") return reject("UNSUPPORTED_SSL_MODE");
  if (c["disposableDeclared"] !== true) return reject("DISPOSABLE_NOT_DECLARED");
  if (c["forbiddenCredentialSourcesExcluded"] !== true) return reject("CREDENTIAL_SOURCES_NOT_EXCLUDED");

  const a = readExact(c["attestation"], ATTEST_KEYS);
  if (typeof a === "string") return reject("INVALID_ATTESTATION");
  for (const k of ["environmentId", "expectedInstanceId", "testRunId", "provisioningEvidenceRef"])
    if (typeof a[k] !== "string" || !ID.test(a[k] as string)) return reject("INVALID_ATTESTATION");
  if (a["expectedDatabase"] !== path) return reject("ATTESTATION_DATABASE_MISMATCH");
  if (a["testRunId"] !== runSuffix) return reject("ATTESTATION_RUN_MISMATCH");
  if (a["teardownOwner"] !== "test_harness") return reject("INVALID_TEARDOWN_OWNER");
  if (a["environmentId"] === a["expectedInstanceId"]) return reject("INVALID_ATTESTATION");

  return {
    ...base, status: "CANDIDATE_ONLY", reason: "LOCAL_CHECKS_PASSED",
    target: Object.freeze({ hostKind, port }), warnings: WARNINGS, remainingVerification: REQUIREMENTS,
  };
}
