/**
 * Runs `supabase db push` against DIRECT_URL from .env.
 *
 * Windows / DNS: if `db.<ref>.supabase.co` fails, use the Session pooler URI from
 * Supabase → Database → Connection string (Session, port 5432). Optional: SUPABASE_CLI_DNS_RESOLVER=https|native
 *
 * Usage: node scripts/supabase-db-push.cjs
 */
const path = require("path");
const { spawnSync } = require("child_process");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

function encodeDbUrlForCli(raw) {
  const trimmed = String(raw).trim().replace(/^["']|["']$/g, "");
  const normalized = trimmed.replace(/^postgresql:/i, "http:");
  let u;
  try {
    u = new URL(normalized);
  } catch {
    throw new Error("DIRECT_URL is not a valid connection string.");
  }
  const user = decodeURIComponent(u.username || "postgres");
  const pass = u.password != null ? decodeURIComponent(u.password) : "";
  const host = u.hostname;
  const port = u.port || "5432";
  let db = (u.pathname || "/postgres").replace(/^\//, "") || "postgres";
  try {
    db = decodeURIComponent(db);
  } catch {
    /* keep raw segment */
  }
  db = db.replace(/["']/g, "") || "postgres";
  // Supabase default DB is "postgres". Typos like .../postgres%22i → postgresi — force default unless postgres_…
  if (db !== "postgres" && db.startsWith("postgres") && !/^postgres_[a-zA-Z0-9]+$/.test(db)) {
    db = "postgres";
  }
  const encUser = encodeURIComponent(user);
  const encPass = encodeURIComponent(pass);
  return `postgresql://${encUser}:${encPass}@${host}:${port}/${db}`;
}

const direct = process.env.DIRECT_URL;
if (!direct) {
  console.error("Set DIRECT_URL in .env (Session pooler or direct Postgres URI for db push — see .env.example).");
  process.exit(1);
}

const dbUrl = encodeDbUrlForCli(direct);
const root = path.join(__dirname, "..");
// Invoke the real binary (not the .cmd shim) so spawnSync works on Windows.
const supabaseBin = path.join(
  root,
  "node_modules",
  "supabase",
  "bin",
  process.platform === "win32" ? "supabase.exe" : "supabase",
);
/** `--include-all` applies pending files even when they sort before the latest remote version (e.g. backfilled migrations). */
const pushArgs = ["db", "push", "--db-url", dbUrl, "--yes", "--include-all"];
const dns = process.env.SUPABASE_CLI_DNS_RESOLVER?.trim();
if (dns === "https" || dns === "native") {
  pushArgs.push("--dns-resolver", dns);
}

// Avoid CLI preferring raw DIRECT_URL from the environment over our sanitized --db-url.
const childEnv = { ...process.env };
delete childEnv.DIRECT_URL;

const result = spawnSync(supabaseBin, pushArgs, {
  cwd: root,
  stdio: "inherit",
  env: childEnv,
  shell: false,
});
if (result.error) throw result.error;
process.exit(result.status === null ? 1 : result.status);
