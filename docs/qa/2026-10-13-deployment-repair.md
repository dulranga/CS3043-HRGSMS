# Azure Web App deployment repair — 13 October 2026

The supplied run was commit `d6399de`, workflow `.github/workflows/dev_hrgsms.yml`,
deploying the Azure Web App `hrgsms`. The current `Imandi` checkout did not contain
that workflow, so it was recovered from local Git history and repaired in place.
No Git branch, commit, push, PR or cloud configuration was created/changed.

## Changes

- Restored the Web App workflow with `dev` push deployment and a `dev`-only
  deployment guard for manual runs, as temporarily authorized by Imandi.
- Added reusable CI with a disposable PostgreSQL 18 service, both database URL
  variables, deterministic `npm ci`, explicit builds of both workspaces and the
  complete frontend/backend suite. The root now also has a real `build` command.
- Upgraded checkout/setup-node, artifact transfer and Azure login to Node 24
  action runtimes; the application stays
  on Node 22 as in the original workflow and Dockerfiles.
- Added `npm start` and a single-port Express wrapper for the built frontend and
  existing API. Deep browser routes load the SPA; API errors, authentication,
  non-HTML legacy API reads and missing assets retain their response behavior.
- Replaced whole-repository upload with a ZIP containing only compiled backend,
  frontend build, SQL migrations, manifests, startup scripts and production
  dependencies. No local `.env`, Git metadata or source/tests are packaged.
- Added post-deployment homepage/session smoke checks, and required the shared CI
  before the separate main-branch Docker/Container Apps workflow publishes images.
- Applied compatible npm lockfile fixes for Express/body-parser/qs, proxy-addr and
  source-map-js. Audit reports zero vulnerabilities, including in the assembled
  production-only package.

## Verification

- `npm run build:backend` and `npm run build:frontend`: passed. The frontend retains
  its existing bundle-size warning. Windows sandbox restrictions required the
  frontend build to run outside the sandbox.
- `npm run test:frontend`: 254 passed.
- `npm run test:deployment`: 2 passed, covering browser routes/assets, JSON legacy
  reads, anonymous API refusal, POST refusals, missing API/assets and missing build.
- Official actionlint 1.7.7: all workflows passed; `git diff --check` passed.
- Assembled the same allowlisted production package and installed its production
  dependencies independently. Started it without backend/frontend source or `.env`
  files, using protected process configuration. Homepage, `/rooms`, deep dashboard
  navigation, compiled JS and anonymous session 401/JSON passed.
- `npm run test:backend`: 213 passed, no failures/skips. Includes clean ordered
  migrations, rollback of a failed migration, idempotent seed, authorization,
  financial reconciliation and reservation/payment concurrency checks. Together
  with frontend and deployment tests, 469 tests passed.

Local Docker Desktop could not start its Linux engine, so local database checks
use the existing suites' temporary schemas on the configured PostgreSQL connection.
The workflow's fresh PostgreSQL service and Linux ZIP deployment still require an
actual GitHub/Azure run after human publication.

## Hosting handoff

Use the restored **Build and deploy SkyNest to Azure Web App - hrgsms** workflow
with `dev` selected. The separate Container Apps workflow targets `main` and is not
the failing workflow from the supplied log. The original generated
`AZUREAPPSERVICE_*` GitHub secret names are preserved.

Confirm the Azure Web App uses Linux Node 22, `NODE_ENV=production`, its deployed
database `PG_URL`, a persistent `SESSION_SECRET` of at least 32 characters, HTTPS
and `SCM_DO_BUILD_DURING_DEPLOYMENT=false`. Startup is `npm start`. Its federated
credential must trust the repository's `dev` branch. See the
[Azure GitHub OIDC setup](https://learn.microsoft.com/en-us/azure/developer/github/connect-from-azure-openid-connect).
These settings were documented, not inspected or changed remotely.

The package includes migrations but does not apply them to the deployed database.
Existing schema drift, backup, staging acceptance and database recovery remain
separate handoffs. Restore the Web App push trigger, deployment guard and Azure
branch trust to `main` when the temporary test period ends. A previously successful
deployment ZIP can be redeployed for application rollback.

Lecture concepts used: preserve integrity/atomicity/isolation checks by supplying
the real database to the existing migration and concurrent-transaction suites;
no production DDL or owner contract was changed.

## Proposed human Git handoff

Commit message: `fix(ci): repair Azure dev deployment and database test setup`

PR title: `Repair Azure Web App deployment from dev`

PR description: `Repair the failing hrgsms Azure workflow with disposable
PostgreSQL 18, deterministic installation, explicit production builds and the
complete regression suite. Temporarily deploy dev as authorized for testing,
package compiled frontend/API and production dependencies, serve both on one
port, and smoke-test deployment. Fix the five reported npm vulnerabilities and
require the shared validation for the existing container workflow. See
docs/qa/2026-10-13-deployment-repair.md and member_work_log.md for verification
and the Azure configuration/migration handoff.`
