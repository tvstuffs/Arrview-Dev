# ArrView server development changelog

## 1.08 — 2026-09-19 — Remove movie from Radarr

Adds `DELETE /api/radarr/movie/:id?deleteFiles=true|false` → Radarr
`DELETE /api/v3/movie/{id}?deleteFiles=&addImportExclusion=false`. Only the
literal `deleteFiles=true` deletes the movie folder; anything else keeps files.
The exclusion flag uses Radarr's spelling (`addImportExclusion`); Sonarr's
`addImportListExclusion` is never sent because Radarr silently ignores it. No
import-list exclusion is ever added. Non-numeric ids are rejected with 400 before
any upstream call; upstream failures keep their status and Radarr's message;
unconfigured Radarr is 503. Trailing slashes on the configured Radarr URL are
tolerated. Existing `moviefile/:id` (file-only delete) and `movie/monitor` are
unchanged. The iOS app (Core 0.2.3) shows a server-1.08 message on 404 from older
servers. Development-only; no image published or deployment performed.

### Human test plan

1. In a test deployment configured for Radarr, pick a **disposable** movie.
   `DELETE /api/radarr/movie/<id>?deleteFiles=true` must return `{"success":true}`,
   the movie must disappear from Radarr's library, its folder must be gone from
   disk, and Radarr's Import List Exclusions must not gain an entry.
2. Repeat with `deleteFiles=false` on another disposable movie: the movie leaves
   Radarr but its folder stays on disk.
3. Confirm `?deleteFiles=1`, `?deleteFiles=TRUE` and no query all keep files.
4. Request an id that no longer exists: expect Radarr's 404 and its message
   passed through, not a 503. Request `abc` as the id: expect 400 with no
   Radarr traffic (check Radarr's log).
5. Confirm the web Settings footer and `/api/arrview/identify` report 1.08.
6. Recheck the existing movie-file delete and monitor routes still work.

### Verification / not verified

`node --check server.js` and `node --test tests/*.test.js`: **22 passed, 0 failed**
(three parent contracts; the new movie-removal contract has six subtests covering
the forwarded query and flag spelling, non-true `deleteFiles` values, empty 200/204
upstream bodies, id validation before upstream traffic, upstream 404/500 status and
message handling, and unconfigured Radarr). The two existing suites' version
assertions moved from 1.07 to 1.08. Tests use real local HTTP servers with fake
configuration. Live Radarr, Docker builds/deployment and the web UI were not
tested; the web dashboard has no movie-removal control (ROADMAP P1 #2 still open).

## 1.07 — 2026-09-19 — Bounded recent-import metadata

Adds `/api/radarr/history/recent-imports?page=1…3`: fixed 20-record, newest-first
Radarr import-history pages with embedded current movie metadata, a 512 KiB
upstream cap, no redirects, strict page validation and a response field allowlist.
Movie IDs, titles, year, current-file state/date and poster URLs are retained;
paths, overviews and release/custom-format metadata are omitted. Upstream failures
remain failures, with generic error text; upstream 404 becomes 502 to distinguish
it from a missing proxy route. Existing library/calendar routes are unchanged.
This is development-only; no image was published or deployment performed.

### Human test plan

1. In a test deployment configured for Radarr, request pages 1–3 and compare them
   with Radarr's successful imports. Verify eventType 3, pageSize 20, includeMovie
   and descending date at the upstream; no full movie-list request should occur.
2. Verify output contains only the widget field allowlist; check current-file
   state, duplicate imports, removed movies and an empty history. Invalid/repeated
   page values must return 400 without upstream traffic. Caller-supplied pageSize,
   eventType or sorting must not relax the fixed contract.
3. With a disposable upstream, check malformed/oversized JSON, redirects, 401,
   404 and connection failures. They must not turn into empty successful pages or
   expose request credentials/upstream error details. Inspect client diagnostics.
4. Use a compatible widget in both proxy and Direct modes against a large
   library. Check bounded history traffic, ordering, cache retention on failure,
   and the three-page/12-item client bound. Test an older proxy's 404/HTML fallback.
5. Recheck the ordinary movie library and Sonarr calendar through the proxy.
   No config-storage changes; existing configuration must remain usable.

### Verification / not verified

`node --check server.js` and `node --test tests/*.test.js`: **15 passed, 0 failed**
(two parent contracts plus 13 subtests). Tests start real local HTTP servers with
fake service configuration; they cover fixed queries, response trimming, paging,
empty/deleted entries, oversized/malformed bodies, errors and blocked redirects.
Live Radarr, Docker builds/deployment, physical widget memory/network privacy and
end-to-end overnight widget refresh were not tested. Frontend and storage are
unchanged, so no frontend build or migration test was added for this route.
