# IGA Portal (Vision) - Local MVP

Portal de governanca de acessos com SSO Keycloak, fluxo de solicitacao/aprovacao e execucao via n8n.

## Leitura Recomendada

1. `PROJECT_CONTEXT.md` (contexto tecnico detalhado para novas sessoes de coding)
2. Este `README.md` (setup, operacao e troubleshooting)

## Stack

- Next.js 16 (App Router) + TypeScript + Tailwind
- Prisma + PostgreSQL
- SSO Keycloak (OIDC Authorization Code)
- SCIM 2.0 inbound (portal como SCIM Server)
- Sessao local assinada em cookie httpOnly
- Integracao n8n via webhook HMAC
- Testes com Vitest

## Estrutura

- `app/` rotas UI + rotas API (`app/api/...`)
- `lib/` autenticacao, RBAC, DB, integracoes, validacoes
- `prisma/` schema e seed
- `scripts/` carga/sincronizacao de dados do orquestrador
- `data/` CSVs do orquestrador para carga local

## Requisitos

- Node.js 20+
- npm 10+
- Docker Desktop

## Infra (Postgres/Keycloak)

A partir da raiz do projeto:

```bash
docker compose up -d
```

Servicos usados:

- Postgres: `localhost:5432` (`iga_portal`)
- Keycloak: `http://localhost:8080`
- (Opcional) pgAdmin: `http://localhost:5050` — sobe com `docker compose --profile tools up -d`

### Configuracao inicial do Keycloak (primeira vez)

1. Acesse `http://localhost:8080` — login `admin / admin`
2. Crie realm `iga`
3. Crie client `iga-portal` (OpenID Connect, Standard Flow)
   - Valid Redirect URIs: `http://localhost:3000/*`
   - Web Origins: `http://localhost:3000`
4. Em **Client Scopes > roles > Mappers**, adicione mapper `groups`:
   - Tipo: Group Membership
   - Token Claim Name: `groups`
   - Marque: Add to ID token, Access token, Userinfo
5. Copie o **Client Secret** gerado para o `.env`

## Configuracao de Ambiente

No projeto `iga-portal`:

```bash
cp .env.example .env
# Edite .env com o KEYCLOAK_CLIENT_SECRET gerado no passo acima
```

Variaveis principais (`.env`):

- `DATABASE_URL`
- `SESSION_SECRET`
- `APP_URL` (default local: `http://localhost:3000`)
- `KEYCLOAK_BASE_URL`
- `KEYCLOAK_REALM`
- `KEYCLOAK_CLIENT_ID`
- `KEYCLOAK_CLIENT_SECRET`
- `SCIM_BEARER_TOKEN`
- `N8N_WEBHOOK_URL`
- `N8N_HMAC_SECRET`

## Setup Rapido

```powershell
npm install
npm run prisma:generate
npm run prisma:migrate -- --name init
npm run prisma:seed
npm run dev
```

Abrir:

- `http://localhost:3000/login`

## Scripts NPM

- `npm run dev` inicia app em desenvolvimento
- `npm run build` build de producao
- `npm run start` sobe app buildada
- `npm run test` executa testes
- `npm run test:coverage` cobertura de testes
- `npm run lint` lint
- `npm run prisma:generate` gera Prisma Client
- `npm run prisma:migrate` aplica migracoes
- `npm run prisma:seed` popula base local
- `npm run quality:sonar` executa scan Sonar

## Credenciais e Perfis

### SSO (Keycloak)

- Login principal via `Entrar com SSO`
- Realm esperado: `iga`
- Client esperado: `iga-portal`
- Importante: client deve publicar claim `groups` nos tokens para sincronismo de grupos no callback OIDC.

### Seed de dados portal (DB local)

Usuarios seedados no banco do portal:

- `admin@iga.local` (ADMIN)
- `manager@iga.local` (MANAGER)
- `ana@iga.local` (USER)
- `joao@iga.local` (USER)

Observacao: autenticacao da UI e via SSO; esses usuarios seed servem como base de dados/autorizacao interna.

## Rotas de UI

- `/login`
- `/`
- `/my-access`
- `/my-requests`
- `/request/new`
- `/requests/[id]`
- `/manager/team`
- `/manager/approvals`
- `/admin` (dashboard admin)
- `/admin/systems` (entrada de Administracao)
- `/admin/operation`
- `/admin/uar`
- `/admin/scim`
- `/admin/users`
- `/admin/system-roles`
- `/admin/business-roles`
- `/admin/assignment`
- `/admin/requests`
- `/admin/logs`
- `/admin/user-management` (menu dedicado no sidebar)

## Rotas API Principais

Auth:

- `GET /api/auth/login`
- `GET /api/auth/callback`
- `POST /api/auth/logout`

SCIM (Keycloak provisioning):

- `GET /api/scim/v2/ServiceProviderConfig`
- `GET /api/scim/v2/ResourceTypes`
- `GET /api/scim/v2/Schemas`
- `GET/POST /api/scim/v2/Users`
- `GET/PUT/PATCH/DELETE /api/scim/v2/Users/:id`

Self-service:

- `GET /api/me`
- `GET /api/my-access`
- `GET /api/my-business-roles`
- `GET/POST /api/requests`
- `GET /api/requests/:id`

Aprovacao:

- `GET /api/manager/team`
- `GET /api/manager/approvals`
- `POST /api/requests/:id/approve`
- `POST /api/requests/:id/reject`

Admin:

- `GET/POST /api/admin/systems`
- `GET/POST /api/admin/business-roles`
- `GET/POST /api/admin/users`
- `POST /api/admin/operation` (ADD_SR_TO_USER, RECON_BR, RECON_SR)
- `GET /api/admin/uar/settings`
- `PUT /api/admin/uar/settings`
- `GET/POST /api/users/:id/additional-accesses`
- `GET/PUT /api/admin/scim/settings`
- `POST /api/admin/scim/test`
- `GET /api/admin/scim/audit`
- `GET /api/admin/logs/export/settings`
- `PUT /api/admin/logs/export/settings`
- `POST /api/admin/logs/export/run`

Busca global:

- `GET /api/search/global?q=...`

## Integracao com Orquestrador (CSV)

Arquivos CSV em `data/` podem ser carregados para tabelas espelho do orquestrador.

Fluxos:

1. Carga CSV no banco:

```powershell
.\scripts\load-orchestrator-data.ps1
```

2. Sincronizacao para tabelas do portal:

```powershell
.\scripts\sync-orchestrator-to-portal.ps1
```

Ou executar somente a carga (sem sync):

```powershell
.\scripts\load-orchestrator-data.ps1 -SkipPortalSync
```

## Integracao com Banco Legado Existente (sem CSV)

Quando as tabelas legado ja existem no banco (mesma nomenclatura dos CSV), use o fluxo direto:

1. Validar contrato minimo de schema legado:

```powershell
.\scripts\validate-legacy-schema.ps1
```

2. Sincronizar dados legado -> tabelas de dominio do portal:

```powershell
.\scripts\sync-orchestrator-direct.ps1
```

Observacoes:

- Nesse modo, **nao** execute `load-orchestrator-data.ps1`.
- O script direto roda preflight + sync SQL.
- Tabelas adicionais do portal continuam ativas normalmente (`Session`, `AccessRequest`, `AuditLog`, `ScimSettings`, etc.).

Plano de cutover detalhado:

- `LEGACY_DB_CUTOVER.md`

## Modelo de Seguranca

- RBAC por papel (`USER`, `MANAGER`, `ADMIN`)
- Precedencia de papel: `ADMIN > MANAGER > USER`
- Grupo KC/SCIM `sr-security-cybersec-iam` promove para `ADMIN`
- Usuario com liderados diretos ativos recebe contexto/perfil de `MANAGER`
- Sessao assinada (cookie `iga_session` + hash em banco)
- Login SSO com validacao de state OIDC
- Auditoria de eventos relevantes (`AuditLog`)
- Validacao de payload com zod nas rotas sensiveis
- Idempotencia em requisicoes/execucoes de acesso
- Segredos de SCIM Settings criptografados em repouso e mascarados em respostas

## SCIM 2.0 Settings (Admin)

Pagina: `/admin/scim`

Recursos implementados:

- configuracao por `tenant/environment`
- autenticacao (`bearer_token`, `oauth2`, `api_key`)
- teste de conexao (`ServiceProviderConfig`)
- validacao de schema (`Schemas`)
- mapeamentos de atributos e grupos
- sync/retry/seguranca (flags MVP)
- auditoria paginada de alteracoes e testes

## Atualizacoes (2026-03-05)

- **SSO/Keycloak**:
  - Corrigido callback SSO com hardening para cenarios de tabela legado ausente.
  - Adicionado mapper `groups` no client `iga-portal` (id/access/userinfo token claim), necessario para sincronismo de grupos no callback.
  - Carga definitiva de usuarios do IGA para o realm `iga` e reset massivo de senha com `temporary=true`.

- **RBAC e ownership**:
  - Mantida regra de roles concomitantes em `user_role_assignments` (`USER`, `MANAGER`, `ADMIN`).
  - Regra operacional reforcada: grupo `sr-security-cybersec-iam` promove para `ADMIN`.
  - Desassociacao de grupo admin no Keycloak passa a refletir downgrade apos recomputacao de role.

- **Sincronizacao de dados (orquestrador -> portal)**:
  - Corrigido sync para tratar conflito de email em `User` (evita quebra de carga quando existe usuario SSO previo).
  - Corrigido CTE de `system_roles` no SQL de sync.
  - `UserPermissionAssignment` agora tambem e populada via `snapshot_user_entitlements_detailed` (nao apenas `assignment`), resolvendo "Meus Acessos" vazio para usuarios sem linhas em `assignment`.
  - Origem de acesso do snapshot passou a respeitar pacote/BR (`source=BR` quando houver `pacote_id`).
  - Regra aplicada no sync: SR sem owner explicito herda owner do sistema.

- **Identidade canonica de usuario**:
  - Executada consolidacao de usuarios duplicados (`cmm...` -> `OR-...`) com migracao de referencias relacionais e preservacao de email real.
  - Resultado: cadastro de gestores/liderados passou a refletir corretamente a hierarquia da base legado.

- **Novas telas de ownership**:
  - Criadas: `/my-systems`, `/my-srs`, `/my-brs`.
  - Criados drill-downs:
    - `/my-systems/[id]`
    - `/my-srs/[id]`
    - `/my-brs/[id]`
  - Sidebar agora exibe links de ownership de forma contextual.
  - "Minhas SRs" considera ownership direto da SR e ownership indireto via sistema.

- **Aprovacoes de gestor (dados de homologacao)**:
  - Inseridas SRs de teste com owner no Ikeda e solicitacoes `PENDING_APPROVAL` para validar fila de aprovacao de manager.

## Atualizacoes (2026-03-06)

- **Navegacao e informacao no portal**:
  - Sidebar reorganizado para separar melhor contexto de uso pessoal, ownership e management.
  - Rotulo de menu atualizado de `Time` para `Meu Time`.
  - Ordem visual ajustada para destacar `BR` antes de `SR` onde aplicavel.

- **Minhas BRs / Minhas SRs**:
  - Ajustada listagem de SR em `Minhas BRs` para abrir detalhes na propria tela (painel lateral), sem abrir nova janela.
  - Em detalhes de BR, removida coluna de ID tecnico da SR e priorizado nome amigavel.
  - Em `Minhas SRs` e visoes relacionadas, reforcado contexto para owner com exibicao mais util de origem e estado.

- **Descricao de SR e UX contextual**:
  - Campo `description` de SR padronizado para texto amigavel em portugues, derivado de nome tecnico + sistema.
  - Tooltip/nota de descricao habilitado ao passar mouse sobre SR em telas de acesso e detalhes relevantes.
  - Paginas de SR atualizadas para exibir descricao amigavel ao inves de metadados tecnicos brutos.

- **Acessos e expiracao**:
  - Em `Meus acessos`, origem exibida como `BR` ou `Adicional`.
  - Coluna `Expira em` com regra:
    - origem `BR` => `-`
    - origem `Adicional` => data de expiracao derivada da solicitacao.
  - Em acessos adicionais, paginacao padrao definida para 10 sistemas por pagina.

- **Solicitacao e busca de usuarios**:
  - `Nova solicitacao` ajustada para permitir solicitar para qualquer pessoa da organizacao.
  - Lista de usuarios com busca, no mesmo padrao de usabilidade da tela de origem de espelhamento.

- **Management e compliance**:
  - Estrutura preparada para delegacao temporaria em aprovacoes (ferias/ausencias), com trilha para compliance/auditoria.
  - Previsao de operacao IAM em `Admin > Operation` para delegacao administrativa em cenarios de indisponibilidade do titular.

- **Operacao local / runtime**:
  - Corrigido ambiente de desenvolvimento com limpeza de processos `node` orfaos e validacao do `next dev`.
  - Portal validado em `http://localhost:3000` com redirecionamento esperado para `/login`.

## Atualizacoes (2026-03-09)

- **Meu Time (KPIs de manager)**:
  - Incluidos cards no topo com indicadores operacionais:
    - liderados ativos
    - com business role
    - com acesso adicional
    - total de excecoes
    - acessos criticos
  - Mantida explicacao contextual via hover (`?`) nos titulos dos cards.

- **Ownership BR/SR/Sistemas (UX)**:
  - `Minhas BRs` agora abre painel lateral de resumo ao clicar na BR, com:
    - botao `Fechar`
    - botao `Abrir BR completa` para drill-down da pagina detalhada
  - Em detalhe da BR, descricao de SR no hover foi simplificada para tooltip sem expansao de linha.
  - Em `Meus Sistemas`, removida exibicao do ID tecnico da linha principal.
  - Rotulo de navegacao ajustado para `Meus Sistemas`.

- **Header (topbar) funcional**:
  - Sino de alertas deixou de ser apenas visual e passou a abrir dropdown com alertas priorizados por severidade.
  - Busca global no campo do topo implementada com resultados navegaveis para:
    - Users
    - BRs
    - Sistemas
    - SRs
  - Engrenagem do topo recebeu menu MVP com:
    - acoes rapidas
    - preferencias de interface (modo compacto / reduzir animacoes)
    - atalhos por contexto de papel

- **Admin > Logs**:
  - Nova pagina de observabilidade operacional (`/admin/logs`) com filtros:
    - texto livre
    - acao
    - entidade
    - ator
    - periodo
  - Tabela paginada com visualizacao de detalhes JSON por evento.

- **Exportacao de logs para SIEM/Bucket (MVP)**:
  - Implementada configuracao de exportacao na propria pagina de logs.
  - Destinos suportados:
    - Splunk HEC (SIEM)
    - AWS S3 (bucket, NDJSON)
  - Suporte a:
    - salvamento de credenciais com criptografia em repouso
    - execucao manual por janela de tempo (`from/to`)
    - status da ultima exportacao (data, resultado, mensagem)
    - auditoria de configuracao e execucao de exportacao

## Atualizacoes (2026-03-10)

- **UAR (configuracao operacional IAM)**:
  - `Admin > UAR` agora possui secao de parametros persistidos da campanha de revisao.
  - Parametros disponiveis:
    - periodo de revisao de `Sistema`
    - periodo de revisao de `SR`
    - periodo de revisao de `BR`
    - periodo de revisao de `acesso direto`
    - janela de itens revisados recentemente
    - janela de aviso/prioridade
    - tolerancia de atraso
    - antecedencia de notificacao a owners
    - flag de revogacao automatica
    - flag de justificativa obrigatoria na renovacao
  - As metricas e listas de BR/acessos diretos em `UAR` passaram a usar esses parametros.
  - Auditoria reforcada para `UAR_SETTINGS_UPDATED` com:
    - estado anterior
    - estado novo
    - campos alterados

- **Logs administrativos**:
  - `Admin > Logs` recebeu filtros rapidos no topo para:
    - `UAR Settings`
    - `SCIM Settings`
    - `Export Settings`

- **Operacoes IAM**:
  - O bloco manual de SR em usuario foi convertido para operacao generica de gestao de SR.
  - Campo `Acao` adicionado com:
    - `Grant`
    - `Revoke`
  - Auditoria separada por tipo de acao:
    - `ADMIN_OPERATION_GRANT_SR_TO_USER`
    - `ADMIN_OPERATION_REVOKE_SR_FROM_USER`

## Troubleshooting

### 1) Login nao conclui / volta para `/login`

- Verificar Keycloak ativo em `http://localhost:8080`
- Verificar client/realm no `.env`
- Verificar callback permitido no client Keycloak (`/api/auth/callback`)
- Verificar `APP_URL` alinhado com URL real (`http://localhost:3000`)
- Para acesso em rede local, nao usar `0.0.0.0` em `APP_URL`; usar IP/hostname real (ex.: `http://192.168.1.50:3000`)

### 2) Erro de banco (Prisma)

- Confirmar Postgres ativo
- Rodar novamente:
  - `npm run prisma:generate`
  - `npm run prisma:migrate -- --name init`
  - `npm run prisma:seed`

### 3) Solicitacao aprovada nao provisiona

- Verificar `N8N_WEBHOOK_URL` e `N8N_HMAC_SECRET`
- Em caso de falha de webhook, request pode ir para `FAILED`

### 4) Dados de admin/operacao inconsistentes

- Recarregar CSVs e sincronizar:
  - `load-orchestrator-data.ps1`
  - `sync-orchestrator-to-portal.ps1`

### 5) Sessao invalida apos restart

- Limpar cookie do navegador (`iga_session`) e relogar

## Qualidade e Testes

Executar localmente:

```powershell
npm run lint
npm run test
npm run test:coverage
```

## Contexto Tecnico Completo

Para continuidade de desenvolvimento em novas sessoes, leia:

- `PROJECT_CONTEXT.md`
