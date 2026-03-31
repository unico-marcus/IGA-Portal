#!/usr/bin/env node
/**
 * Seed Systems + System Roles (Permissions) from CSV
 *
 * Lê data/system_roles.csv e popula as tabelas System e Permission no banco.
 * Usa upsert — não apaga dados existentes, pode ser rodado múltiplas vezes.
 *
 * Lógica:
 *  - Sistema = prefixo antes do " - " no campo name  (ex: "ADP - Meu Unico" → "ADP")
 *  - Permission.name = technical_id                   (ex: "sr-adp-meu-unico")
 *  - Criticality = risco da SR: Alto→HIGH, Medio→MED, *→LOW
 *    (sistema herda a criticidade mais alta das suas SRs)
 *
 * Usage:
 *   node scripts/seed-systems.mjs
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import readline from "readline";
import { PrismaClient } from "@prisma/client";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");

const prisma = new PrismaClient();

// ─── CSV ─────────────────────────────────────────────────────────────────────

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

// ─── Helpers ─────────────────────────────────────────────────────────────────

function toSystemName(roleName) {
  const idx = roleName.indexOf(" - ");
  return idx > 0 ? roleName.slice(0, idx).trim() : roleName.trim();
}

function toCriticality(risk) {
  const r = (risk ?? "").toLowerCase();
  if (r === "alto") return "HIGH";
  if (r === "medio") return "MED";
  return "LOW";
}

const critRank = { HIGH: 3, MED: 2, LOW: 1 };
function maxCrit(a, b) {
  return critRank[a] >= critRank[b] ? a : b;
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log("\nSeed: Systems + System Roles\n");

  process.stdout.write("Lendo system_roles.csv... ");
  const rows = await readCsv(path.join(ROOT, "data/system_roles.csv"));
  const active = rows.filter((r) => r.is_current?.toLowerCase() === "true" && r.technical_id);
  console.log(`${active.length} SRs ativas`);

  // Deduplica por technical_id (pode ter duplicatas com is_current=true de snapshots)
  const srMap = new Map();
  for (const r of active) {
    if (!srMap.has(r.technical_id)) srMap.set(r.technical_id, r);
  }
  const srs = [...srMap.values()];

  // Agrupa por sistema
  const systemMap = new Map(); // systemName → { criticality: string, roles: row[] }
  for (const sr of srs) {
    const sysName = toSystemName(sr.name);
    const crit = toCriticality(sr.risk);
    if (!systemMap.has(sysName)) {
      systemMap.set(sysName, { criticality: crit, roles: [] });
    }
    const entry = systemMap.get(sysName);
    entry.criticality = maxCrit(entry.criticality, crit);
    entry.roles.push(sr);
  }

  console.log(`${systemMap.size} sistemas únicos, ${srs.length} SRs únicas`);

  // Upsert sistemas
  process.stdout.write("Criando/atualizando sistemas... ");
  let sysOk = 0;
  for (const [name, { criticality }] of systemMap) {
    await prisma.system.upsert({
      where: { name },
      create: { name, criticality },
      update: { criticality },
    });
    sysOk++;
  }
  console.log(`${sysOk} sistemas`);

  // Buscar IDs dos sistemas
  const dbSystems = await prisma.system.findMany({ select: { id: true, name: true } });
  const sysIdMap = new Map(dbSystems.map((s) => [s.name, s.id]));

  // Upsert permissions (system roles)
  process.stdout.write("Criando/atualizando system roles (permissions)... ");
  let srOk = 0, srErr = 0;
  for (const [sysName, { roles }] of systemMap) {
    const systemId = sysIdMap.get(sysName);
    if (!systemId) continue;
    for (const sr of roles) {
      try {
        await prisma.permission.upsert({
          where: { systemId_name: { systemId, name: sr.technical_id } },
          create: {
            systemId,
            name: sr.technical_id,
            description: sr.name,
          },
          update: {
            description: sr.name,
          },
        });
        srOk++;
      } catch {
        srErr++;
      }
    }
  }
  console.log(`${srOk} OK, ${srErr} erros`);

  console.log("\nConcluído.\n");
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => {
    console.error(e);
    prisma.$disconnect();
    process.exit(1);
  });
