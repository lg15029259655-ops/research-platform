# Project lessons

## 2026-11-09 — Review text misclassified as abstract

- Status: locally tested; real model result and broader PDF coverage still require verification.
- Evidence: a review PDF had approximately 49,000 extracted characters spanning multiple pages in a single ABSTRACT unit, so the comparison rejected it as lacking multiple sections.
- Action: exceptionally long multi-page abstract units are sampled as unclassified text, never as verified section/page citations; a warning accompanies new comparison results. Short or unreadable documents remain rejected.
- Boundary: sampled excerpts do not represent the whole article, and their claims and context must be checked against the PDF. This fallback does not repair the underlying parser or establish an accurate page location.

## 2026-11-09 — Compare latency and selection state

- Status: validated for one local four-paper case; model quality and other configurations require further evaluation.
- Evidence: Qwen3.7 Flash comparison with default thinking took more than two minutes; a separate request with thinking disabled returned structured output in 29.6 seconds. Output quality was not independently assessed.
- Action: disable thinking only for this model and comparison task; retain validation, retry and explicit extraction warnings. Serialize selection writes to avoid out-of-order workspace updates.
- Boundary: timings vary by network, model and paper content; this does not establish a solution for general page interaction latency or production deployment.

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
