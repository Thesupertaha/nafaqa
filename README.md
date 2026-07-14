# Nafaqa Backend

Production backend for the Nafaqa AI Expense Tracker — NestJS + Prisma + PostgreSQL, implementing the auth, ledger, budgets, and AI chat extraction slice of the full application design.

**Companion documents:** PRD · System Architecture · Database Design · AI System Design · Mobile App Design · Design System · Platform Integrations · Security Review & Architecture

---

## What's implemented in this slice

- **Auth:** email/password registration and login, JWT access tokens, refresh-token-family rotation with reuse detection (Security Review Section 6), logout/session revocation.
- **Users:** profile read/update, account deletion (cascading per the Database Design's cascade rules).
- **Reference data:** currencies (ISO 4217), countries (launch markets), categories (system defaults + per-user custom).
- **Accounts:** bank/cash/wallet account CRUD, fully ownership-scoped.
- **Transactions:** idempotent creation (safe client retries), filtering/pagination, soft delete, full audit logging.
- **Budgets:** CRUD plus live spent-vs-limit progress calculation with the three-tier warning logic from the Design System.
- **AI Chat:** natural-language expense logging (English/Arabic/mixed) via an OpenAI-compatible API, with the full validation pipeline from the AI System Design and the prompt-injection isolation from the Security Review (Section 10).
- **Health check**, structured logging (PII-redacted), global exception handling, rate limiting.

### Not yet implemented in this slice (see the referenced design docs for full specs)
SMS/notification ingestion pipeline (`message_imports`), receipts, tags, recurring transactions, rules/personalization overrides, notifications, devices/sessions tables, Open Banking integration, bank/bank_sender_ids reference data. Each follows the exact same module pattern established here (`module.ts` / `service.ts` / `controller.ts` / `dto/`) — see **Extending the backend** below.

---

## Prerequisites
- Node.js 20+
- Docker & Docker Compose (recommended for local development)
- An OpenAI-compatible API key (for the AI chat feature — everything else works without one)

---

## Quick start (Docker Compose — recommended)

```bash
cp .env.example .env
# edit .env and set OPENAI_API_KEY if you want to test the AI chat endpoint

docker compose up -d --build
docker compose exec backend npm run prisma:migrate:deploy
docker compose exec backend npm run prisma:seed
```

The API is now running at `http://localhost:3000/api/v1`, with Adminer (DB browser) at `http://localhost:8080` (server: `db`, user: `nafaqa`, password: `nafaqa_dev_password`, database: `nafaqa`).

Verify it's healthy:
```bash
curl http://localhost:3000/api/health
```

---

## Quick start (without Docker)

```bash
npm install
cp .env.example .env
# point DATABASE_URL in .env at your own local PostgreSQL instance

npm run prisma:generate
npm run prisma:migrate
npm run prisma:seed
npm run start:dev
```

---

## Running tests

```bash
# Unit tests (no database required — everything is mocked)
npm run test
npm run test:cov     # with coverage report

# E2E tests (requires a real database — DATABASE_URL must point to one)
docker compose up -d db redis
npx prisma migrate deploy
npm run test:e2e
```

The e2e suite (`test/*.e2e-spec.ts`) exercises real HTTP requests against a running Nest application backed by a real database — including a full registration → login → refresh-token-reuse-detection flow (`auth.e2e-spec.ts`) and a two-user ownership-isolation test proving one user can never read or delete another's transactions (`transactions.e2e-spec.ts`).

---

## API overview

All endpoints are versioned under `/api/v1/`. Protected routes require `Authorization: Bearer <accessToken>`.

| Method | Path | Description |
|---|---|---|
| POST | `/auth/register` | Create an account, returns access + refresh tokens |
| POST | `/auth/login` | Authenticate, returns access + refresh tokens |
| POST | `/auth/refresh` | Rotate the refresh token (family-tracked, reuse-detected) |
| POST | `/auth/logout` | Revoke the current refresh token family |
| GET/PATCH/DELETE | `/users/me` | Profile management, account deletion |
| GET | `/reference/currencies` `/countries` `/categories` | Reference data |
| CRUD | `/accounts` | Bank/cash/wallet accounts |
| CRUD | `/transactions` | Ledger, with query filtering and pagination |
| CRUD | `/budgets` | Budgets with live progress |
| POST | `/ai/chat` | Natural-language expense logging (`{ chatId?, message }`) |
| GET | `/health` | Liveness/readiness probe |

---

## Extending the backend

Every module follows the same shape:
```
src/<feature>/
  <feature>.module.ts
  <feature>.service.ts       (Prisma queries, always scoped to userId)
  <feature>.controller.ts    (guards: JwtAuthGuard + OwnershipGuard where a :id param is involved)
  dto/
    create-<feature>.dto.ts
    update-<feature>.dto.ts
  <feature>.service.spec.ts
```
To add one of the not-yet-implemented tables (e.g. `message_imports`), add its model to `prisma/schema.prisma` (already fully specified in `Database_Design.md`/`database_schema.sql`), run `prisma migrate dev`, and scaffold the module following the pattern above — the `TransactionsModule` is the most complete reference example (idempotency, audit logging, ownership scoping).

---

## Docker

- `Dockerfile` — multi-stage build (deps → build → slim production runtime), runs as a non-root user, includes a container-level health check.
- `docker-compose.yml` — backend + PostgreSQL + Redis + Adminer for local development.

Build the production image directly:
```bash
docker build -t nafaqa-backend:latest .
```

---

## CI/CD

- **`.github/workflows/ci.yml`** — runs on every push/PR: lint, Prisma generate/migrate/seed against a disposable Postgres service container, unit tests with coverage, e2e tests, production build, Docker build validation (no push).
- **`.github/workflows/deploy.yml`** — runs on merge to `main`: builds and pushes the image to ECR, runs `prisma migrate deploy` against the production database, renders and deploys a new ECS task definition, waits for service stability. Requires these repository secrets: `AWS_DEPLOY_ROLE_ARN`, `PROD_DATABASE_URL`.

---

## Deployment

Infrastructure is defined in `deploy/terraform/main.tf`, matching the System Architecture's cloud design: ECS Fargate (2-10 tasks, CPU-target autoscaling at 65%), an internet-facing ALB, private subnets, a security group chain restricting the backend to ALB-only ingress, least-privilege IAM roles (the task role can only decrypt via the app's own KMS key), and a KMS CMK with automatic annual rotation matching the Security Review's key hierarchy.

```bash
cd deploy/terraform
terraform init
terraform plan -var="environment=production"
terraform apply
```

Populate the secrets referenced in `deploy/ecs-task-definition.json` (`DATABASE_URL`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `OPENAI_API_KEY`, `REDIS_URL`) in AWS Secrets Manager under the `nafaqa/*` prefix before the first deploy — the task definition reads them by ARN, never as plain environment variables.

---

## Security notes specific to this implementation

- Passwords are hashed with bcrypt (12 rounds) — never logged, never returned in any API response.
- Refresh tokens are rotated on every use; a reused (already-rotated) token immediately revokes the entire session family (see `auth.service.spec.ts` and `auth.e2e-spec.ts` for the exact mechanics).
- Every `:id` route is protected by both `JwtAuthGuard` (who are you) and `OwnershipGuard` (do you own this specific resource) — a request for another user's resource returns `404`, never `403`, to avoid ID-enumeration disclosure.
- The AI chat endpoint is the **only** code path holding the LLM provider credential; the validation layer (`AiExtractionValidatorService`) treats every model output as untrusted input and never lets a category/currency/amount reach the database without being checked against real reference data.
- Rate limiting is applied globally (100 req/min) with tighter overrides on `/auth/login` (5/min) and `/ai/chat` (20/min) per the Security Review's OWASP API4 mitigation.
