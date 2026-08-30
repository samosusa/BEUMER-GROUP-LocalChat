# BEUMER-GROUP-LocalChat

An offline, confidential document assistant for BEUMER Group. Documents, embeddings, model
and chat history all stay on the employee's machine.

## Repository layout

```
apps/renderer         The desktop interface (React). See docs/frontend.md.
apps/desktop          The Electron shell: window, tray, quick-ask, hardened bridge.
apps/health-service   The minimal HTTP service with the /health endpoint.
packages/contracts    The HTTP contract with the RAG service, as runtime schemas.
packages/tokens       The design system as CSS custom properties.
docker/               Review container for the interface.
```

This is an npm workspaces monorepo. `npm install` at the root installs everything.

**Desktop client:** see [docs/frontend.md](docs/frontend.md) for how the interface is built,
how to run it against its mock service, and the Electron security posture.

## Local service

This repository includes a minimal HTTP service with a health endpoint. It lives in
`apps/health-service`, and the root `npm start` / `npm run bench` scripts delegate to it.

### Run locally

```bash
npm install
npm start
```

The service listens on `http://localhost:8000` by default. Verify it with:

```bash
curl http://localhost:8000/health
```

Expected response:

```json
{ "status": "ok" }
```

Available checks:

```bash
npm test          # service tests + interface tests
npm run lint      # eslint over the client, node --check over the service
npm run bench
npm run verify    # everything CI runs: format, lint, typecheck, test, build
```

Set `PORT` in the environment to use a different port. See `.env.example` for the available setting.

## Jira & GitHub workflow

This repository includes GitHub Actions that enforce and integrate Jira issue keys across branches, PRs and commits.

- **Branch naming:** Branches must be named like `LCHAT-123-short-description` (case-insensitive letters, dashes).
- **PR titles:** PR titles must contain the Jira key (e.g. `LCHAT-123`).
- **Commit messages:** Commits in a PR should start with the Jira key (e.g. `LCHAT-123 Fix typo`).
- **Automatic PR enrichment:** PR bodies are automatically updated with a clickable Jira link.
- **Automatic transitions:** Jira issues are transitioned to `In Review` on PR open and to `Done` on merge (edit transitions in the workflow if your board uses different names).

Workflows added:

- `.github/workflows/jira-pr-link.yml` — adds Jira link to PRs.
- `.github/workflows/enforce-jira-key.yml` — validates branch name and PR title.
- `.github/workflows/enforce-commit-jira-key.yml` — validates PR commit messages start with the Jira key.
- `.github/workflows/enforce-push-commit-jira-key.yml` — validates pushed commit messages start with the Jira key.
- `.github/workflows/jira-auto-transition.yml` — transitions Jira issues on PR open/merge.

Quick branch / PR commands:

```bash
git checkout -b LCHAT-123-add-login-page
git commit -m "LCHAT-123 Add login page"
git push origin LCHAT-123-add-login-page
# create a PR as normal from GitHub UI
```

Enable branch protection (one-time):

1. Go to the GitHub repository → Settings → Branches.
2. Edit the `main` branch protection rule.
3. Enable **Require status checks to pass before merging**.
4. Select the checks named `Enforce Jira Key / validate`, `Enforce Jira Commit Key / validate-commits`, and `Enforce Jira Commit Key On Push / validate-push-commits` (they appear after the actions run once).

Jira connection (one-time):

1. In Jira Cloud: Settings → Products → GitHub.
2. Connect your GitHub organization/repository.
3. Verify branches, commits and PRs appear in the Jira Development panel.

GitHub repository configuration (for Jira workflows):

1. Add repository variable `JIRA_BASE_URL` (example: `https://your-company.atlassian.net`).
2. Add repository secret `JIRA_EMAIL` (Jira account email).
3. Add repository secret `JIRA_API_TOKEN` (Jira API token).
4. Optional: add repository variables `JIRA_TRANSITION_IN_REVIEW` and `JIRA_TRANSITION_DONE` if your Jira transition names differ from defaults.

Customization:

- To change transition names, edit `.github/workflows/jira-auto-transition.yml` and replace `In Review` / `Done` with your Jira workflow transitions.
- To require different commit/branch patterns, edit the respective workflow regexes in the `.github/workflows` folder.

Local commit-time enforcement (recommended):

To enforce Jira commit prefixes on every local commit, run:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\setup-git-hooks.ps1
```

This enables the committed hook at `.githooks/commit-msg`, which blocks commits unless the first line starts with `LCHAT-123`.
