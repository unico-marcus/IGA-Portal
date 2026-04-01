#!/usr/bin/env bash
set -euo pipefail

# ─── Cores ───────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
info()    { echo -e "${CYAN}[setup]${NC} $*"; }
success() { echo -e "${GREEN}[ok]${NC}    $*"; }
warn()    { echo -e "${YELLOW}[warn]${NC}  $*"; }
error()   { echo -e "${RED}[erro]${NC}  $*"; }

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

echo ""
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${CYAN}  IGA Portal — Setup${NC}"
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

# ─── 1. .env ─────────────────────────────────────────────────────────────────
if [ ! -f "$ROOT/.env" ]; then
  info "Criando .env a partir de .env.example..."
  cp "$ROOT/.env.example" "$ROOT/.env"
  warn ".env criado — preencha KEYCLOAK_CLIENT_SECRET antes de rodar o portal."
else
  success ".env já existe"
fi

# ─── 2. Docker (infra) ───────────────────────────────────────────────────────
info "Verificando Docker..."
if ! command -v docker &>/dev/null; then
  error "Docker não encontrado. Instale o Docker Desktop e tente novamente."
  exit 1
fi

info "Subindo infra (postgres + keycloak)..."
docker compose up -d
success "Containers iniciados"

# ─── 3. Aguardar Postgres ────────────────────────────────────────────────────
info "Aguardando Postgres ficar pronto..."
MAX=30; COUNT=0
until docker exec iga-postgres pg_isready -U iga -d iga_portal &>/dev/null; do
  COUNT=$((COUNT+1))
  if [ $COUNT -ge $MAX ]; then
    error "Postgres não respondeu após ${MAX}s."
    exit 1
  fi
  sleep 1
done
success "Postgres pronto"

# ─── 4. Node deps ────────────────────────────────────────────────────────────
info "Instalando dependências npm..."
npm install --silent
success "Dependências instaladas"

# ─── 5. Prisma generate ──────────────────────────────────────────────────────
info "Gerando Prisma Client..."
npm run prisma:generate --silent
success "Prisma Client gerado"

# ─── 6. Migrations ───────────────────────────────────────────────────────────
info "Aplicando migrations..."
npx prisma migrate deploy
success "Migrations aplicadas"

# ─── 7. Seed base (usuários, BRs de exemplo) ─────────────────────────────────
info "Rodando seed base (prisma/seed.ts)..."
npm run prisma:seed --silent
success "Seed base concluído"

# ─── 8. Seed systems + system roles (CSV) ───────────────────────────────────
info "Importando sistemas e system roles do CSV..."
node scripts/seed-systems.mjs
success "Sistemas e system roles importados"

# ─── 9. Keycloak import (grupos + usuários + memberships) ───────────────────
info "Verificando Keycloak..."
MAX=30; COUNT=0
until curl -sf "http://localhost:8080/realms/master" &>/dev/null; do
  COUNT=$((COUNT+1))
  if [ $COUNT -ge $MAX ]; then
    warn "Keycloak não respondeu após ${MAX}s — pulando importação do Keycloak."
    warn "Rode manualmente depois: node scripts/keycloak-import.mjs"
    SKIP_KC=1
    break
  fi
  sleep 2
done

if [ "${SKIP_KC:-0}" = "0" ]; then
  info "Importando grupos, usuários e memberships no Keycloak..."
  node scripts/keycloak-import.mjs
  success "Keycloak importado"
fi

# ─── Resumo ──────────────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}  Setup concluído!${NC}"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo -e "  Portal:    ${CYAN}http://localhost:3000${NC}"
echo -e "  Keycloak:  ${CYAN}http://localhost:8080${NC}  (admin / admin)"
echo -e "  pgAdmin:   ${CYAN}http://localhost:5050${NC}  (com --profile tools)"
echo ""
echo -e "  ${YELLOW}Próximo passo:${NC} npm run dev"
echo ""
