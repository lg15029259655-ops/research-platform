# Project lessons

## 2026-11-12 — Audit category coverage and ambiguous keywords

- Status: tested representative examples locally; exhaustive disciplinary coverage is not established.
- Evidence: prior categories omitted chemistry, software/algorithm development, educational interventions and environmental field observation. Broad substring matches could interpret engineering control as a comparison group or a fuel cell as a biological cell. The visible icon library also omitted categories available in the selection menu.
- Action: add four research activity illustrations and classifications; narrow comparison-group matching and prioritize fuel/solar cells; derive both the gallery and manual selector from the same category list.
- Verification: classification tests cover the four additions and overlapping examples; TypeScript passes. Browser inspection confirmed the expanded gallery, including the added names, renders alongside the existing route.
- Boundary: keyword matching can still miss or misclassify context-dependent phrases. Users can override a step's category, and future changes should be checked against real examples rather than asserting complete coverage.

## 2026-11-12 — Persist a user's experiment illustration choice

- Status: implemented locally and verified with isolated version tests plus browser preview; model-based regeneration behavior remains unverified.
- Evidence: keyword classification cannot reliably determine the main activity of every interdisciplinary step, and the previous structured schema discarded unknown fields when saving a version.
- Action: add optional illustration category metadata to experiment steps; allow a preview, explicit save as a new version, or reset to automatic classification. Retain the legacy automatic behavior when metadata is absent.
- Verification: an isolated backend test saves a manual category, restores another version, then restores the edited version and checks the category; the full backend suite passes (100 tests). Frontend category tests and TypeScript pass; browser inspection confirmed selection previews the chosen picture and reverting to automatic removes the pending save without altering the saved user version.
- Boundary: matching still uses step names, stage-level artwork is automatic, and AI-generated modifications may replace step metadata; review selections after regeneration. Visual categories are conceptual and do not validate the experiment itself.

## 2026-11-12 — Offer cross-disciplinary activity illustrations

- Status: category mapping tested with representative names; existing design and illustration library inspected locally in a browser.
- Evidence: the previous category set focused on biomedicine and did not recognize clinical studies, engineering tasks, or common social science and humanities methods.
- Action: add shared categories and image assets for clinical studies, medical imaging, materials, engineering devices, simulation, surveys, interviews and archival/text research; expose a 16-category visual library in the route. Prioritize specific activities when keywords overlap.
- Verification: classification tests cover Chinese and English examples and overlapping terms, TypeScript passes, and the browser shows the expanded library with all 16 labels and artwork.
- Boundary: classification remains keyword-based, and the examples do not establish comprehensive coverage across disciplines. Ambiguous names fall back to a generic symbol; new images are conceptual category markers rather than actual research data.

## 2026-11-12 — Classify common experiment illustrations consistently

- Status: checked on the existing design in a fresh browser reload; keyword coverage is limited and should grow with real examples.
- Evidence: protein and metabolism were previously classified as general analysis, microfluidics fell back to a generic symbol, and the outcome selector touched the action button. A dynamically imported stylesheet also failed to update in the existing browser tab until the page imported it directly and reloaded.
- Action: use a tested, centralized experiment-name classification with specific techniques ahead of broad terms; add matching protein, metabolism, gene and microfluidics artwork and reuse the cell and data artwork; add 14px between the selector and button and load the insight stylesheet at page level.
- Verification: category tests cover common Chinese and English names and conflicting keywords; TypeScript passes. Fresh-browser inspection of the saved V2 confirmed the expected category artwork for the user's examples and measured 14px spacing.
- Boundary: this is name-based classification, not semantic understanding; ambiguous or unrecognized steps keep the generic symbol. The pictures represent categories and are not scientific results or validated molecular structures.

## 2026-11-11 — Verify the populated route with the user's actual version

- Status: locally verified with one real model generation and browser interaction; quality and evidence alignment remain unverified.
- Evidence: the user rejected the preceding redesign: simple icons, an empty legacy version, long broken route lines and poor visual hierarchy. The previous check used an empty saved version and therefore could not demonstrate real experiment cards.
- Action: generated a new reversible version for the existing research question, retained the old version, checked populated experiments in place, replaced the stretched rail with short inter-card connectors, and added an editorial illustration sheet alongside type-specific symbols.
- Verification: the actual generated V2 displayed four connected stages and seven named experiments/analyses; browser inspection confirmed in-place expansion. TypeScript and diff checks pass. Model-generated examples rely in part on supplied papers not directly about single-cell cost reduction, so neither the scientific validity nor cost savings are established.
- Boundary: the artwork covers four broad categories; other categories retain vector symbols. Branches remain links rather than drawn spatial paths. The new generated version is a draft, not a literature-verified protocol; scientific and aesthetic acceptance require further review.

## 2026-11-11 — Keep experiment details on their route, not below the whole map

- Status: implemented locally; browser checked on the existing legacy design and narrow viewport, TypeScript passes.
- Evidence: the user reported that a grid of unrelated cards lacked a chain, icons were repetitive, and expanded experiments appeared far below their stages. The previous fix did not satisfy this interaction requirement. An inherited later CSS rule also overrode the narrow-screen design grid.
- Action: render stages along a route with arrows only for recorded adjacent connections and explicit jump links for other recorded edges; place experiment previews and expandable details within each stage; provide distinct reusable category illustrations; restore the single-column narrow-screen grid with a more specific rule.
- Verification: checked in the current browser that the legacy version expands at its own stage, recorded links and missing-step guidance appear, and the narrow layout is readable; TypeScript and git diff checks pass.
- Boundary: the user's existing saved version has no structured experiment steps, so populated experiment previews and scientific quality were not validated in this browser session. Category selection uses names and a generic fallback; nonadjacent branches are links rather than spatial graph lines. AI completion creates a new version and remains subject to model reliability and scientific review.

## 2026-11-11 — Design stages must expose concrete experiments in context

- Status: local implementation checked with a real model and one existing browser session; scientific quality and reliability across many topics are not yet established.
- Evidence: the previous canvas displayed only flat abstract text nodes; checks and outcome exploration were detached below it. A real synthetic-model trial before adjustment took 49.8 seconds and failed structured review, while outcome exploration took 32.5 seconds. An earlier hot-reload screenshot also revealed that styles imported only by a dynamically loaded component were missing from an existing tab.
- Action: allow each generated stage to contain concrete experiments with purpose, method, controls and readouts; display one stage at a time with local check/outcome actions, linked-stage details, category illustrations, and versioned manual addition/removal. Keep legacy designs intact and offer an explicit AI completion action. Load route CSS from the page. Use the Qwen 3.7 Flash structured fast mode for review and outcomes and impose a 50-second analysis timeout with retry messaging.
- Verification: the full backend suite passes (99 tests), frontend TypeScript and job tests pass. In an isolated end-to-end test with synthetic input and the configured real model, generation returned 3 stages and 6 experiments in 17.6 seconds, review returned 6 findings in 19.2 seconds, and outcome exploration returned 3 branches in 9.4 seconds. A separate fast-mode review attempt failed structured output, followed by a successful 8.3-second attempt; this remains intermittent. Browser inspection verified stage expansion, preselected outcome controls, visible icons and style loading on a fresh page; no user design was overwritten.
- Boundary: icon category mapping uses explicit stage names and generic fallback; it is not yet shared with the second part. Earlier designs need user-triggered completion or regeneration. Existing design modification actions still save without a preview; references are not bound to individual experiment claims. Real model timings vary and generated experiments, evidence, controls and branches require human verification. Simulated chart graphics are type markers, not empirical results.

## 2026-11-11 — Keep design review and edits tied to a saved version

- Status: local first implementation, tested with isolated synthetic designs and mocked model responses; real-model quality and production latency are unverified.
- Evidence: the existing design page could generate and restore versions but had no independent design review, outcome exploration, or persistent manual step editing. A review of an old design must not be presented as a review of a later version.
- Action: add version-scoped AI review and outcome jobs, reject changed or unauthorized designs before and after generation, retain the generation-time synthesis context, and let users add, rename or remove steps in a new reversible version. Improve initial canvas zoom and highlight a selected item in the rotating novelty view.
- Verification: isolated tests cover manual version creation, restoration, owner isolation, stale edits and stale analysis, invalid step IDs, and synthetic review/outcome results. Full backend suite passes (98 tests); TypeScript and two frontend job tests pass. Existing design page showed the new controls and a 79% canvas zoom in one local browser view.
- Boundary: node-level evidence provenance, scientific correctness, review quality, editable result branches, controlled cost adjustment proposals, shared illustrated research icon library, and comprehensive responsive and real-model validation remain incomplete. AI modification actions still create versions immediately; they do not yet provide a confirmation preview. Results from review and outcome are session-only and are cleared on version change.

## 2026-11-10 — Recover stalled progress streams and preserve terminal events

- Status: verified with simulated event streams and an isolated full queue; real proxy and browser behavior remain unmeasured.
- Evidence: the frontend only started backup polling when no SSE event arrived within five seconds; a stream that delivered an initial snapshot and then silently stalled could leave the user waiting forever. A full backend event queue could also drop the final result or error. Polling ignored permanent 404 responses indefinitely.
- Action: continue a five-second status check even after SSE starts, stop with an actionable error when a task is no longer accessible, ignore late snapshots after settlement, and make terminal events displace old progress when a subscriber queue is full.
- Verification: frontend tests simulate a stalled SSE snapshot and a missing task; a backend test fills the event queue and verifies the result remains deliverable. TypeScript passes and the full backend suite passes (95 tests).
- Boundary: the fallback adds one status request every five seconds during long tasks. Network requests that never resolve and actual reverse proxy behavior require further testing; task cancellation semantics for multiple watchers are unchanged.

## 2026-11-10 — Save design versions atomically and protect the active workspace

- Status: verified with isolated asynchronous concurrency and injected database flush failure; multi-process deployment and real model timing are not tested.
- Evidence: design artifact and workspace pointer committed before the version row, so a later failure could leave an unversioned active design. Simultaneous completions could also compute the same version number or overwrite a newer workspace. Restoring an older version of another idea left the workspace idea unchanged, causing the next workspace read to discard the restored pointer.
- Action: compare the workspace idea and active design captured before generation; conditionally claim the workspace and write the artifact and version in the same SQLite transaction. Restore the version's idea with its pointer and clear a novelty result belonging to another idea.
- Verification: two overlapping simulated generations yield one version and one conflict; an injected failure after the artifact flush rolls back artifact and workspace changes; restoring a version from another idea survives a workspace reload. Backend suite passed (94 tests); the strengthened failure-injection test also passed separately.
- Boundary: a rejected concurrent generation must be retried from the current workspace. The test does not validate scientific quality or model availability, and historical inconsistent records are not automatically repaired.

## 2026-11-10 — Fence streaming chat against reparse

- Status: verified using a simulated stream and real isolated reparse; browser presentation and production concurrency have not been independently measured.
- Evidence: chat captured a unit before streaming but saved its answer and reading position afterward without checking whether the paper had been reparsed. Reused unit IDs could associate an old answer with new content.
- Action: claim the original content revision and source hash in the same database transaction as chat messages and progress; on mismatch discard the partial stream, report that the paper changed and do not save or advance reading position. The reader also clears the temporary reasoning display on reset.
- Verification: a regression test reparses after the first streamed fragment and verifies reset/error events, no completed answer, no new messages and no progress change. The backend suite passes (91 tests); frontend TypeScript check passes.
- Boundary: a partial answer can be visible until the server detects the conflict and sends its reset; real browser/network timing was not tested. Existing historical messages are not rewritten.

## 2026-11-10 — Fence generated results against concurrent reparse

- Status: verified using isolated PDFs with reparse during simulated model generation; production contention remains unmeasured.
- Evidence: comparison, paper summary and mind-map generation could read old units, await AI, then save after reparse had replaced those units. Reused unit IDs could make the resulting citations appear to refer to new content.
- Action: assign a new content revision when parsing commits. Before saving these three result types, conditionally claim each owner-scoped paper at the captured revision and source digest within the same SQLite write transaction as the artifact save. Reject changed or currently parsing papers with a retryable message.
- Verification: tests run real reparses during simulated comparison and mind-map model calls and confirm no outdated artifact is saved; the migration test covers adding the column to existing databases. Full backend suite passes (90 tests).
- Boundary: this guards new artifact saves, not every historical artifact or streamed chat response; legacy records receive a revision on their next successful parse. External edits outside the application are not detected. The transaction approach is tested on SQLite, the configured database.

## 2026-11-10 — Do not block the event loop preparing comparison evidence

- Status: verified by an isolated synthetic concurrency test; production latency has not been measured.
- Evidence: asynchronous X-Ray and multi-paper comparison called synchronous database and PDF reads directly on the event loop, delaying unrelated requests during slow file access.
- Action: run full-text preparation in the thread pool while leaving each operation's database session scoped to its thread.
- Verification: a test holds comparison preparation in a worker thread and confirms an event-loop timer continues to run. The full backend suite passes (88 tests).
- Boundary: model response times, database write contention and real PDF workloads need further measurement.

## 2026-11-10 — Mind map cache must reflect the actual reading units

- Status: verified with synthetic unit changes; concurrent reparse during AI generation remains to be examined separately.
- Evidence: the cache key used only the PDF digest, unit count and first unit ID. A reparse could change headings, page attribution or content while retaining those values, causing the old map to be reused.
- Action: include paper title and the ordered units' IDs, kinds, headings, page ranges and text in the revision digest.
- Verification: a regression test changes text, heading and title without changing count or first ID and observes a new revision; the full backend suite passes (88 tests).
- Boundary: this verifies cache invalidation on later requests; it does not by itself fence a generation already in flight while its source changes.

## 2026-11-10 — Keep reading units tied to their source PDF

- Status: verified with isolated synthetic PDFs and simulated parsing failures; external file modifications are not detected by this fingerprint comparison.
- Evidence: a replacement PDF was saved before parsing; if parsing failed, old units remained but the current PDF path could point to a different, readable file. File access, chat and synthesis could then silently combine unrelated sources.
- Action: persist the source digest of successfully parsed units, preserve it when attempting a replacement, and reject file-based reading and analysis while the saved digest differs from the current upload. Allow a successful reparse to establish the new association. Old failed records without a source digest are treated as uncertain. Surface a recovery action in the reader.
- Verification: tests exercise a readable replacement whose parser fails, check that old units remain and file/search/chat/synthesis are blocked, then reparse successfully. A same-file failure remains readable. Migration and full backend suite pass (87 tests); frontend TypeScript check passes.
- Boundary: the digest is based on the uploaded file recorded at ingestion; this change does not rehash a file modified outside the application, and it does not prove that a replacement is the intended paper. Legacy records without a digest and without a failure warning retain their prior behavior.

## 2026-11-10 — Recover interrupted PDF parsing with fenced attempts

- Status: verified with isolated simulated stale, live, legacy and superseded attempts and an actual terminated subprocess; production workloads have not been tested.
- Evidence: PDF parsing used non-durable background tasks, so a process crash could leave a paper in a processing state indefinitely. Age of the last stage alone cannot distinguish a slow live parse from an interrupted one.
- Action: persist an attempt token and heartbeat, refresh it while parsing, and allow an owner-scoped status request to atomically reclaim an attempt after 30 minutes without heartbeat. Fence stage, result and failure writes by token; isolate extracted image paths per attempt and preserve previous units until a replacement succeeds. Legacy records with no token are not automatically reclaimed.
- Verification: tests cover stale recovery preserving notes, live and untracked legacy attempts remaining untouched, and an old attempt unable to commit after ownership changes. A separate process was terminated during PDF parsing, then a new process reopened the same disposable database and completed recovery; its heartbeat was artificially aged to avoid a 30-minute wait. A startup migration test checks an existing database without the new columns. The backend suite passes (85 tests).
- Boundary: recovery starts when the paper status is requested, not automatically at server startup; a stalled attempt may take 30 minutes to be reclaimed. A very long scheduler or database pause can cause duplicate computation, although token fencing protects database results. This does not coordinate with older application processes lacking fencing; deploy one backend process and stop the old version before starting the new one. The subprocess test used a synthetic PDF and artificially advanced timeout; image cleanup policy remains outstanding.

## 2026-11-10 — Claim a PDF replacement before starting parsing

- Status: verified locally for simultaneous manual attachments and failed replacements; the equivalent remote import concurrency path is not separately exercised.
- Evidence: a file upload yields while saving, after an earlier status check. Two requests could both replace the same record and start parsing, and failed legacy records could lose existing units before a replacement succeeded.
- Action: atomically update only when the owner, original status and path still match for manual attachment and remote import; claim reparse with a conditional update. Keep previous files and reading units until parsing succeeds, and remove only the losing request's newly created file.
- Verification: isolated tests synchronize two competing uploads and observe one success and one conflict; another test confirms a failed replacement retains old units. The full backend suite passes (80 tests).
- Boundary: process-crash recovery and behavior with a worker from older application code still need separate work. Tests do not establish remote service reliability.

## 2026-11-10 — Resume polling when reopening a parsing paper

- Status: type-checked locally; browser timing and production network behavior remain unverified.
- Evidence: upload polling stopped after a fixed wait, and opening an in-progress paper did not start another status check. A paper that later finished could remain visibly stuck; a successfully uploaded paper might also be absent from the displayed list after a polling error.
- Action: poll the lightweight owner-scoped status endpoint while an in-progress paper is selected, retry transient network errors, stop on selection change or unmount, and refresh the list after an upload succeeded but the initial wait failed.
- Verification: frontend TypeScript check passes. This does not restart parsing after a server crash; an unfinished server task can still remain in its intermediate state.

## 2026-11-10 — Optional precomputation must not undo parsing success

- Status: verified with isolated API tests; external AI queue outages were simulated.
- Evidence: precomputation was scheduled inside the PDF parsing error handler after the parsed paper had already committed. A scheduling exception could mark a valid upload failed or falsely report that reprocessing failed.
- Action: handle post-commit precomputation errors separately and log them without changing the saved parsing result.
- Verification: a regression test forces scheduling to fail for both initial upload and reparse; both remain parsed with their reading units. The full backend suite passes (78 tests).
- Boundary: a failed optional precomputation is not retried by this change. Recovery of PDF parsing interrupted by process termination remains a separate unresolved issue.

## 2026-11-10 — Task concurrency and test isolation

- Status: verified locally with synthetic jobs and an isolated SQLite database; multi-process deployment is not supported.
- Evidence: the prior worker had a configured concurrency of two but one loop awaited every job serially. After adding two workers, one owner's waiting job could still block another owner. Normal service shutdown also labeled unfinished work as user-canceled. Tests initially constructed the app with the real database, where startup could requeue real jobs.
- Action: use a bounded worker pool, requeue jobs whose owner is at the limit, wake workers on new work and completion, cancel queued jobs promptly on the event loop, and requeue unfinished AI jobs on graceful shutdown. Configure pytest to use a disposable database and upload directory before app import; close database connections at teardown.
- Verification: regression tests demonstrate parallel work across owners, the global and per-owner limits, fairness, queued cancellation, and restart of an unfinished AI job. A database-isolation test and the full 77-test suite pass.
- Boundary: the task queue and limits are process-local; use one backend process. Retrying a job after restart can call the model again. PDF parsing still uses a separate background mechanism and is not covered by this recovery. Before isolation was added, test runs used the local project database and created anonymous test accounts; no current queued jobs were found, but earlier task interference cannot be ruled out and the accounts were not deleted without reliable attribution.

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
