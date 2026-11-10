# Project lessons

## 2026-11-10 — Missing PDF recovery must preserve the research record

- Status: validated with isolated API and browser tests; real deployment behavior and all damaged-file formats remain unverified.
- Evidence: a parsed paper whose PDF disappeared produced server errors, while the attachment endpoint refused a replacement. Searching a large PDF also kept scanning after reaching its 30-result display limit. Chat could begin while reparse was changing its units.
- Action: return explicit file/search errors, expose a replacement upload for missing or unreadable PDFs, preserve old conversations and mark old artifacts stale on replacement, compare replacement titles with the original record, reject full-text analysis when the file cannot be read, and stop search at 30 hits. Block chat while parsing.
- Verification: tests cover missing files, an invalid first replacement followed by a valid replacement, history preservation, stale results, title mismatch, search limit and parsing-state chat. An isolated browser showed the replacement control; it did not submit a user file.
- Boundary: parsing jobs interrupted by a process crash can still remain in an intermediate status. Automatic crash recovery is not implemented; current local records were checked and none are in an intermediate state. Existing original user PDFs were not replaced during testing.

## 2026-11-10 — PDF parsing must not block unrelated requests

- Status: validated with local concurrency tests and seven existing PDFs read without changing their records; production workload and scan recognition remain unverified.
- Evidence: the non-deferred upload route ran synchronous PDF parsing directly on the async event loop, and Figure page rendering also occurred on the event loop. The scan warning used line count, so a readable short document could be mislabeled while mixed text/image PDFs could hide image-only pages.
- Action: run synchronous upload parsing and Figure rendering in a worker thread; assess each page's extracted character count and describe low-text pages as possibly images or scans without claiming OCR succeeded.
- Verification: a test keeps a synthetic parse blocked while an unrelated health request succeeds; another checks Figure rendering runs off the event loop. Tests cover short readable and mixed PDFs. Seven existing local PDFs were read with no new low-text warnings; three still have structural warnings.
- Boundary: character thresholds are heuristics, and an image-only figure page is not necessarily a scan. Tesseract was not installed on this host; OCR and production concurrency are not established by these checks.

## 2026-11-10 — Empty evidence maps and sentence selection

- Status: verified with synthetic tests and a small number of real-model calls; scientific relevance remains unverified.
- Evidence: two previous real comparisons returned no evidence claims. A separate extraction that asked the model to copy quotes often changed the words; deterministic source sentence IDs avoided that mismatch. A real two-paper endpoint run returned two matched single-study snippets in 27.3 seconds, including 7.2 seconds for extraction.
- Action: only when comparison has no evidence claims, offer a bounded 20-second extraction using numbered original sentences from result/discussion sections. Reject unknown or duplicate IDs, obvious clipped fragments and panel captions; preserve the existing comparison and show insufficient evidence on timeout.
- Verification: 40 automated tests include valid IDs, unknown IDs, timeout and obvious fragment filtering. The final conservative status is covered by tests; the timed endpoint run preceded that status-only change.
- Boundary: manual review found model descriptions may add context not present in the selected sentence or describe methods rather than findings. Therefore extracted candidates remain INSUFFICIENT and explicitly require context verification; an exact match is not evidence of semantic support. Extraction may add up to 20 seconds and may still yield no candidates.

## 2026-11-10 — Evidence citations need literal verification

- Status: local automated tests validate exact-match and rejection behavior; real-model evidence extraction remains unproven.
- Evidence: the previous comparison accepted a valid unit ID and displayed that unit's first 260 characters as if they supported the model's claim. A valid section reference alone does not prove relevance. Multi-page excerpts also exposed a starting page as an exact quote location.
- Action: request a continuous source quote, check it against the supplied excerpt after whitespace normalization, downgrade unsupported stances when no verified quote exists, label unverified legacy snippets, and show a range when the exact page is unknown. Generate paper titles from authoritative inputs.
- Verification: tests cover fabricated versus matching quotes, missing paper metadata, and multi-page ranges. Two real-model runs (four papers in 32.8 seconds and two in 18.4 seconds) returned no evidence claims, so they do not validate real-model quote generation.
- Boundary: a literal text match proves only that the words occur in the supplied excerpt; it does not establish that they support a scientific claim. Users must check original context and study conditions.

## 2026-11-09 — Reader switching and polling

- Status: validated in an isolated browser using delayed synthetic responses; full production workloads remain unmeasured.
- Evidence: paper loads could resolve out of order and an in-flight reply could update the next paper. A malformed PDF response could also crash the reader. Parsing polls reopened the PDF and returned full history on every request.
- Action: ignore stale paper responses, cancel the visible stream when switching, isolate PDF rendering errors, cancel stale PDF searches, and poll an owner-scoped status endpoint without loading the document or messages.
- Verification: isolated browser tests switched papers before delayed responses and during a simulated stream; the later choice remained visible without the old reply. A malformed PDF showed a local error instead of replacing the page. In a synthetic local 100-message case, the median status response was 3.0 ms / 139 bytes versus 7.6 ms / 119,492 bytes for full details; this is not a production benchmark. Automated ownership and no-PDF-open coverage was added.
- Boundary: switching cancels the in-flight browser stream, so an unfinished answer may not be saved; real network delays, different browsers and larger libraries need further testing.

## 2026-11-09 — Evidence loss and page attribution in Results

- Status: validated with synthetic multi-section and multi-page PDFs; representative publisher PDFs still need manual comparison.
- Evidence: the parser skipped every Results section after the first, and every 5,500-character result chunk inherited the first page of the entire section.
- Action: retain each Results section and calculate the page range of each chunk from its extracted page lines. Preserve text without standard headings as explicitly unclassified page units, excluding references.
- Boundary: page ranges track extracted text, not semantic correctness or reading order in complex columns; no OCR is provided.

## 2026-11-09 — Design generation timeout

- Status: validated once through the local endpoint using an isolated synthetic request; model quality and production latency remain unverified.
- Evidence: Qwen3.7 Flash with default reasoning exceeded the old 18-second design timeout; disabling thinking returned a structured seven-node result in 14.6 seconds, and a separate endpoint request returned six nodes in 17 seconds without the generic fallback.
- Action: use fast structured mode for this model's design task, allow 35 seconds, and retain explicit fallback behavior on failure.
- Boundary: timings vary, and structural validity is not scientific validation. Other models retain their existing configuration.

## 2026-11-09 — Reprocessing must preserve prior work

- Status: validated in local automated tests and by read-only parsing of seven existing PDFs; accuracy across publishers remains unverified.
- Evidence: the old reparse path deleted reading messages and related research artifacts. Two real review PDFs placed a large multi-page body inside the abstract because their headings did not match fixed rules.
- Action: keep old messages and artifacts, detach old message-to-section references, and flag affected artifacts as stale. Split exceptionally long multi-page abstract units into page-scoped unclassified body units with a warning.
- Boundary: reading position is reset on explicit reparse; page-scoped recovery is not reliable section classification or OCR. Existing records are not automatically reprocessed.

## 2026-11-09 — Shared workspace requests

- Status: type-checked and basic navigation checked locally; production performance not yet measured.
- Evidence: the page and navigation bar each mounted a workspace hook, causing concurrent duplicate workspace requests and another request for every subscriber after changes.
- Action: share in-flight reads and publish completed updates to subscribers, preventing an older read from overwriting a newer update. Pause WebGL rendering when the user pauses motion.
- Boundary: request coalescing is not a complete diagnosis of perceived navigation latency or network performance.

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
