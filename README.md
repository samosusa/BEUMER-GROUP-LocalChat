# BEUMER-GROUP-LocalChat

## Jira & GitHub workflow

This repository includes GitHub Actions that enforce and integrate Jira issue keys across branches, PRs and commits.

- **Branch naming:** Branches must be named like `LCHAT-123-short-description` (lowercase, dashes).
- **PR titles:** PR titles must contain the Jira key (e.g. `LCHAT-123`).
- **Commit messages:** Commits in a PR should start with the Jira key (e.g. `LCHAT-123 Fix typo`).
- **Automatic PR enrichment:** PR bodies are automatically updated with a clickable Jira link and optional summary.
- **Automatic transitions:** Jira issues are transitioned to `In Review` on PR open and to `Done` on merge (edit transitions in the workflow if your board uses different names).

Workflows added:

- `.github/workflows/jira-pr-link.yml` — adds Jira link/summary to PRs.
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

Customization:

- To change transition names, edit `.github/workflows/jira-auto-transition.yml` and replace `In Review` / `Done` with your Jira workflow transitions.
- To require different commit/branch patterns, edit the respective workflow regexes in the `.github/workflows` folder.

Local commit-time enforcement (recommended):

To enforce Jira commit prefixes on every local commit, run:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\setup-git-hooks.ps1
```

This enables the committed hook at `.githooks/commit-msg`, which blocks commits unless the first line starts with `LCHAT-123`.
