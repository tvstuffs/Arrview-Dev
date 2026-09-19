# ArrView server development changelog

## 1.10 — 2026-09-19 — Web parity W1: Home Screen shell

- Added the standalone manifest, 192/512 icons, safely padded maskable icon and
  Apple 180px icon generated from the existing SVG. Added theme/Apple metadata
  and viewport-fit=cover. System fonts stay local.
- Added vite-plugin-pwa with automatic updates and a custom shell-only worker.
  APIs (including config, health, SSE and mutations) always use the network and
  are never cached. Navigation is network-first with an explicit offline page,
  not a stale dashboard; retry/online recovery probes health before reopening.
  Initial config fetch failure now shows a retryable server-unavailable screen,
  not misleading first-run setup.
- Settings contains platform-aware Home Screen help, a Chromium Install button
  when offered, and standalone status/external-link guidance. Ordinary LAN HTTP
  still works, but cannot register a worker; Android gets a browser shortcut.
- Replaced 100vh with 100dvh and added notch/home-indicator safe-area spacing to
  shell, settings, loading/offline views and toasts. Full tab/modal touch/layout
  overhaul, persisted state and background lifecycle work remain W2.
- Version is 1.10; identify adds capabilities pwa/ping/health without removing
  existing fields. Config schema, native apps and ArrViewCore are unchanged.
- README covers LAN HTTP, private Tailscale Serve and existing private HTTPS
  proxies, including the current no-auth boundary. External service links may
  open the browser; tab/filter state is not retained across app restarts yet.
- Added React component and real HTTPS Chromium test suites plus CI. Build/test
  tooling uses Vite 6.4.3 and Vitest 4.1.11 to use the patched compatible releases;
  package.json's application version remains 1.0.0. Production runtime dependencies
  are not intentionally upgraded in this sprint.

### Human test plan

1. Upgrade a **test** container from 1.09 to the new dev image with the same /data
   mount. Confirm URLs/keys survive, Settings/identify show 1.10, health is healthy,
   and all configured services work. Repeat from the currently shipped container
   if that is your baseline. No config schema migration should occur.
2. On a **physical iPhone**, open the LAN HTTP URL in Safari, Settings → Add to
   Home Screen, then Share → Add to Home Screen → Add. Launch the ArrView icon:
   check name/icon, standalone appearance and return from external service links.
   Repeat using private HTTPS; confirm the worker registers there, not LAN HTTP.
3. On a **physical Android phone**, use Chrome with a trusted HTTPS URL (private
   Tailscale Serve is suitable). Install via the offered button or Chrome menu;
   confirm standalone launch and an unclipped circle/squircle icon. Dismiss an
   install prompt and verify the manual instructions remain. On plain LAN HTTP,
   verify the help describes a shortcut and it launches inside Chrome instead.
4. After a successful HTTPS visit, disconnect from the server and relaunch/reload.
   Expect “Can’t reach your ArrView server”, never old queues/libraries or setup.
   Restore connectivity and use Try again: it should return to the dashboard.
   Inspect browser Cache Storage: no /api URLs or config/key/media JSON. Test an
   update while the app is open (finish unsaved settings first): new worker should
   activate and refresh the page, with saved configuration retained.
5. On a notched iPhone and Duo cover, check top controls below the notch and
   toasts/settings actions above the home indicator, including landscape where
   available. Check widths 305, 320, 360, 390, 402, 440, 466, 669, 834 and 1280;
   install help and offline retry must fit and be tappable. Other tab/modal
   mobile-layout defects are W2, not claimed fixed here.
6. Background/foreground the installed app, reconnect Wi-Fi, then verify queues,
   shows and movies refresh; use Refresh/reopen if needed. Existing lifecycle/SSE
   limitations remain W2 and must not be mistaken for offline cached API data.
7. On a physical device, regression-test native iOS **proxy mode** against this
   server (identify, browsing, downloads, calendar), then **Direct mode** against
   the same upstreams. Check LAN discovery/privacy. Simulator cannot establish
   local-network-privacy correctness (Apple TN3179). Native/Core unchanged, so no
   Apple build or native storage migration is introduced by this sprint.

### Verified / not verified

Production build and node syntax check passed. Node server contracts: **29/29**;
React/Vitest components: **10/10**; Playwright Chromium 153 HTTPS fixture:
**17/17**. Covers manifest/icon dimensions, identify compatibility, shell headers,
real service-worker control, API read/write cache exclusion, offline navigation,
reconnection, automatic worker update/reload, settings-save regression, insecure
HTTP no-worker behavior, and install/offline layout at all ten widths. New install
and retry controls meet 44px in the tested touch profile; this does not certify
all existing controls. Narrow 305/466px screenshots and maskable icon visually
inspected. First browser run had a retry-test race with automatic online recovery;
corrected the test and reran successfully. No live service data was used.

Physical iPhone/Android install sheets and launcher behavior, Safari/WebKit,
real safe-area insets/folding, VoiceOver/TalkBack, Tailscale/proxy setup, installed
app suspend/resume, live native proxy/Direct/LAN and real volume upgrade remain
**not verified**. Local Docker daemon is unavailable; remote build/publication
results are recorded separately after CI. Existing dependency audit findings in
runtime/transitive packages remain outside W1; no claim of W4 hardening.

## 1.09 — 2026-09-19 — Web parity W0

- History sizes now use SABnzbd `bytes` converted to MB, falling back to `mb`.
  Queue size handling is unchanged.
- Removed Google Fonts; the dashboard uses the system font stack.
- Built `/assets/*` get one-year immutable caching; the HTML shell, manifest,
  service worker and other public files revalidate. Missing files and unknown
  API routes return 404 instead of the SPA shell. API responses use no-store.
- Added `/api/{sonarr,radarr,sabnzbd,nzbhydra}/ping`, using system/status,
  mode=version and t=caps respectively. Health pills now use these checks.
  Missing configuration or upstream failure returns 503 with a generic error.
- Settings re-fetch saved configuration and update React state without a page
  reload, retaining the active dashboard tab. Failed re-fetch stays in Settings
  with an error. Hydra-only configuration is now recognised by App as configured.
- Added `/api/health` and Docker HEALTHCHECK. Health is process liveness, not
  upstream availability: an unconfigured server can be healthy.
- No config schema, native app or ArrViewCore changes. Home Screen installation,
  service worker, mobile layout and feature parity remain W1+ work.

### Human test plan

1. Upgrade a test container from 1.08 to this dev build with the **same existing
   /data mount**. Confirm all saved URLs/keys remain usable; Settings and identify
   report 1.09, `/api/health` returns 200, and Docker reports healthy. Stop an
   upstream: its pill should turn offline within 60 seconds, while container
   health remains healthy. Restore it and confirm the pill recovers.
2. In browser Network tools, verify pills call only the four `/ping` routes,
   not library/queue routes. Normal tab data requests still occur. Test valid and
   invalid keys, SAB root/subdirectory installs, and NZBHydra caps responses.
3. Open Downloads history: a bytes-only 1073741824 entry displays 1.0 GB; legacy
   mb-only 512 displays 512 MB; zero displays 0 MB. Queue totals must be unchanged.
4. From Movies or Shows, save changed settings. Expect POST config followed by
   GET config, no document reload, the same active tab and refreshed service links.
   Reopen Settings to confirm persistence. Test first-run save, adding/removing a
   service, and a failed post-save GET: stay in Settings with an error and retry.
5. Clear browser cache and load the dashboard. No Google Fonts requests should
   appear. Check text/readability on desktop and mobile. Hashed assets should have
   max-age=31536000 and immutable; index.html and SPA navigation no-cache; API
   no-store. Missing .webmanifest/.js files must return 404, not HTML 200.
6. On a physical iPhone, smoke-test iOS **proxy** browsing, downloads and calendar
   against the dev server, then **Direct** mode against the same services. Direct
   implementation is unchanged; it is a separate regression check. Confirm LAN
   access/discovery still works; Simulator cannot prove local-network privacy.

### Verification / not verified

`npm run build` passed (Vite 5.4.21; existing CJS API deprecation warning).
`node --check server.js` passed. `node --test tests/*.test.js`: **29 passed,
0 failed**, including four parent contracts. New W0 fixture coverage exercises
liveness without config, ping targets/auth/error sanitization, HTTP-200 API errors,
missing services, cache headers, SPA navigation and missing-file/API 404s.

Local Docker build/runtime could not run because the Docker daemon is stopped.
Browser runtime reported no connected browsers, so interactive settings/history
checks and font appearance are **not verified**. Live upstreams, physical-device
proxy/Direct/LAN checks and container upgrade persistence are **not verified**.
No Apple builds were needed: native apps/Core are unchanged. PWA installation,
Android HTTPS/HTTP shortcut behavior, safe-area and lifecycle checks belong to
W1/W2, which this version does not implement.

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

## Amendment 2026-09-19 — Docker channels and multi-platform publishing

Infrastructure only; application version unchanged. Repository-aware GHCR
publishing isolates `dev` and `latest`, uses channel-specific full-commit tags,
and builds both linux/amd64 and linux/arm64. Release v* tags publish versioned
images without moving latest. Compose accepts ARRVIEW_TAG (default latest).
The identical workflow is safe to promote between Dev and release repositories.

Human test plan: follow README's "Docker channels and ARM64" verification plan:
verify channel digest isolation, both manifest architectures, startup/service
connections and config persistence on both host architectures, physical-device
Bonjour/proxy and Direct regression, and switching back to latest. Application
storage and Apple code are unchanged, so no Apple rebuild or schema-migration
check is required for this infrastructure change alone.

Verification results are recorded below after local checks. GHCR publication,
ARM64/AMD64 container builds and live runtime/device checks are not yet verified.

Local verification: Actionlint 1.7.12 passed both workflows; 10 evaluated
repository/ref/event cases passed the channel isolation checks. Both Compose
files parsed as YAML with the expected ARRVIEW_TAG/default-latest template;
workflow byte equality and both architecture targets were checked. No Docker
daemon or Compose CLI is available here, so these are static checks, not image
builds, Compose execution or runtime tests. No image was pushed or deployed.
