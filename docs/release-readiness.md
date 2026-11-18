# Local readiness review — 2026-11-17

## Current scope

Four research modules remain available: discovery, reading (including writing and experiment maps), synthesis, and design. This review prepared the local project only; no deployment was performed.

## Changes and checks

- PDF upload writing and hashing now run off the async event loop. A regression test holds the write open and verifies that the loop remains responsive; upload/parse was also checked with a temporary synthetic PDF against the restarted local backend.
- PATCH/PUT origin checks now match the existing POST/DELETE protection. A foreign-origin workspace mutation test checks that the data is not changed.
- Paper-experiment extraction reserves context for both methods and results. Evidence links distinguish a multi-page unit's start page from an exact location. AI quotations still require source matching; candidate associations require review.
- Removed three tracked visual components no longer imported since c1ec28c, one unreferenced tracked image, and unused @xyflow/react and react-force-graph-2d dependencies. Git history retains the removed files. The old `D:/论文阅读/research-platform-review-ui` copy was moved to `D:/论文阅读/_archive/research-platform-review-ui_20261117`; other projects and user data were retained.
- Previous same-directory Next development servers could overwrite each other's compiled API endpoint. The 8001 preview uses a separate `.next-preview` cache; `MEDREAD_NEXT_DIST` allows isolated build checks.
- Local checks: backend 128 tests, frontend 9 tests, TypeScript, same-origin production build, local deployment-source preflight, four empty-state navigation pages, temporary PDF upload/parse, model connectivity probe and both OpenAlex search modes passed. Timings are single-session observations, not capacity or performance guarantees.

## Remaining before a real release

- Recheck the complete four-module journey with representative real papers, including model-generated reading, experiment maps, evidence comparisons, design versions and visual/export behavior. Current automated and empty-state navigation checks do not establish scientific correctness or full UI coverage.
- Inspect behavior with long PDFs, scanned/two-column articles and imprecise page references. OCR is not currently provided; source extraction, generated claims and candidate method links require comparison with original PDFs.
- Anonymous sessions are browser-cookie based; clearing cookies or changing browsers can lose access to prior records. Decide an account/recovery strategy before expecting reliable cross-device use.
- When deployment is requested, verify the actual target's persistent data paths, backup/restore, origin/HTTPS configuration, resource limits and single-worker job assumptions. Existing deployment documents are historical configuration examples, not proof of current server readiness.

## Local follow-up — 2026-11-17

- A same-origin Next.js production build reported 120 kB of first-load JavaScript for `/read`, down from 175 kB. Markdown loads when a message is shown, and each map loads when its tab opens. Chrome opened a real example PDF, rendered saved Markdown and both maps, and switched back to the PDF without a page error.
- In an isolated Windows instance, six concurrent sessions completed 120 paper-list and workspace reads while model calls were in progress. The median for a pair of requests was 14.5 ms and p95 was 19.1 ms. One live reading request produced its first content after 41.9 s and finished after 58.1 s. The live comparison and design jobs finished in 23.1 s and 36.2 s. These checks establish local behavior for the sampled requests. Model output still needs evidence review, and target-server capacity remains unmeasured.
- The backup and restore drill validated 105 file references. With the original store offline, the restored app accepted the original session, returned an identical PDF, preserved its 13 reading units and six messages, and returned the same workspace and design history. A different session was denied access to the original paper. See [the restore procedure](../deploy/README.md#数据备份和恢复) for target-server rehearsal.
