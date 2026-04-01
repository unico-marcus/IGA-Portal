#!/usr/bin/env node
/**
 * Keycloak Import Script
 *
 * Populates Keycloak realm "iga" with:
 *  - Groups  → from data/system_roles.csv  (technical_id, is_current=true)
 *  - Users   → from data/users.csv         (status=ATIVO, is_current=true, has email)
 *  - Members → from data/snapshot_user_entitlements_detailed.csv (email → item_technical_id)
 *
 * Usage:
 *   node scripts/keycloak-import.mjs
 *
 * Reads KEYCLOAK_BASE_URL, KEYCLOAK_REALM from .env (or environment).
 * Admin credentials default to admin/admin (docker-compose defaults).
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import readline from "readline";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");

// ─── Config ─────────────────────────────────────────────────────────────────

function loadEnv() {
  const envPath = path.join(ROOT, ".env");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (m) process.env[m[1].trim()] ??= m[2].trim().replace(/^["']|["']$/g, "");
  }
}

loadEnv();

const KC_BASE = (process.env.KEYCLOAK_BASE_URL ?? "http://localhost:8080").replace(/\/$/, "");
const KC_REALM = process.env.KEYCLOAK_REALM ?? "iga";
const KC_ADMIN_USER = process.env.KC_BOOTSTRAP_ADMIN_USERNAME ?? "admin";
const KC_ADMIN_PASS = process.env.KC_BOOTSTRAP_ADMIN_PASSWORD ?? "admin";
const TEMP_PASSWORD = "Mudar@123";
const BATCH = 10;

// ─── CSV parser ──────────────────────────────────────────────────────────────

async function readCsv(filePath) {
  const rows = [];
  const rl = readline.createInterface({ input: fs.createReadStream(filePath), crlfDelay: Infinity });
  let headers = null;
  for await (const line of rl) {
    if (!line.trim()) continue;
    if (!headers) { headers = line.split(","); continue; }
    const values = line.split(",");
    const row = {};
    headers.forEach((h, i) => { row[h.trim()] = (values[i] ?? "").trim(); });
    rows.push(row);
  }
  return rows;
}

// ─── Keycloak API ────────────────────────────────────────────────────────────

async function getAdminToken() {
  const res = await fetch(`${KC_BASE}/realms/master/protocol/openid-connect/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: "admin-cli",
      grant_type: "password",
      username: KC_ADMIN_USER,
      password: KC_ADMIN_PASS,
    }),
  });
  if (!res.ok) throw new Error(`Auth failed: ${res.status} ${await res.text()}`);
  const { access_token } = await res.json();
  return access_token;
}

function adminUrl(path) {
  return `${KC_BASE}/admin/realms/${KC_REALM}${path}`;
}

async function kcPost(token, path, body) {
  const res = await fetch(adminUrl(path), {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.status;
}

async function kcPut(token, path) {
  const res = await fetch(adminUrl(path), {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}` },
  });
  return res.status;
}

async function kcGetAll(token, path, pageSize = 100) {
  const results = [];
  let first = 0;
  while (true) {
    const sep = path.includes("?") ? "&" : "?";
    const res = await fetch(adminUrl(`${path}${sep}first=${first}&max=${pageSize}`), {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`GET ${path} failed: ${res.status}`);
    const page = await res.json();
    results.push(...page);
    if (page.length < pageSize) break;
    first += pageSize;
  }
  return results;
}

// ─── Batch runner ────────────────────────────────────────────────────────────

async function runBatches(items, fn) {
  let ok = 0, skip = 0, err = 0;
  for (let i = 0; i < items.length; i += BATCH) {
    const batch = items.slice(i, i + BATCH);
    const results = await Promise.allSettled(batch.map(fn));
    for (const r of results) {
      if (r.status === "rejected") err++;
      else if (r.value === 409) skip++;
      else ok++;
    }
  }
  return { ok, skip, err };
}

// ─── Keycloak realm/client setup ─────────────────────────────────────────────

async function ensureRealm(token) {
  const res = await fetch(`${KC_BASE}/admin/realms/${KC_REALM}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 200) return; // já existe
  const create = await fetch(`${KC_BASE}/admin/realms`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ realm: KC_REALM, enabled: true, displayName: "IGA Portal" }),
  });
  if (!create.ok) throw new Error(`Falha ao criar realm: ${create.status} ${await create.text()}`);
}

async function ensureClient(token) {
  // Busca client existente
  const res = await fetch(`${KC_BASE}/admin/realms/${KC_REALM}/clients?clientId=iga-portal`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const clients = await res.json();
  if (clients.length > 0) return clients[0].id;

  // Cria client
  const create = await fetch(`${KC_BASE}/admin/realms/${KC_REALM}/clients`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      clientId: "iga-portal",
      name: "IGA Portal",
      protocol: "openid-connect",
      enabled: true,
      publicClient: false,
      standardFlowEnabled: true,
      directAccessGrantsEnabled: false,
      redirectUris: ["http://localhost:3000/*"],
      webOrigins: ["http://localhost:3000"],
    }),
  });
  if (!create.ok) throw new Error(`Falha ao criar client: ${create.status} ${await create.text()}`);

  const again = await fetch(`${KC_BASE}/admin/realms/${KC_REALM}/clients?clientId=iga-portal`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const list = await again.json();
  return list[0].id;
}

async function ensureGroupsMapper(token, clientId) {
  // Verifica se já existe mapper "groups"
  const res = await fetch(`${KC_BASE}/admin/realms/${KC_REALM}/clients/${clientId}/protocol-mappers/models`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const mappers = await res.json();
  if (mappers.some((m) => m.name === "groups")) return;

  const create = await fetch(`${KC_BASE}/admin/realms/${KC_REALM}/clients/${clientId}/protocol-mappers/models`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "groups",
      protocol: "openid-connect",
      protocolMapper: "oidc-group-membership-mapper",
      consentRequired: false,
      config: {
        "full.path": "false",
        "id.token.claim": "true",
        "access.token.claim": "true",
        "userinfo.token.claim": "true",
        "claim.name": "groups",
      },
    }),
  });
  if (!create.ok) throw new Error(`Falha ao criar mapper: ${create.status} ${await create.text()}`);
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\nKeycloak Import → ${KC_BASE} / realm: ${KC_REALM}\n`);

  // Auth
  process.stdout.write("Autenticando no Keycloak... ");
  const token = await getAdminToken();
  console.log("OK");

  // Realm + Client + Mapper
  process.stdout.write("Verificando realm e client... ");
  await ensureRealm(token);
  const clientId = await ensureClient(token);
  console.log("OK");

  process.stdout.write("Verificando mapper de grupos no token... ");
  await ensureGroupsMapper(token, clientId);
  console.log("OK\n");

  // ── Passo 1: Grupos ────────────────────────────────────────────────────────
  process.stdout.write("Lendo system_roles.csv... ");
  const srRows = await readCsv(path.join(ROOT, "data/system_roles.csv"));
  const groupNames = [
    ...new Set(
      srRows
        .filter((r) => r.is_current?.toLowerCase() === "true" && r.technical_id)
        .map((r) => r.technical_id)
    ),
  ];
  console.log(`${groupNames.length} grupos únicos`);

  process.stdout.write("Criando grupos... ");
  const grStats = await runBatches(groupNames, (name) => kcPost(token, "/groups", { name }));
  console.log(`${grStats.ok} criados, ${grStats.skip} já existiam, ${grStats.err} erros`);

  // ── Passo 2: Usuários ──────────────────────────────────────────────────────
  process.stdout.write("\nLendo users.csv... ");
  const userRows = await readCsv(path.join(ROOT, "data/users.csv"));
  const usersToCreate = userRows.filter(
    (r) =>
      r.status?.toUpperCase() === "ATIVO" &&
      r.is_current?.toLowerCase() === "true" &&
      r.email?.includes("@")
  );
  console.log(`${usersToCreate.length} usuários ativos com email`);

  process.stdout.write("Criando usuários... ");
  const usStats = await runBatches(usersToCreate, (u) => {
    const parts = (u.name ?? "").trim().split(/\s+/);
    const firstName = parts[0] ?? u.email.split("@")[0];
    const lastName = parts.slice(1).join(" ") || "-";
    return kcPost(token, "/users", {
      username: u.email.toLowerCase(),
      email: u.email.toLowerCase(),
      firstName,
      lastName,
      enabled: true,
      credentials: [{ type: "password", value: TEMP_PASSWORD, temporary: true }],
    });
  });
  console.log(`${usStats.ok} criados, ${usStats.skip} já existiam, ${usStats.err} erros`);

  // ── Passo 3: Buscar IDs ────────────────────────────────────────────────────
  process.stdout.write("\nBuscando IDs de grupos no Keycloak... ");
  const kcGroups = await kcGetAll(token, "/groups", 500);
  const groupIdMap = new Map(kcGroups.map((g) => [g.name, g.id]));
  console.log(`${groupIdMap.size} grupos`);

  process.stdout.write("Buscando IDs de usuários no Keycloak... ");
  const kcUsers = await kcGetAll(token, "/users", 100);
  const userIdMap = new Map(kcUsers.map((u) => [u.email?.toLowerCase(), u.id]));
  console.log(`${userIdMap.size} usuários`);

  // ── Passo 4: Memberships ───────────────────────────────────────────────────
  process.stdout.write("\nLendo entitlements... ");
  const entRows = await readCsv(path.join(ROOT, "data/snapshot_user_entitlements_detailed.csv"));

  // Deduplica pares (email, group)
  const membershipSet = new Set();
  for (const r of entRows) {
    const email = r.email?.toLowerCase();
    const group = r.item_technical_id;
    if (email && group) membershipSet.add(`${email}||${group}`);
  }

  const memberships = [...membershipSet]
    .map((pair) => {
      const [email, group] = pair.split("||");
      return { email, group, userId: userIdMap.get(email), groupId: groupIdMap.get(group) };
    })
    .filter((m) => m.userId && m.groupId);

  console.log(`${membershipSet.size} pares únicos → ${memberships.length} válidos (user+grupo existem)`);

  process.stdout.write("Adicionando memberships... ");
  const memStats = await runBatches(memberships, (m) =>
    kcPut(token, `/users/${m.userId}/groups/${m.groupId}`)
  );
  console.log(`${memStats.ok} adicionados, ${memStats.skip} já existiam, ${memStats.err} erros`);

  console.log("\nImportação concluída.\n");
}

main().catch((e) => {
  console.error("\nErro fatal:", e.message);
  process.exit(1);
});
