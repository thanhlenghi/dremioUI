# Repository Guidelines

## Project Structure & Module Organization

This repository is currently unscaffolded. When adding the application, use this predictable structure:

- `src/` for production source code.
- `tests/` or colocated `*.test.*` files for automated tests.
- `public/` or `assets/` for static files.
- `docs/` for architecture notes and setup guides.
- `scripts/` for repeatable maintenance or development commands.

Group feature code by domain, for example `src/features/search/` or `src/components/`.

## Build, Test, and Development Commands

No build system is committed yet. After adding one, document canonical commands in the README. Common examples:

- `npm install` installs JavaScript dependencies.
- `npm run dev` starts the local development server.
- `npm run build` creates a production build.
- `npm test` runs the automated test suite.
- `uv sync` installs Python dependencies from the lockfile.
- `uv run pytest` runs Python tests.

Use `uv` for Python dependency management and command execution, for example `uv run python scripts/task.py`. Prefer package-manager scripts over ad hoc shell commands.

## Coding Style & Naming Conventions

Match configured formatters and linters once added. Until then, use 2-space indentation for JavaScript, TypeScript, JSON, YAML, and Markdown. Use `kebab-case` for general files, `PascalCase` for UI components, and `camelCase` for functions and variables.

Keep modules small and focused. Avoid unrelated formatting churn in files touched for a functional change.

## Testing Guidelines

Add tests alongside new behavior. Use outcome-focused names such as `renders-empty-state.test.ts` or `test_user_can_save_changes.py`. Cover workflows, error states, and boundaries. If automation is impractical, document manual verification in the pull request.

## Commit & Pull Request Guidelines

This directory does not currently contain Git history, so no commit convention can be inferred. Use concise, imperative subjects such as `Add search results view` or `Fix form validation`.

Pull requests should include a summary, testing performed, linked issues when applicable, and screenshots for visible UI changes. Keep PRs scoped to one logical change.

## Agent-Specific Instructions

Before editing, check whether generated or user-created files already exist and avoid overwriting them without approval. Prefer small, reviewable changes and update this guide as tooling becomes concrete.

Always ask the user for explicit confirmation before committing changes or pushing to GitHub. Do not run `git commit` or `git push` without that approval, even if the user previously asked for commits or remote updates in the same session.

When task work is complete, recap the changes and verification performed, then ask whether the user wants the changes committed and pushed to GitHub.

### Session Handoff Protocol

Always check for `.agents-handoff.md` or `TODO.md` at the start of a session. If `.agents-handoff.md` exists, prioritize its instructions, execute the next step, then delete it once processed. Treat `TODO.md` as persistent context and do not delete it unless explicitly instructed. Keep code style concise; do not explain basic code blocks unless requested.
