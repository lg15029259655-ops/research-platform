# Project lessons

## 2026-11-15 — Group biological activities into reusable illustrations

- Status: implemented locally; tested on representative names and the illustration gallery, not validated against a representative literature corpus.
- Evidence: the user clarified that biological research should use a small number of shared category illustrations: animal experiments share one image, cell experiments share one, and bioinformatics analyses share one. The previous cross-disciplinary categories were too fragmented and could classify the gene manipulated in a cell experiment instead of the activity.
- Action: provide a biological category catalog and two shared four-panel illustration sheets, reuse the existing metabolism image, and prioritize explicit bioinformatics, animal and cell activities ahead of molecular targets; retain saved category overrides and legacy classifications for compatibility.
- Verification: category tests cover example workflows and matching precedence; TypeScript passes; browser inspection showed nine biological classes using the intended images. The user's current stored design was not edited.
- Boundary: there is no measured 80% coverage; matches rely on names and can misclassify ambiguous or combined activities. Images are conceptual; teammate integration into the reading section has not been performed or verified.

## 2026-11-12 — Define cross-disciplinary illustration mappings with examples

- Status: expanded locally; representative matching and asset tests pass, but exhaustive discipline coverage is not established.
- Evidence: the user requested illustrations and explicit correspondence for different fields; existing categories lacked drug studies, microbiology, engineering fabrication, physics measurement, ecology, policy/law, economics and mathematical proof.
- Action: add eight illustrated categories and specific matching rules; document activity examples and precedence in docs/research-illustration-catalog.md. Distinguish specific activities from vague analysis and guard against confusing English word substrings with cells.
- Verification: representative Chinese/English and overlapping examples pass frontend tests; all selectable categories have wired assets; TypeScript passes. Browser inspection confirmed the eight labels and image resources in the existing route.
- Boundary: keyword matching is not comprehensive semantic understanding. Context-dependent or unrecognized activity labels may use generic artwork or be misclassified; generated visual charts are conceptual, not empirical results.

## 2026-11-12 — Match study-stage illustrations to their actual context

- Status: locally tested with representative names and the user's existing education design; broad semantic coverage remains unverified.
- Evidence: the user showed that baseline assessment, short-term evaluation and long-term follow-up all received a bioinformatics graphic because the generic keywords for evaluation/analysis matched a biomedical data illustration. The previous audit checked asset presence rather than whether each icon represented its actual task.
- Action: provide separate baseline, outcome and follow-up illustrations, replace the general data graphic with a discipline-neutral statistics illustration, and use the stated education goal only to disambiguate explicitly named intervention/process steps. Keep explicit laboratory techniques and saved user choices higher priority.
- Verification: category and asset tests and TypeScript pass. Fresh-browser inspection of the current education route verified its baseline, intervention, short-term outcome, follow-up and model-analysis illustrations without changing saved data.
- Boundary: matching still uses rules and a narrow use of the research goal, not general semantic understanding. Similar words in other contexts can remain ambiguous; conceptual charts are not experimental results.

## 2026-11-12 — Keep illustration selection out of the research workflow

- Status: verified locally on the current saved education design.
- Evidence: the user explicitly rejected the illustration-changing control because it burdens people using the product to design experiments. The previous usability change only collapsed the control and did not remove it.
- Action: remove the control and its frontend editing pathway; keep automatic category matching and retain existing stored category metadata for compatibility.
- Verification: TypeScript passes; browser inspection of an expanded stage showed experiment content and actions without the change-illustration control. No saved user design was modified.
- Boundary: matching remains name-based and can still misclassify ambiguous descriptions; improve classification internally using evidence rather than asking users to select a graphic.

## 2026-11-12 — Reduce design-stage controls and preserve manual visual choices

- Status: implemented locally; browser checked on the existing education design and backend tested with mocked model responses.
- Evidence: the user reported a cluttered fourth section; the open stage simultaneously displayed a category selector on every experiment, all editing actions and long stage description. A saved manual category could be lost when an AI adjustment omitted the optional metadata. Current education examples also fell back to a generic symbol for academic assessments.
- Action: collapse low-frequency illustration, stage description, editing and addition controls; keep experiments and review/outcome actions visible; remove nested sidebar scrolling; recognize common academic assessment labels. Preserve manual illustration metadata only for an unambiguous matching name within the same stage on AI adjustments, never during full regeneration.
- Verification: browser inspection on the user's existing education design confirmed the experiment cards and expandable editing/category controls. Backend full suite passed (101 tests before adding the final integration test); all 7 focused design tests including a mocked AI-adjustment save passed; category tests and TypeScript passed.
- Boundary: the category match does not infer context from other steps, and a changed or ambiguous step name cannot safely inherit a manual choice. Results of design checks remain session-only, individual evidence claims are not tied to citations, and branch edges remain text links rather than a full graph. Real model quality and new designs were not evaluated.

## 2026-11-12 — Verify artwork coverage, not just category labels

- Status: all currently selectable categories have local artwork and were checked in the browser and an automated asset test.
- Evidence: the user identified seven categories that were listed in the gallery but still used the earlier simplified vector placeholders; the sample-processing stage inherited that placeholder. The previous review checked labels and examples rather than artwork coverage for every option.
- Action: supply consistent illustrations for pathway, sample handling, microscopy, controls, research goals, constraints and generic steps; use the category list for illustration rendering and test that each selectable category has an image sheet, position and available asset.
- Verification: all four frontend category tests and TypeScript pass; fresh-browser inspection showed the new illustrations in the gallery and the existing sample stage. Images are conceptual, not experimental results.
- Boundary: category matching remains name-based and can be manually corrected; this test checks asset wiring, not aesthetic quality or exhaustive scientific coverage.

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

## 2026-11-15 — Narrowing the research scope without losing existing work

- Status: validated in local automated tests and a public OpenAlex sample query; classification coverage is not guaranteed.
- When narrowing to biological sciences, remove unrelated built-in examples, illustration assets and templates, but preserve existing user papers and saved designs. Map older illustration categories to a supported biological or generic category rather than deleting data.
- OpenAlex life and health science topic filters need a new search cache version so older unfiltered results do not reappear. A sample filter query returned HTTP 200; automatic topic assignment may miss interdisciplinary work.
- Verification: 102 backend tests and 6 frontend tests passed, as did TypeScript checking. This does not establish production deployment or validate every biological subfield.

## 2026-11-15 — Verify each OpenAlex search mode end to end

- Status: verified against the live service and a complete local novelty job using a Chinese biological research question.
- The prior filter check used keyword search only. OpenAlex rejects `topics.domain.id` on semantic search, so the novelty job failed even though the keyword request and mocked tests passed. The job handler also hid the actionable search error.
- Semantic search now filters the returned maximum 50 candidates locally by topic domain before pagination; keyword search retains server-side filtering. Tests check both request shapes and filtering, and the novelty handler preserves search errors.
- Boundary: filtering a bounded candidate set and automatic topic labels can omit relevant papers. Live verification confirms this example, not all queries or model responses.

## 2026-11-15 — Keep design actions in their proper scope

- Status: implementation and frontend checks verified; live interaction with a saved user design was not repeated.
- Repeating the same review and outcome tabs inside each stage made an overall review look stage-specific. Keep whole-design review at the route header and stage outcome exploration inside its stage, with no duplicate switcher.
- Keep manual experiment addition directly available in each expanded stage and retain the existing versioned save path. Remove redundant interface instructions while retaining evidence-quality and version-state information.
- Verification: frontend TypeScript and six existing frontend tests passed. An end-to-end manual save remains unverified in this round.

## 2026-11-15 — Evidence density and version controls

- Status: local code and automated checks verified; new model output and visual acceptance are pending.
- Fixed minimum lane heights left large empty blocks when evidence was sparse; the comparison prompt also requested only one or two claims. Lanes now size to their contents, and the prompt requests broader coverage only when supported by the provided text. A missing contradictory result must not be invented.
- Avoid repeating the current version as a selectable button when there is only one version. Existing saved comparisons remain unchanged; rerun is necessary to apply a changed generation prompt.
- Checks: frontend TypeScript and 30 backend research tests passed. This does not prove improved evidence recall, or validate visual design on all screens.

## 2026-11-15 — Markdown whitespace in the reader

- Status: code and TypeScript verified; visual acceptance with the user's saved paper is pending.
- Inherited `white-space: pre-wrap` preserved Markdown source newlines in addition to rendered block spacing, producing large gaps. Rendered Markdown and recap cards now use normal whitespace; plain streaming text retains newlines.
- Limit assistant message width for easier reading and use one stable SVG for both library-toggle states. Responsive behavior and existing messages remain intact in code; verify visually with real long and short responses.

## 2026-11-15 — Keep request authentication off the event loop

- Status: verified in isolated local tests and local API smoke checks; no production or before/after latency benchmark.
- The async authentication middleware performed synchronous SQLite access on the event loop, so a database wait could delay unrelated requests. Session resolution and job event snapshot reads now run in a thread pool; paper-list image counts use a database count instead of loading image records.
- Tests simulate blocked session resolution while the event loop progresses and verify image counts and owner isolation. All 105 backend tests passed; local workspace and paper-list requests returned HTTP 200.
- Boundary: model inference and PDF parsing can still take substantial time, and this does not establish a system-wide speedup or solve every contention path.

## 2026-11-15 — Match biological methods before generic words

- Status: representative mapping and asset tests passed; visual and broad real-paper coverage remain to be validated.
- “条件培养基转移实验” matched a generic restriction category because the rule treated every occurrence of “条件” as a limitation. Recognize the actual cell-culture method first and restrict generic limitation terms; clear biological method names also take priority over stale saved categories.
- Add sequencing, extracellular-vesicle, biochemical-assay and microscopy illustrations, while retaining shared category images for cell and animal experiments. Explicitly distinguish wet-lab sequencing from analysis and microfluidic devices from general cell work.
- Tests cover the reported name, legacy misclassification, closely related Chinese and English names, and asset availability. This representative set does not establish coverage for all biology papers.

## 2026-11-15 — Check existing designs for illustration gaps

- Status: representative classification tests and TypeScript passed; broad population coverage remains unmeasured.
- A read-only sample of saved design titles exposed gaps in real wording, including public clinical dataset mining and metabolic tracing. Extend method matching and test those examples, plus common organoid, immunohistochemistry, viral, gene-silencing and sequencing terminology, using existing category images when appropriate.
- Priority matters: wet-lab metabolic tracing should not be inferred as data analysis merely because a title also mentions pathway analysis; sequencing data analysis should not be shown as an instrument experiment.
- Boundaries: sampled designs are not representative of every field and ambiguous wording can still be misclassified; no percentage coverage claim is supported.


## 2026-11-16 — Merge teammate workflow with existing artwork

- Teammate workflow expected individual icon files that were not included; existing biological category sheets can supply six corresponding categories as fallbacks. Other categories still show placeholders.
- Resolved the design prompt conflict by preserving the current biological scope and adding the workflow task. Experiment workflow tests (12) and TypeScript checks passed; visual and live model verification remain pending.


## 2026-11-16 — Fill workflow illustration gaps

- Generated a six-panel sheet for five previously uncovered workflow categories and mapped each to its panel. Existing independent icon files retain priority.
- The sheet supplies conceptual illustrations; classification accuracy and actual browser presentation remain subject to verification.

## 2026-11-16 — Match local preview origin to the backend

- Starting the preview on port 3001 with a backend on 8001 while leaving FRONTEND_ORIGIN at its 3000 default blocked browser sessions and POST requests. Health checks alone did not reveal this.
- Restarted the preview backend with FRONTEND_ORIGIN=http://127.0.0.1:3001. Verified the session CORS header, POST preflight, and that a missing-file POST reaches validation (422), not origin rejection. A real PDF upload and parsing remain unverified.
- For alternate-port previews, set both NEXT_PUBLIC_API_URL and FRONTEND_ORIGIN, and check a browser-origin request before handing over the URL.

## 2026-11-16 — Specific workflow method illustrations

- Added distinct Western blot, PCR, Transwell and flow cytometry illustrations. Specific method names override broad diagram categories; ambiguous titles keep their broad category. Tests cover Chinese and English examples and generic controls; visual inspection in the live diagram remains pending.
- Two initial asset/test writes used paths prefixed with frontend while already in the frontend directory; both failed without writing. Corrected by checking the command working directory before using relative paths; rerun and test succeeded.
- Boundary: these mappings apply to the existing design workflow. A paper-grounded experiment map in the reading section remains outstanding.

## 2026-11-16 — Match illustrations across both design views

- The design sandbox and workflow diagram used separate categorization systems, so newly added method-specific artwork appeared only in the latter. Both now apply the same explicit-name method mapping, falling back to their existing broader classifications for ambiguous names.
- Added ELISA, IHC, cell proliferation and immunofluorescence artwork and reused existing sequencing, vesicle, histology, microbiology and metabolic sheets. Five category tests and TypeScript passed; local page and new image returned HTTP 200. Browser visual acceptance and broad real-world coverage remain unverified.

## 2026-11-16 — Stage illustration duplication and orbital perspective

- The saved STAB2 design had three distinct stage titles all reduced to the generic cell category. Added title-specific mapping for expression profiling, gene perturbation and immune-cell interaction; tests use the actual stage names. Generic wording still falls back to the prior category. Images are conceptual, not experimental results.
- Three novelty tiers had different plane tilts and corresponding sphere positions, producing inconsistent perspective. All tiers and spheres now share one plane, with an orthographic camera and responsive fit; removed a decorative core ring that could be mistaken for another orbit.
- Six category tests and TypeScript pass; image asset returned HTTP 200. Automated browser visual acceptance is unavailable in this session, so interactive orbit appearance and responsive layout remain to be checked visually.

## 2026-11-16 — Literature orbit visual refinement

- User found the orbital view too plain after the geometry correction. Reviewed open-source 3D Force-Directed Graph and Ozymandros/solar-system for hover/click detail and restrained orbit presentation; implemented a dark observatory palette, differentiated tier colors and soft node halos, preserving qualitative tier meaning and the list-based detail path. No external code copied.
- TypeScript and all 8 frontend tests passed; the local design route returned HTTP 200. Visual and responsive acceptance in a browser remains pending because browser automation is unavailable.
- The earlier frontend-relative path error recurred on a CSS write: despite the existing lesson, the workdir was not checked at command composition time. The failed write created no file; corrected to src/app/studio.css and verified the diff. Before further writes, inspect workdir and use a path relative to that exact directory.

## 2026-11-17 — Integrating the paper experiment map

- Integrated teammate b8456d6 while retaining the existing reader icon and workflow illustration/export changes. A valid unit ID alone does not verify an AI-generated quote; now require the quoted text to occur in the referenced unit, discard ungrounded AI items, and invalidate older cached experiment maps.
- Stopped linking unmatched results or figures to the previous experiment, fabricating generic stages, and turning extraction order into a dependency chain. Matched candidate interpretations remain marked for source review. Short English keyword matches now require word boundaries.
- Full backend suite passed 124 tests before the final focused refinements; the six experiment-map tests passed again after those refinements, all 8 frontend tests and TypeScript passed. Reader page opened in a fresh browser session, but no real-paper visual or live model verification was performed. Keyword candidates and summaries can still be incomplete or inaccurate.

## 2026-11-17 — Paper map coverage and reader overflow

- A real YAP/mTORC1 paper contained an 8,586-character methods unit, but AI context included only its first 900 characters and one valid AI candidate suppressed rule extraction. Expanded context to bounded chunks across sections and supplement AI output with explicit method candidates; changed cache revision so the stale one-item map is not reused. One unit may span pages, so its page link identifies the unit start, not necessarily the precise passage.
- Real-paper read-only rule check found seven method categories; eliminated broad pathology and unrelated engineering keywords that created false candidates. Results and experiment associations remain candidates requiring source review, not proof of exhaustive coverage. Method-only evidence no longer supports a result claim.
- Made experiment panel scroll within the reader and added side padding; root/branch wrapping now uses conservative font width estimates. Regression tests cover long methods, method-only result suppression and the reported long title. Backend 125 tests, frontend 9 tests and TypeScript passed; real AI output and browser scrolling/visual acceptance remain pending.

## 2026-11-17 — Whole-project readiness pass

- User requested local readiness and cleanup before a later deployment. Removed three previously unused tracked visualization components, an unreferenced tracked illustration, and two unused dependencies; preserved Git recovery and archived the old review-only copy at D:/论文阅读/_archive/research-platform-review-ui_20261117. Other data and projects were retained.
- The previous alternate-preview CORS fix was insufficient: two Next dev servers shared `.next` and overwrote the browser API endpoint. Separate build caches by local preview configuration, and check the actual compiled reading page endpoint. The audit build uses its own ignored cache.
- Moved upload file writes/hashing off the event loop and tested a blocked write against loop progress. Added origin checks for PATCH/PUT and verified rejected workspace mutation. Preserved results/figure space in long-paper extraction and label multi-page source references as starting pages; matching a quote is not scientific validation.
- Backend 128 tests, frontend 9 tests, TypeScript, production build, local preflight, a synthetic upload/parse and model/OpenAlex connectivity checks passed. The four page entry/empty states were checked in a browser; real-paper end-to-end AI quality, load tests, visual exports, production server and backup/recovery remain pending. Full detail: docs/release-readiness.md.

## 2026-11-17 — Seed examples without sharing user sessions

- Status: implemented locally; isolation verified with two independent test sessions, production validation pending.
- Evidence: the requested public demonstration needs three editable example papers and results for every visitor; anonymous sessions isolate data by owner and local PDF paths are machine-specific.
- Action: export only explicitly selected papers and results to a separate seed directory; generate new IDs, copy files into each owner directory, regenerate missing mind maps from parsed units, and initialize comparison/design pointers for new sessions only.
- Verification and boundary: local tests checked per-owner PDF access and result pointers. Existing visitors are not overwritten; filesystem permissions and live public behavior require server verification. Generated maps without AI annotations are marked by annotation count.

## L-20261117-01 — Keep example initialization out of established sessions

- Existing sessions took the initialization lock on every API request, and seeding a legacy workspace without a comparison could replace its active research selection. Check the persisted seed marker before locking, reuse the parsed seed within initialization, and only fill comparison defaults when the existing research context is empty.
- Verify both new and existing visitors, including paper ownership and preservation of the legacy workspace. With a local 300 ms test lock and five requests per version, median paper-list latency fell from 312.4 ms to 5.0 ms. This measures the lock wait, with production throughput and model latency still unmeasured.
- Status: verified locally with temporary storage and the existing three-paper example bundle.

## L-20261117-02 — Exercise concurrent creation, restart and slow streams

- A lookup followed by a plain insert can race when two requests create a workspace. Force both requests past the missing-row lookup and check that they return the same workspace. Use SQLite's owner uniqueness constraint to make creation repeatable.
- Restart coverage needs persisted progress and cancellation. Restore submission order, clear prior progress and finish persisted cancellations before running handlers. Exercise SSE with a paused client and verify it stops pulling messages, closes its source and preserves the user-facing cancellation state.
- The automated tests explicitly disable demo seeding unless a test configures its own fixtures. Run the documented frontend tests and type check, and review the diff after a Next.js build because a custom output path can rewrite the tracked TypeScript configuration.
- Status: verified locally with 134 backend tests, 11 frontend tests, TypeScript, a production build and local deployment preflight. Server load and backup restoration still require target-environment checks.

## L-20261117-03 — Measure reader bundles and test real restored paths

- Split Markdown and the two maps from the initial reader bundle. Compare production builds using the same API origin, then exercise saved Markdown, PDF rendering, and map tabs on a real paper in Chrome. The reader fell from 175 kB to 120 kB of first-load JavaScript. Restore the generated TypeScript metadata from Git after the isolated build adds its temporary output path.
- SQLite stores absolute paths to PDFs and extracted images. After moving a backup bundle, restore to a new directory, take the original data path offline, and open the same paper using its original session. The 105-reference local drill, PDF hash, reading history, design history, and ownership checks passed. See [the deployment procedure](deploy/README.md#数据备份和恢复).
- Status: verified locally. The production server and scientific quality of the sampled AI output still require separate checks. Local timing and scope are recorded in [release readiness](docs/release-readiness.md#local-follow-up--2026-11-17).

## L-20261117-04 — Test reader cancellation through the model stream

- Two tabs could start concurrent reading turns for the same paper. The HTTP response also owns nested async generators that must close on disconnect, including when the model is waiting between frames. Reserve the paper during preparation and streaming, close both stream layers, and release the reservation even if preparation or delivery fails.
- Validate with a held model response, a competing request for the same paper and a request for a different paper. For cancellation, verify that the model generator closes, the draft remains editable, partial text is absent from stored history and the next request succeeds. Match test-double signatures to the application call when stubbing model configuration.
- Status: verified locally with 137 backend tests, 11 frontend tests, a production build, Chrome with a controlled slow stream, and one live provider call. The reservation relies on the existing single-backend-process deployment. Cancellation preserves a complete response that was already committed.

## L-20261117-05 — Verify the active host before deploying

- The old Hangzhou preview and the public domain both responded to health requests, but they resolved to different hosts. Check the domain's DNS, the latest actual deployment and the target's `current` before uploading. The active host used a `runtime-default-v2` release path, which the older ECS helper would reject.
- Public SSH closed before authentication. Refresh the existing OrcaTerm tab to reconnect, then maximize it to expose the file manager. Verify the uploaded archive's SHA-256. Use a detached systemd unit for server tests and the Next.js build so browser reconnection does not interrupt it.
- Preserve the prior release and take a private backup while the backend is stopped just before switching. Smoke-test one session across the change, including its existing PDF hash and result references. Status: verified on the active Tencent Cloud host for `80a9fdf`. The backup verified 4,960 file references. See [the deployment record](deploy/README.md).

## L-20261117-06 — Check entry points and live caches before cleanup

- The retired design workflow tab left a diagram component and its stylesheet with no import chain from any frontend route. Remove both from the working tree with Git recovery available. The reader's experiment map still uses the shared icon component and artwork, and the workflow API still has its own callers and tests.
- Before moving local data, compare the candidate paths with active process arguments, effective storage configuration and manual test references. The ordinary and alternate preview caches, main database and uploads, active example bundle and latest release archive remain at their working locations.
- Moved 24 local entries of earlier packages, tests and unused caches into `D:/论文阅读/_archive/medread-local-cleanup-20261117`. Checked standalone file hashes and directory file counts and sizes. `ArchiveManifest.json` records the original relative locations. The same-volume archive clears the working directory while retaining the data.
- Status: verified locally. All 137 backend and 11 frontend tests passed, TypeScript passed, and both preview reader routes returned HTTP 200. The initial port 3000 request timed out while the development service responded to the retry.

## L-20261123-01 — Exercise navigation with one browser session and delayed responses

- Status: verified in a local production build with an isolated backend and the three-paper demo seed.
- Evidence: parallel first-page API calls could receive different anonymous cookies before the first response set the browser cookie. The reader consumed its URL only on mount, so browser history and late paper responses could disagree with the displayed paper.
- Action: share the session bootstrap across API calls, serialize workspace writes within a browser tab, and keep navigation mounted across the four workspace pages. Use URL state for reader paper and PDF page and the synthesis view. Let the reader resume lightweight status polling after an accepted upload.
- Verification: the Playwright check holds the first session and a stale paper response, uses browser history, simulates discovery attachment parsing, uploads a real example PDF, checks the subsequent synthesis selection and design handoff, retries failed loading requests, and checks the four workspaces at 390px. Seeded synthesis may collapse the selection panel. Open it when a saved comparison exists and assert the persisted selection instead of assuming an empty workspace.
- Boundary: local Chrome, 11 frontend tests, 137 backend tests, TypeScript and the production build passed. The discovery provider was stubbed in the navigation regression. Live deployment and server-side latency were outside this verification.

## L-20261123-02 — Keep background work and its research context together

- A progress card promised that users could browse elsewhere, but unmounting the page sent a cancellation request. Keep a tab-scoped ticket for synthesis and research design. Restore the ticket after a refresh and reserve cancellation for an explicit action. Reader chat and paper-specific jobs retain their existing cancellation behavior.
- Once a task can outlive the page, capture its relevant workspace fields when it is queued. Check them before model work and again when saving. On return, verify that the saved result still belongs to the active workspace before showing it as the current result.
- A mutable synthesis pointer and selection caused a design's evidence link to drift. Carry the source synthesis ID in the handoff and use that artifact's papers in the generated version.
- Status: verified locally with 140 backend tests, 11 frontend tests, a production build, source preflight and Chrome navigation checks. The browser test uses controlled task responses for navigation, reload and explicit cancellation. Backend tests cover queued context changes, stale result writes and pinned provenance. The seed can start with every paper selected, so the browser test changes a known checkbox instead of assuming an unselected paper. The public deployment and live model performance were outside this verification.

## L-20261123-03 — Confirm cancellation and preserve observation during outages

- Evidence: clicking Cancel closed the observer and hid the card before the server received the request. A failed fetch after a sparse completion event also discarded observation. The homepage kept saying it was checking after a failed health request.
- Action: leave the workspace observer active through cancellation and render the terminal state reported by the server. Surface an unconfirmed cancellation with a retry action. Back off failed status requests, recover a sparse terminal event from a complete snapshot and ignore a delayed poll when newer stream progress has arrived. Show a retryable homepage status after a failed health check.
- Verification: the browser regression disconnects status requests and restores them, returns 503 for the first cancel, then accepts a second cancel and holds the terminal status. It also retries a failed homepage health request. Frontend unit tests cover a sparse completion followed by a transient failure and out-of-order progress. Local Chrome, 13 frontend tests, 140 backend tests, production build and source preflight passed.
- Boundary: exercised locally with controlled job responses. Production network behavior and live model performance remain unverified.

## L-20261123-04 — Preserve unfinished work in its original scope

- Evidence: reading questions were retained only while the reader component was mounted, and design inputs were recoverable only after an AI task had been submitted. Editing a saved design on a narrow screen also split a two-character action across lines.
- Action: save drafts within the browser tab at input time. Bind reading questions to their paper, design inputs to their workspace and source question, and edited steps to their base design version. Preserve intentionally blank inputs and keep pending steps separate from changes ready to save.
- Verification: Chrome covered reload, navigation, separate paper and idea scopes, a failed reader request, a confirmed reply, a failed version save, and a successful version save against isolated storage. A controlled novelty result also verified that unsaved constraints survived a changed workspace idea and reload. At 390px, inspect the editor itself as well as page width. The action row wraps and delete controls retain one line and a 44px touch target.
- Status: local production build, 13 frontend tests, 140 backend tests, source preflight and browser checks passed. These drafts are tab-scoped and do not sync across devices. Public deployment is unchanged.

## L-20261123-05 — Verify the compact reader in a real viewport

- Evidence: in a 390 by 844 Chrome viewport, the default paper library occupied about 330px, the PDF started near the fold and the chat composer was below the long answer history. Changing panes remounted the PDF and reset zoom.
- Action: move the compact library into a native dialog with searchable titles and filenames. Use separate full-width source and commentary views on narrow screens. Retain each visited pane for the current paper and ignore hidden-PDF resize events.
- Verification: the browser regression checks 320px, 390px, 768px and desktop layouts. It verifies keyboard mode navigation, focus restoration, paper filtering and selection, PDF page/zoom/search retention and chat scroll retention. The feature-only build passes the regression independently of the optional visual polish.

## L-20261123-06 — Keep visual changes reversible

- The user requested a separate rollback for the visual review so functional improvements survive a return to the previous appearance. Commit compact reader behavior first and verify its browser regression without the visual stylesheet. Keep the later visual changes in CSS and the stylesheet import.
- Use moderate text-button radii and align text and icons together. Keep quiet controls visually lighter. Inspect both phone and desktop renderings instead of assuming that rounded corners alone cure an oversized control.
- Status: the polished build and full navigation regression passed. Chrome sampled controls on all five pages at 390px and 1440px. The library upload control measures 44px on mobile and 36px on desktop. The pre-polish feature build independently passed the full navigation regression.
- Local review uses the isolated demo at http://127.0.0.2:3320 with its own API and data, so the browser cookie does not replace the normal 127.0.0.1 session. Keep the running review build in the ignored frontend/.next-audit directory available until the user has reviewed it. Use another build directory for further work while this preview is running.

## L-20261123-07 — Merge selection changes from separate tabs

- Evidence: the comparison basket replaced the full cached list on every change. A subsequent save from another tab could undo an earlier add or removal. Optimistic selections could also remain visible after a failed request.
- Action: send the desired membership of one paper, read the current list under a SQLite write transaction and enforce topic, ownership and capacity at the server. Notify sibling tabs to refresh after confirmed changes. Show pending selection changes separately and use confirmed selections for comparison.
- Verification: backend tests forced concurrent mutations and checked retry idempotency, the five-paper limit, ownership and rejection after a topic change. Chrome held one tab's request while the second tab edited another paper, verified rollback on an injected 503, and confirmed a newly uploaded paper appeared in the other tab after selection. The production build, 141 backend tests, 13 frontend tests, source preflight and browser smoke passed.
- Boundary: the original visual review build remains live on 127.0.0.2:3320. The stability build was exercised in .next-stability with separate storage and ports. Only the CSS and stylesheet import from 99e817e are needed to revert the visual review, while preserving newer functional work and lesson entries.

## L-20261123-08 — Resume interrupted PDF work at startup

- Evidence: a killed process left a fresh parse heartbeat, so a status poll could wait for the lease to expire. A successful status response followed by a failed details request also stopped browser retries.
- Action: in the deployed single-process model, snapshot unfinished PDF records at startup and resume them in a background pass. Use the same token check as the expired-lease path. A browsing status request still cannot claim an ordinary live or tokenless record. Startup recovery can resume legacy tokenless records after the previous process has exited.
- Action: use one reader status loop after an accepted upload or reparse. Retry transient status and details failures, and keep the user on the same paper when reopening or refreshing. Long uploads retain their existing request behavior.
- Verification: the crash regression terminates the parser process and starts another process using the same temporary database, with no clock manipulation or request to the status endpoint. A delayed-recovery test proves health stays available and prior notes survive. Chrome injects a 503 after a completion status and exercises a real reparse followed by reload. Backend 143 tests, frontend 13 tests, production build, source preflight and browser smoke passed.
- Boundary: the earlier visual review instance remains available and unchanged. No public deployment was performed.

## L-20261123-09 — Confirm saved reader replies after a stream disconnect

- Evidence: saving the reply and delivering the last SSE frame are separate events. If the connection closed between them, the reader discarded the on-screen reply and a retry could submit the same question twice or skip a reading unit.
- Action: save a turn ID with both messages in the same transaction as the reading position. Keep the ID in the originating tab while the outcome is uncertain. Reload the saved conversation after a disconnect, and replay the saved answer when the same operation is retried. Clear the submitted draft only when the saved turn is present and the draft still contains that question.
- Verification: the backend regression dropped the final SSE frame after commit and proved replay preserved the message count and reading position, including after a subsequent reading step. Chrome recovered a saved answer from history after an incomplete stream and kept the draft through a failed request and reload. An older database retained all 77 messages through two startups. Backend 144 tests, frontend 13 tests, the local production build, source preflight and browser smoke passed.
- Boundary: local tests used controlled model responses. Retry tracking is scoped to the browser tab. The running visual review is the separate earlier build.

## L-20261123-10 — Give each discovery graph its own request and selection

- Evidence: a slow lineage response could replace the paper displayed next to a different graph. Graph loading disabled unrelated discovery actions, and failures appeared outside their own view. A successful empty search left no result feedback.
- Action: keep each graph's request, selection and error within its own view. Cancel outstanding graph requests when replacing the search context, support retry inside the affected view and use the same tab navigation for keyboard and pointer interaction. Report an empty search explicitly.
- Verification: Chrome held the lineage response while opening the constellation, checked both paper cards after switching between views, injected a 503 and retried, then confirmed an empty search showed its own status. The test uses controlled graph responses. The full Chrome navigation smoke, 13 frontend unit tests, local production build and source preflight passed.

## L-20261123-11 — Separate browsing from changing the research topic

- Evidence: loading search results, including following a search link or finding no matches, also changed the active topic and could reset the comparison basket, central paper and design pointers.
- Action: keep the search query and results independent of the active workspace. Offer an explicit topic change with confirmation for an existing topic. Check the confirmed workspace timestamp within the write transaction. Require the active topic to match when assigning a central paper from discovery.
- Verification: Chrome at 390px exercised browsing, canceling a topic change, rejecting an outdated confirmation and retrying against the latest workspace. Check the actual active topic after the response, since the confirmation itself contains the new topic's text. The browser also verified the previous synthesis artifact remained accessible by its ID. Backend 145 tests, frontend 13 tests, local production build and source preflight passed.

## L-20261123-12 — Make saved comparisons reachable from the workbench

- Evidence: switching topics removed the active comparison pointer, and saved comparisons could only be reopened with a known artifact URL. Historical views could also be replaced when another comparison finished.
- Action: offer an on-demand list of comparison summaries with owner-scoped cursor pagination. Open a specific comparison by ID, keep the current workspace unchanged while browsing, and keep the historical view anchored while background work completes.
- Verification: the backend regression checks summaries, ownership and complete pagination across equal timestamps. Chrome switches topics, injects a history request failure, retries, reopens the previous comparison, checks focus and returns to the current workspace. The flow also passes at 390px. Backend 146 tests, frontend 13 tests, local production build and source preflight passed.

## L-20261123-13 — Restore a design together with its original evidence

- Evidence: the version bar only appeared after opening a design for the active idea. Switching topics hid earlier designs, and restoring a different idea could leave the current gap context attached to it.
- Action: list saved designs through the same on-demand history interaction used for comparisons. Open an exact version in a read-only route, then require explicit confirmation and a matching workspace timestamp before resuming. Restore the saved synthesis link and its evidence context when available to the owner. Use the stored version number in history and on the active canvas.
- Verification: the backend regression rejects a stale restore and verifies restoration of the pinned synthesis and evidence under the prior idea. Chrome at 390px opens an older design after a topic change, checks focus and a read-only stage, confirms that preview leaves the workspace intact, then restores the design and opens the editable canvas. Backend 146 tests, frontend 13 tests, local production build and source preflight passed.

## L-20261123-14 — Load the active design independently of version history

- Evidence: the design canvas waited for up to 20 complete old versions before looking for its active version. The server applied the goal filter only after selecting up to 200 records, so an older goal with no recent versions could disappear from the list.
- Action: load the exact active artifact separately from the lightweight version list. Filter by goal before the server limit, and let the browser retry unavailable version metadata while keeping the current canvas available.
- Verification: Chrome at 390px held the version-list request, opened the canvas and editor, then injected a 503 and retried without losing the editor. A backend fixture with 205 saved versions retrieves the oldest goal. For a seeded design with 20 real saved versions, the local uncompressed API response bodies fell from 95,708 bytes to 9,484 bytes for initial canvas plus list. This measures response size using isolated data, not production load time. Backend 146 tests, frontend 13 tests, local production build and source preflight passed.

## L-20261123-15 — Load the selected synthesis view on demand

- Evidence: opening the comparison matrix included all evidence references and research-gap data and bundled the two optional views into the initial route.
- Action: fetch the selected view by artifact ID, keep successful views available for that artifact, and give a failed view a local retry. Load the optional components when needed. Preserve evidence references in the evidence view and the link to the original artifact in the design handoff.
- Verification: Chrome at 390px held and failed the evidence request, switched to the already-loaded matrix, retried, and opened a direct research-gap link without requesting the matrix. A separate browser trace confirmed the two optional JavaScript chunks arrived only on first use. The isolated seed matrix returned 7,161 uncompressed bytes, compared with 11,766 bytes for the former full artifact response. Backend 147 tests, frontend 13 tests, production build and source preflight passed.

## L-20261123-16 — Recover a failed panel download in place

- Evidence: the optional panels deferred their JavaScript, but failed imports could reach the page error screen. React lazy components keep a rejected load, so remounting the same instance is not enough to retry it.
- Action: keep the successful or in-flight import, release a rejected import for a real retry, and isolate render errors at the panel. Keep raw reading text available if Markdown formatting fails. Provide a route fallback for unexpected rendering errors.
- Verification: Chrome dropped the actual evidence-view JavaScript download at 390px and reopened it without another evidence API request. A separate check dropped the PDF viewer script and verified recovery without losing the reading draft. The navigation regression also injects a route render error and recovers through the page retry while keeping the main navigation visible. Frontend 13 tests, production build and source preflight passed.

## L-20261123-17 — Remember the job submission before the HTTP response

- Evidence: the tab saved a job ticket only after reading the POST response. A refresh during that interval could lose track of an already accepted job, including one that finished before reconnecting.
- Action: persist a tab-scoped submission ID before sending the POST. Save its owner-scoped mapping in the same transaction as job creation or reuse. On reload, look up the receipt without sending another submit request. Use a known terminal snapshot directly and carry an explicit cancellation request forward until a job ID is available.
- Verification: Chrome held a real accepted job's POST response, refreshed at 390px, dropped the first receipt lookup, then recovered the original terminal result with exactly one submission. Backend tests cover active deduplication, completed replay after a restart, different input, new requests and other owners. A copy of an older database gained the receipt table at startup with prior record counts intact. Backend 148 tests, frontend 13 tests, production build and source preflight passed.
- Boundary: browser recovery uses session storage in the originating tab. It does not infer acceptance when the backend has no receipt or submit a job automatically on reload.

## L-20261123-18 — Run both appearances against the same functional revision

- Evidence: the original appearance rollback had passed a reverse-patch check, but an older running preview could not demonstrate the newer functionality under both appearances. Next did not compile an exported frontend on C: against a linked pnpm installation on D: because webpack resolved an invalid drive-qualified relative path.
- Action: export two copies of revision `92a2ca5` to `D:/论文阅读/.medread-review-92a2ca5`, use the same-drive dependency installation, and reverse only the visual source patch in the original-appearance copy. Serve each with its own loopback origin, database and example files. Keep the earlier review process on 127.0.0.2:3320 available.
- Verification: the snapshots differ only in four style sheets and the stylesheet import in the root layout. Both compiled as production builds and passed the full Chrome navigation regression. Chrome measured the polished upload button at 36px on desktop and 44px at a 390px viewport, with a 10px corner radius and a text center within 1px of the control center. The isolated polished and original-appearance reviews are at http://127.0.0.3:3322 and http://127.0.0.4:3323, respectively.

## L-20261123-19 — Keep PDF search tied to the current input

- Evidence: changing the query did not cancel the in-flight search. Its late result could move the reader to a page for the old query. A result with zero matches looked the same as idle, and PDF rendering and search failures shared one message.
- Action: cancel and clear the search on input or paper changes, use a bounded request, and distinguish pending, empty, successful and retryable results. Give file loading its own retry while keeping the page and zoom state.
- Verification: at 390px, Chrome recovered from a PDF file response error, held an old search while the query was edited, confirmed that it did not move the reader, disconnected the new search, and retried through to the real no-match response. The production build, 13 frontend tests and source preflight passed. The earlier comparison previews retain their pinned appearance-review builds.

## L-20261123-20 — Reuse the PDF pages already extracted for search

- Evidence: each search re-extracted every page it needed, including work performed for earlier search terms. Reaching 30 matches should continue to stop the first scan early.
- Action: retain a bounded prefix of extracted pages, keyed to the file signature and content revision. Resume extraction after that prefix as needed. Check that the file signature still matches before returning results, and continue scanning without caching past the text budget.
- Verification: backend tests cover the 30-match limit, reuse of a partial or complete scan, replacement before and during search, and the uncached fallback. An isolated 240-page synthetic PDF measured median search-function times of 497.6 ms on a cold scan and 0.3 ms for a different query after caching. This measures local extraction and matching without HTTP or browser rendering. The full backend suite passed with 148 tests.

## L-20261123-21 — Revalidate private PDF bytes on reopen

- Evidence: the PDF response supplied validators but always sent the body. The browser also could not read range metadata from a separate frontend origin.
- Action: authorize before checking the private PDF validator. Return 304 for unchanged bytes, vary the browser cache by session cookie, and expose range metadata to the configured frontend origin. Bind the reader URL to the file fingerprint so replacing a PDF reloads it while reparsing unchanged bytes preserves the address.
- Verification: a Chrome network trace observed a first 200 response, a 304 on reopen, and a cross-origin 206 response with the expected byte range. Backend tests verify ownership and missing-file checks before a 304, unchanged addresses on reparse, and fresh bytes and validators after an allowed replacement. The production build, source preflight, 149 backend tests and 13 frontend tests passed.

## L-20261123-22 — Bind evidence page links to their source PDF

- Evidence: evidence links used a bare page number. After a PDF replacement the old link could jump to an unrelated page. A page range also used the same action label as an exact page.
- Action: save the source file fingerprint on new comparison citations, and validate it in the reader before jumping. Distinguish exact pages from the start of a range. Open the current reading position when the linked page is invalid or an older citation has no available matching source.
- Verification: Chrome at 390px followed an exact link, checked the range label, and confirmed that a mismatched fingerprint and a page outside the current PDF both kept the saved reading position. Backend tests verify the exact persisted citation fingerprint. The production build, source preflight, 149 backend tests and 13 frontend tests passed.

## L-20261123-23 — Resume the last PDF page without forgetting citation intent

- Evidence: a new visit with no page in its URL reverted to the AI reading unit, even after the reader had manually moved to a different PDF page.
- Action: remember a manually chosen page by paper ID and file fingerprint in the current tab. Use a valid explicit page first, then a same-file checkpoint, then the reading unit. Opening a citation alone does not change the checkpoint.
- Verification: Chrome at 390px left for synthesis, resumed the previous page, followed a valid citation, returned to the earlier checkpoint, and rejected a checkpoint from a different file version. The production build, source preflight and 13 frontend tests passed.

## L-20261123-24 — Keep the last opened paper separate from the research center

- Evidence: every successful reader open sent a workspace update. Following a citation or briefly opening another paper could silently change the central paper in every tab.
- Action: remember the recently opened paper within the tab. Set the center only through an explicit action guarded by the active research topic. Keep any save failure in the same library panel as the action. Let the default reader URL stand while the paper detail is loading: a late history replacement can interrupt navigation to another workspace page.
- Verification: Chrome at 390px opened a citation for a non-central paper and checked that the server retained the center. Returning to the reader reopened the recent paper. An injected 503 left the center in place and displayed an error in the library drawer, and retrying the explicit action saved the new center. The production build, source preflight and 13 frontend tests passed.

## L-20261123-25 — Recover an accepted PDF upload without adding another copy

- Evidence: a lost upload response left no record of the submission in the reader. Resubmitting the same file created another paper and triggered parsing again.
- Action: remember an upload receipt before sending the file, derive the paper ID from the receipt and owner, and use one atomic insert. Remove only each losing attempt's own temporary file. Look up the receipt on connection loss or reload, and reuse it when the browser identifies a retry of the same file.
- Verification: two concurrent server requests with the same receipt and bytes produced one paper and one stored PDF. Reusing the receipt with different bytes was rejected, as was a lookup by another owner. Chrome at 390px held a real PDF upload response, refreshed, lost the first receipt query, and opened the single accepted paper. The production build, source preflight, 150 backend tests and 13 frontend tests passed.

## L-20261123-26 — Keep selection controls reachable as the viewport narrows

- Evidence: the discovery page itself fit at 320px and 360px, while its horizontally scrolling selection tray placed the last remove button outside the visible area. An absolutely positioned touch target could also overlap the title.
- Action: wrap the paper list and stack its rows on narrow screens. Give the title and remove button separate columns. Check individual control bounds in the browser alongside the page's overall width.
- Verification: Chrome at 320, 360, 390, 480, 720 and 1440 CSS pixels kept each remove button within the viewport and separate from its title. At 320px the last remove action updated the saved selection, then the synthesis link opened its page. The full Chrome navigation smoke test, production build, source preflight, 150 backend tests and 13 frontend tests passed.

## L-20261123-27 — Confirm workspace state when the design handoff loses its response

- Evidence: a workspace PATCH without a deadline kept its button disabled and blocked later writes in the same tab's queue.
- Action: bound each PATCH when it begins. After an unconfirmed save, read the workspace and continue to design only when the topic, question and source synthesis match. Keep the selected question and an actionable error near the button when the read cannot confirm the handoff.
- Verification: Chrome held a PATCH before it reached the server and confirmed the existing draft stayed saved while the same question became retryable. It then sent the retry to the real API, dropped the accepted response, and verified the design opened with the question and source link after exactly two attempted writes. The full navigation smoke test, production build, source preflight, 150 backend tests and 13 frontend tests passed.
- Boundary: the browser deadline releases the local queue. It cannot cancel a server transaction that already started.

## L-20261123-28 — Let citation opens and library reads recover independently

- Evidence: the reader's initial paper and library requests had no deadline. A timeout displayed through the general error slot would also expose the empty-workspace welcome beneath a failed citation.
- Action: add separate deadlines and retry feedback. Reuse the cancellable paper-opening effect for retries, preserving the citation URL, and let the newest library request own the library state.
- Verification: Chrome at 390px withheld both responses after following a source citation. It checked that the original URL survived, retried the detail and rendered the cited page, then retried the library and confirmed it still marked that paper as current. The full navigation smoke test, production build, source preflight, 150 backend tests and 13 frontend tests passed.

## L-20261123-29 — Fetch independent citation relationships concurrently

- Evidence: after fetching the center paper, the lineage service fetched references, citing papers and related papers serially. Discovery reads had no browser deadline, so an interrupted response could leave the view in its loading state.
- Action: fetch the three independent groups concurrently, then merge them in the previous precedence order. Keep the optional citing-paper fallback. Add separate deadlines for restoring results, searching and opening graph views, with retries that preserve prior results.
- Verification: a backend barrier test requires all three lookups to start before any can finish and checks citation directions and duplicate relationships. With four simulated 120 ms upstream calls, both implementations produced the same graph and elapsed time changed from 508 ms to 250 ms. Chrome at 390px and desktop width withheld search and lineage responses, retained the prior search and URL, and reopened the requested view on retry. The test shortened the deadlines and explicitly released held routes. Full navigation smoke, production build, source preflight, 150 backend tests and 13 frontend tests passed.

## L-20261123-30 — Verify design version restores when the response is lost

- Evidence: historical and in-canvas restore requests could wait indefinitely. A lost response also looked like a failed write, even if the target version had become current.
- Action: use a shared restore deadline, reread the active version after an ambiguous response, and keep an unconfirmed restore retryable. Guard navigation if the user leaves the history view. Bound loading the saved novelty result independently.
- Verification: Chrome at 390px held an unsent restore, confirmed the history page and old workspace remained, then dropped a response after the server restored the requested version and verified it opened for editing. It also dropped an in-canvas undo response and checked the active version. Workspace retry recovered the constraints and step drafts, and a separate saved novelty fixture retained the constraints through timeout and retry. Full navigation smoke, production build, source preflight, 150 backend tests and 13 frontend tests passed.

## L-20261123-31 — Reconcile manual design saves by receipt

- Evidence: manual design saves had no client deadline. After the server accepted a save, a retry for the old base could only receive a stale-version conflict, with no way to identify the accepted result.
- Action: persist the submission ID with the tab's draft, use an owner-scoped artifact ID and lock the workspace before checking or writing the version. Reuse a receipt only for the same base and effective content. Look up confirmed results without changing the active version, and normalize timestamp serialization on the first response and on replay.
- Verification: two simultaneous writes returned the same single version. The backend rejected a reused receipt with changed content or base, denied another owner access, and replayed without reactivating the saved version after a rollback. Chrome at 390px retried from a refreshed draft, recovered a committed save with its response dropped, and also reloaded during a pending response with exactly one version created. Full navigation smoke, production build, source preflight, 151 backend tests and 13 frontend tests passed.

## L-20261123-32 — Move keyboard focus to the destination after a page change

- Evidence: the skip link left focus on the document body, keyboard navigation kept focus in the shared header, browser back retained focus on an unrelated navigation link, and the four workspace pages shared one tab title.
- Action: make the main landmark focusable, set focus on the committed destination without overriding scroll or a more specific focus target, and supply static route titles. Query-only changes keep their existing focus.
- Verification: Chrome and Edge at 390px and 1440px verified skip link activation, next Tab, keyboard navigation, browser back, query-only tab changes, home navigation and distinct titles. Chrome also held a route bundle and checked that focus waited for the reader to mount. The full navigation smoke test, production build, source preflight, 151 backend tests and 13 frontend tests passed.

## L-20261123-33 — Revalidate compact library rows when switching pages

- Evidence: discovery, reading and synthesis all downloaded the full library list, including abstracts and image counts unused by their list views.
- Action: add an opt-in summary that projects only the displayed fields. Revalidate it with a private, owner-scoped ETag and a common browser deadline. Keep the full response available for existing clients.
- Verification: the backend returned an empty 304 for the same content, rejected reuse of another owner's validator, and returned a new body and ETag after a parse status or warning change. The seeded library response dropped from 1,842 to 773 bytes. At 390px, Chrome and Edge recorded 200, 304 and 304 when navigating between reading, synthesis and discovery, with their library views rendering throughout. Full navigation smoke, production build, source preflight, 152 backend tests and 13 frontend tests passed.

## L-20261123-34 — Paginate one semantic search batch

- Evidence: OpenAlex returned the same up-to-50 semantic candidates for each requested page. The app fetched those candidates again for every cache miss and could combine pages from searches made at different times.
- Action: store one filtered batch and slice it into pages. A page request carries the batch identifier so a refresh cannot silently mix results. Keep existing saved pages available offline and leave keyword pagination on its original path.
- Verification: a controlled backend test verified one upstream call across three pages, a fresh batch after refresh, a conflict for the older identifier, and offline fallback for both batch and legacy cache rows. At 390px, Edge kept the displayed first page when its batch changed, refreshed explicitly, and appended the next page from the new batch. Full Chrome navigation smoke, production build, source preflight, 154 backend tests and 13 frontend tests passed.

## L-20261123-35 — Compare both appearances on the same newer functional build

- Evidence: the prior dual review was pinned to `92a2ca5`, so it could not demonstrate whether later navigation and recovery improvements survived the appearance rollback.
- Action: export `bdefb4a` twice to `D:/论文阅读/.medread-review-bdefb4a` and reverse only the appearance files in the original variant. Run both builds with separate demo stores and loopback origins, leaving older previews available.
- Verification: versioned backend files match exactly and the frontend source diff is limited to the stylesheet import and the four appearance stylesheets. The polished preview at http://127.0.0.5:3324 and original preview at http://127.0.0.6:3325 were built for production and captured at 390px and 1440px. Text centers for five representative controls in the polished build were within one pixel of the control center at both widths. The PDF upload button measured 36px on desktop and 44px in the narrow reader, with a 10px radius.
- Browser fixture adjustment: the asynchronous comparison test had returned two different payloads for the same artifact after job completion. Align the matrix fixture with the completed artifact and assert that the saved job ticket is actually resumed and cleared after reload. Both appearance variants passed the full Chrome navigation regression with the corrected fixture.

## L-20261123-36 — Return from source verification to the same design view

- Evidence: the design workspace held its selected view and expanded stage only in React state. Browser back or reload could switch to another view and collapse the stage. A saved synthesis link was also hidden when that version's gap text was empty.
- Action: remember explicit view selection in the current history entry and store the expanded stage by artifact within the tab. Keep an explicitly selected view when background results arrive. Render a saved source link independently of optional research-gap text.
- Verification: Chrome and Edge at 390px used keyboard navigation to open the canvas, expanded a stage, opened its saved synthesis with empty gap text, and used browser back to recover the canvas, stage and draft constraints. The selected novelty view survived reload, and returning to the canvas reopened the saved stage. Full Chrome navigation smoke, production build, source preflight, 154 backend tests and 13 frontend tests passed.

## L-20261123-37 — Return from a PDF citation to the evidence that opened it

- Evidence: the claim drawer stored its selection only in component state. Returning from the reader closed the claim and could display a newer active comparison after a workspace change.
- Action: record the claim index together with its comparison identity in the current history entry. Pin the comparison when following its PDF citation and focus the original claim button when its drawer closes. Validate the selection against the displayed artifact.
- Verification: Chrome and Edge at 390px opened an exact PDF citation, recovered from delayed reader requests, then went back after the active comparison was cleared. Both returned to the original comparison and claim. Escape closed the drawer and focused the matching claim button. Full Chrome navigation smoke, production build, source preflight, 154 backend tests and 13 frontend tests passed.

## L-20261123-38 — Keep the discovery graph context within its search

- Evidence: the search list survived reader navigation, while the graph tab and centers reverted on back or reload.
- Action: remember the view, loaded center and selected paper in the tab, scoped by query, mode and semantic batch. Restore the requested graph data by its saved center. Clear the destination view on an explicit first-page search and use the list for fresh results.
- Verification: Chrome and Edge at 390px opened a paper from the second search result's lineage, returned to that center and reloaded it. With WebGL disabled, both also joined the reader from a reference node and recovered that selected node and its original center. A different query opened in the list view. Full Chrome navigation smoke, production build, source preflight, 154 backend tests and 13 frontend tests passed.
