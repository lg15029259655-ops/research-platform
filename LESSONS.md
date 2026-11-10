# Project lessons

Existing project history: [docs/lessons.md](docs/lessons.md). Read both before related changes.

## 2026-11-02 — Structured comparison needs its own deadline

- Status: validated within local automated tests; production model latency remains unverified.
- Evidence: the comparison route shared the 35-second X-Ray deadline, while the AI client permits 120-second reads and structured output can require a repair request. The screenshot's error matches this route's 504 text.
- Action: comparison now has a separate 240-second total deadline, below the deployed Nginx 300-second proxy deadline. X-Ray keeps its own limit.
- Prevention: tests cover both comparison succeeding beyond a short X-Ray deadline and cancellation at the comparison deadline. Research tests: 19 passed; Next production build passed.
- UI verification: desktop 1440px and mobile 390px checks confirm banner removal, compact button widths (128/143px), and no horizontal overflow. Screenshots: docs/home-compact-1440.png and docs/home-compact-390.png.
- Boundary: local source changes are not a production release. A live model request and production deployment still need verification.

## Local workflow tooling gap

- Status: pending workflow support, local work retained.
- `python` resolves to the Microsoft Store placeholder; the verified bundled host interpreter ran the workflow query and tests.
- This project has no COLLABORATION.json and is not in the shared-project registry. `editor.py claim` fails on the missing manifest; `project_entry.py init` only accepts migrating/shared stages. Do not mark a local project as migrating simply to obtain a token. No Git submission or shared migration was performed this round.
