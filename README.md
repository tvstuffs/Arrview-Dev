# ArrView

A self-hosted dashboard to monitor and manage your media downloading stack.

| Service | Purpose |
|---------|---------|
| **SABnzbd** | Usenet download queue — live progress, pause/resume |
| **NZBHydra** | Usenet search aggregator — connection status |
| **Sonarr** | TV show library — view all shows, trigger missing-episode searches |
| **Radarr** | Movie library — view collection, download missing films |

---

## Requirements

- [Node.js](https://nodejs.org/) v18 or later (includes npm)

---

## Setup

```bash
# 1. Install dependencies
cd arrview
npm install

# 2. Start in development mode (hot-reload)
npm run dev
#  → React frontend:  http://localhost:5173
#  → API backend:     http://localhost:7777

# 3. OR build for production and run as a single server
npm run build
npm start
#  → Dashboard served at http://localhost:7777
```

On first launch you'll be taken to the **Configuration page**. Enter the server URL and API key for each service you want to monitor, test each connection, then click **Save & Open Dashboard**.

Settings are saved to `config.json` (gitignored). You can re-open settings any time via the ⚙️ button in the top bar.

---

## Finding your API keys

| Service | Location |
|---------|----------|
| **SABnzbd** | Config → General → Security → API Key |
| **NZBHydra** | Config → Main → API key |
| **Sonarr** | Settings → General → Security → API Key |
| **Radarr** | Settings → General → Security → API Key |

---

## Features

### Downloads (SABnzbd)
- Live download queue with per-item progress bars, speed, and ETA
- Pause / Resume / Delete individual items
- Pause All / Resume All queue controls
- Auto-refreshes every 10 seconds with a visible countdown
- Recent download history

### TV Shows (Sonarr)
- Full series list with per-show episode completion bar
- **Missing episodes badge** per show
- One-click **Search Missing** to trigger a Sonarr series-wide search
- Expandable show detail: all seasons → all episodes with download status
- Per-season and per-episode search buttons for granular control
- Filter by: All / Has Missing / Continuing / Ended
- Sort by: A–Z / Most Missing / Newest First

### Movies (Radarr)
- Full movie library with download status badges
- **Download All Missing** bulk action
- Per-movie **Download** button for available-but-missing films
- Filter by: All / Downloaded / Missing / Monitored
- Sort by: A–Z / Newest First / Recently Added

---

## Project structure

```
arrview/
├── server.js            # Express API proxy + config storage
├── config.json          # Generated on first save (gitignored)
├── src/
│   ├── App.jsx          # Root component, config gate
│   ├── index.css        # Global dark theme
│   └── components/
│       ├── ConfigPage   # Service connection setup
│       ├── Dashboard    # Top bar, tabs, service status
│       ├── DownloadsTab # SABnzbd queue & history
│       ├── ShowsTab     # Sonarr series + episodes
│       └── MoviesTab    # Radarr movie library
└── vite.config.js       # Dev proxy to backend on :7777
```

---

## Changing the port

Set the `PORT` environment variable before starting:

```bash
PORT=8888 npm start
```

---

## Docker

This project can run as a standalone container.

### Pull from GitHub Container Registry

After pushing to GitHub, the workflow in `.github/workflows/publish-ghcr.yml` publishes the image to GHCR automatically.

```bash
docker pull ghcr.io/tvstuffs/arrview:latest
```

### Run the published image

```bash
docker run -d --name arrview \
  --network host \
  -e PORT=7777 \
  -v "$PWD/arrview-data:/data" \
  ghcr.io/tvstuffs/arrview:latest
```

The container serves the dashboard on `http://localhost:7777` and stores saved settings in `/data/config.json`.

> **iOS auto-discovery requires host networking.** The container advertises
> itself over Bonjour/mDNS so the ArrView iOS app can find it on the network
> without typing an address. mDNS is **multicast**, which Docker's bridge
> network does **not** forward — publishing ports (`-p 7777:7777`) only forwards
> the unicast HTTP traffic, so the advertisement never leaves the container and
> discovery silently fails. Run with `--network host` (or `network_mode: host`
> in Compose) so the advertisement reaches the LAN. Notes:
> - Host networking is **Linux-only**; it does not broadcast to the LAN under
>   Docker Desktop for Mac/Windows (Docker runs in a VM there).
> - Ensure the host firewall allows UDP **5353** (mDNS).
> - If you can't use host networking, the app still works — just choose
>   **Connect Directly** in setup and enter `http://<host>:7777` manually.

### Configure services from Docker (optional)

Instead of typing service addresses and keys into the Settings page, you can
supply them as container environment variables. This is useful for repeatable
deployments. Without any `ARRVIEW_*` variables you still configure services in
Settings as before, but the masked keys, request validation, key rule and atomic
saves described below apply either way.

| Variable | Meaning |
|---|---|
| `ARRVIEW_HOST` | One address for all services, for example `localhost` or `<docker-host-address>`. A host name (letters, digits, dots and hyphens; no underscores), IPv4 address or bracketed IPv6 address, optionally prefixed with `http://` or `https://`. No port, path, query, fragment or credentials. Each service uses its default port (SABnzbd 8080, Sonarr 8989, Radarr 7878, NZBHydra 5076). |
| `ARRVIEW_<SVC>_API_KEY` | API key, where `<SVC>` is `SONARR`, `RADARR`, `SABNZBD` or `NZBHYDRA`, for example `<your-sonarr-api-key>`. Surrounding whitespace and newlines are trimmed. |
| `ARRVIEW_<SVC>_API_KEY_FILE` | Path **inside the container** to a file containing the key, for example `/run/secrets/sonarr_api_key`, bind-mounted from `./secrets/sonarr_api_key` on the host (a relative path resolves from the container's `/app` directory). Read once at startup and trimmed. Set this or the plain variable, not both. |
| `ARRVIEW_<SVC>_URL` | Optional per-service address that replaces `ARRVIEW_HOST` for that service, for example `http://<docker-host-address>:8989/sonarr`. Without a scheme `http://` is added. The default port is added only when the override has neither a scheme nor an explicit port. |

Rules:

- **A service is "env-managed" only when it has both a key and an address.**
  `ARRVIEW_HOST` never configures a service that has no env key. Env-managed
  services are applied on top of `config.json` on every read, are never written
  to it, and are read-only in Settings. To change them, edit the compose file or
  `.env` and recreate the container with `docker compose up -d`; after changing
  the contents of a secret file, restart it (`docker compose restart arrview`),
  because `up -d` may not notice a changed file. No image rebuild is needed.
- A half-configured service (a key with no address, an address with no key, or
  an invalid value) logs a `[config]` warning at startup, ignores all its env
  values and stays editable in Settings. The server still starts.
- An invalid `ARRVIEW_HOST` only affects services that rely on it; a service
  with a valid `ARRVIEW_<SVC>_URL` override and a key stays env-managed.
- Service URLs must not contain `?` or `#` (query strings and fragments are
  rejected everywhere, including Settings). A base path such as `/sonarr` is fine.
- The default port is added only to an override that has neither a scheme nor
  an explicit port (for example `ARRVIEW_SONARR_URL=<docker-host-address>`).
- Mount the whole data directory (`./data:/data`), not `config.json` as a
  single-file bind mount: saves write a temporary file and rename it over
  `config.json`, which fails on a single-file mount.
- Atomic saves have these effects: the first `config.json` that ArrView creates
  is mode `0600` and owned by the user running the server (root in the
  container); an existing `config.json` keeps its mode but is owned by that user
  after the first save; a single-file bind mount of `config.json` fails, so
  mount the directory; a symlinked `config.json` is replaced by a regular file;
  and the data directory must be writable (on a read-only mount every save
  fails with a 500 "Could not save settings").
- API keys (typed in Settings or set in the environment) are trimmed and must
  contain at least one ASCII letter or number (`A`–`Z`, `a`–`z`, `0`–`9`). Typed
  keys are also limited to 256 characters with no control characters. A key such
  as `----` or only spaces is rejected: Settings refuses to save it, the server
  answers 400, and an
  environment key like that is logged by variable name and ignored.
- Environment values are read once at startup. Logs name variables but never
  print keys or secret file contents.
- With host networking (`network_mode: host`), containers share the host's
  network: use `localhost` or the host's address, not compose service names.

Settings and `GET /api/config` return API keys masked (`••••` plus the last four
characters; keys of eight characters or fewer show only `••••`). A masked key sent
back is reused only if the address is unchanged; if you change a service address
you must re-enter its key. Note that ArrView still has no login.

Behaviour for scripts and other clients:

- `POST`, `PUT` and `PATCH` requests to `/api` (other than `/api/webhooks/*`) must
  send `Content-Type: application/json` with a body, otherwise the server answers
  415; malformed JSON gets 400 `{"error":"Invalid JSON"}`. For example, `curl -d`
  needs `-H 'Content-Type: application/json'`.
- `POST /api/config` validates its body (unknown keys, invalid URLs and invalid
  keys get 400) and answers 409 if it tries to change an env-managed service. A
  Settings-managed service left out of the body is removed, so send the whole
  configuration.
- Plain `ARRVIEW_<SVC>_API_KEY` values are visible in `docker inspect` and in any
  compose file you share or commit. Prefer `_FILE` secrets on shared hosts, and
  keep `.env` and `secrets/` out of git (both are in `.gitignore` and
  `.dockerignore`).

### Build locally

```bash
# Build the image
docker build -t arrview .

# Run it with a persistent config volume in the background
# (--network host enables iOS auto-discovery; see the note above)
mkdir -p ./data
docker run -d --name arrview \
  --network host \
  -e PORT=7777 \
  -v "$PWD/data:/data" \
  arrview
```

The container serves the dashboard on `http://localhost:7777` and stores saved service settings in `/data/config.json`, which survives container restarts when the `./data` volume is mounted.

## Calendar API (1.06 development)

`GET /api/sonarr/calendar?start=<ISO-8601>&end=<ISO-8601>` returns monitored
Sonarr episodes with embedded series metadata. Both bounds are required; the
interval must be positive and at most 32 days. Requests forward to Sonarr v3 with
`includeSeries=true` and `unmonitored=false`. Missing Sonarr configuration returns
503; upstream failures are not converted into empty calendars.

Run `node --test tests/calendar.test.js` for the isolated, loopback-only proxy
contract suite (7 checks). `npm run build` verifies the unchanged web client.

Human verification: compare the calendar response to Sonarr for the same time
window; check empty results, invalid ranges, missing configuration, and upstream
connection/authentication failures. Test a calendar-capable client in both proxy
and Direct mode (Direct bypasses this server). Recheck existing series/episode
routes. Live Sonarr, deployment, physical-device networking, and container builds
were not verified by these automated checks.

## Recent-import history API (1.07 development — 2026-09-19)

`GET /api/radarr/history/recent-imports?page=1` supplies bounded metadata for
recent-movie widgets. Only pages 1–3 are allowed. Every upstream request uses
20 history records, `eventType=3` (downloadFolderImported), embedded movies and
newest-first date ordering. The upstream response is capped at 512 KiB, redirects
are refused, and only widget fields are returned. It never fetches the complete
movie library. Existing `/api/radarr/movies` and calendar contracts are unchanged.

Clients using this route need a server build containing it. An older server may
return 404 or the SPA's HTML instead. Clients must preserve their previous cache
and report the unsupported endpoint, not fall back to fetching the full library.
The client limits results to 12 distinct currently downloaded movies within the
bounded history window; purged history is not reconstructed from the library.

Run `node --test tests/*.test.js` for the loopback proxy contracts. See
[CHANGELOG.md](CHANGELOG.md) for the human verification plan and limitations.

## Docker channels and ARM64 — 2026-09-19

The publishing workflow builds `linux/amd64` and `linux/arm64` under the same
`ghcr.io/tvstuffs/arrview` package. Docker selects the matching architecture;
32-bit ARM is not included. These channels become available after the updated
workflows have been pushed and successfully run.

| Source / event | Published tags |
| --- | --- |
| `Arrview-Dev` main push | `dev`, `dev-sha-<full-commit>` |
| `Arrview-Dev` manual branch run | `dev`, `dev-sha-<full-commit>` |
| `ArrView` main push / manual main run | `latest`, `release-sha-<full-commit>` |
| `ArrView` `v*` tag | Exact Git tag (for example `v1.05`), `release-sha-<full-commit>`; does not move `latest` |

Dev tag pushes and release feature-branch manual runs do not publish. Forks are
blocked from publishing by the job condition. Both repositories use the same
repository-aware workflow so promoting it cannot swap channel responsibilities.
(Update 2026-10-12: these channels are live. Dev's workflow now also runs
`test.yml` first and publishes only if it passes, so the two files differ until
the test gate is promoted together with `test.yml`, `tests/`,
`playwright.config.cjs` and the dev dependencies.)
Commit tags identify source revisions; pin an image digest if you need immutable
image bytes, since rebuilding the same commit can pick up updated base layers.

### Choose a deployment channel

The Compose file defaults to the supported release (`latest`). To use development
builds, create or update `.env` beside your deployment's `docker-compose.yml`:

```dotenv
ARRVIEW_TAG=dev
```

Use `ARRVIEW_TAG=latest` for supported releases, or an existing version/commit tag
to pin a build. Then, from that directory, run:

```sh
docker compose pull arrview
docker compose up -d arrview
```

A new image publication does not update running containers automatically. These
commands switch one installation; to run both channels at once, use separate
Compose projects/directories, container names, host ports (`PORT` with host
networking), and data folders. Do not share writable configuration between them.
Keep your existing data when updating one installation; no config migration is
introduced by this workflow change.

### Publishing setup

In the GitHub `arrview` package settings, under **Manage Actions access**, grant
both source repositories **Write** access. The workflows use their built-in
`GITHUB_TOKEN`; no new personal access token is needed. Package visibility must
be **Public** for anonymous pulls, or deployment hosts must authenticate.

Land the workflow in Dev first and verify `dev` before publishing the release
workflow. Do not promote unrelated development application changes just to enable
ARM support. Once the workflow is on Dev's default branch, GitHub Actions →
**Publish Docker image to GHCR** → **Run workflow** can select a feature branch
that also contains this updated workflow. This intentionally replaces `dev` with
that branch's build. Ordinary feature-branch pushes do not publish.

### Human verification plan

1. Record the current `latest` digest, run Dev publishing, and confirm `dev` has
   appeared while `latest` is unchanged. Confirm the expected `dev-sha-*` tag.
2. Run `docker buildx imagetools inspect ghcr.io/tvstuffs/arrview:dev`; verify
   `linux/amd64` and `linux/arm64` manifests. Additional attestation manifests
   are normal. Repeat for `latest` after release publication.
3. On an ARM64 Docker host and an AMD64 host, pull/recreate a test installation.
   Confirm startup, dashboard, server identification and configured service
   connections. Save configuration, recreate the container and confirm it remains.
4. Exercise the Apple app in proxy mode against the test container, then check
   Direct mode still works. Use a physical device for LAN/Bonjour discovery;
   the iOS Simulator cannot verify local-network privacy.
5. Publish the approved release-main workflow and verify only `latest` and its
   `release-sha-*` tag move, not `dev`. A release `v*` tag should publish that
   version without moving either channel.
6. Switch the test installation back to `ARRVIEW_TAG=latest`, pull and recreate;
   verify the supported version starts with the existing configuration.

No application routes, storage schema, Core dependency or Apple builds change in
this infrastructure update. Real GHCR publication, both architecture builds,
live-service runtime behavior, physical discovery and rollback must be verified
before claiming this rollout is complete.

## Server health and caching (1.09)

`GET /api/health` returns `{"status":"ok","version":"1.09"}` when the
ArrView process is responding, even before setup or when an upstream is offline.
The Docker image checks it on loopback using the configured `PORT` every 30 seconds.
This is liveness, not a guarantee that all configured services are reachable.

`GET /api/<service>/ping` checks Sonarr, Radarr, SABnzbd or NZBHydra using their
lightweight status/version/capabilities APIs. Service names are `sonarr`, `radarr`,
`sabnzbd`, `nzbhydra`; success is `{"status":"ok"}`, unavailable/unconfigured is
HTTP 503, and unknown services are HTTP 404. The dashboard polls these for pills.

Hashed build assets under `/assets/` are immutable for one year. The HTML shell
and mutable public files revalidate; API responses are not stored. Reverse proxies
should preserve these headers. Missing file paths return 404, not the HTML shell.
See CHANGELOG's 1.09 human test plan before promoting a dev image to release.

## Home Screen app (1.10)

Open **Settings → Add to Home Screen** for instructions for your device. On
supported Chromium browsers an **Install ArrView** button appears when the browser
makes installation available. Its absence is normal on Safari, after dismissal,
or when the browser's installation criteria have not yet been met.

- **iPhone/iPad:** in Safari, Share → Add to Home Screen → Add. Keep “Open as Web
  App” enabled if offered. LAN HTTP works for Home Screen launch; HTTPS is needed
  for the service worker/offline screen.
- **Android:** in Chrome over HTTPS, menu → Install app (or Add to Home screen)
  → Install. Over ordinary LAN HTTP, Add to Home screen creates a **browser
  shortcut**, not a standalone app.
- **Desktop:** use the browser's Install app control/menu where supported.

The manifest, Apple touch icon and maskable Android icon are served locally.
The existing SVG is the source of truth; `npm run icons` regenerates the 192/512,
maskable 512 and Apple 180 px assets. Keep these generated PNGs in source control.

### Offline behavior and updates

A service worker registers **only on HTTPS or a browser-trusted loopback origin**
(e.g. localhost). It caches the local shell/icons, never `/api/*`, media libraries,
queues, configuration or keys. Navigations try the network first and show
“Can’t reach your ArrView server” if unreachable; **Try again** probes `/api/health`
and reopens the app when the server is back. First-ever offline launch cannot work:
the site must have loaded successfully at least once on that origin. Ordinary LAN
HTTP has no offline screen. HTTPS is not offline media support.

Updates activate automatically; an open page may reload when a new worker takes
control. Finish unsaved Settings edits before updating the container. External
Sonarr/Radarr/service links intentionally open another browser surface; return to
ArrView using its Home Screen icon. Existing tab/filter state is not persisted
across app restarts. Full background/foreground refresh and mobile layout work are
separate follow-ups, not features promised by this shell.

The identity API now adds `capabilities: ["pwa", "ping", "health"]` alongside the
unchanged `app`, `version` and `services` fields. `pwa` means the shell is provided;
actual installation/offline behavior still depends on browser and origin security.

### HTTPS options

| Access | Home Screen behavior | Setup |
|---|---|---|
| Private LAN HTTP | iOS web-app launch; Android browser shortcut; no service worker | Existing container URL; no infrastructure change |
| **Private Tailscale HTTPS (recommended)** | Standalone installation and offline screen on supported browsers | Install/sign in to Tailscale on server and devices, then run `tailscale serve --bg 7777` on the server. Use the HTTPS URL it prints; Serve may guide you to enable HTTPS certificates. No router port forwarding required. |
| Existing private HTTPS reverse proxy | Same HTTPS behavior | Caddy, Nginx Proxy Manager or Traefik can terminate a trusted certificate and proxy to ArrView's port 7777. Preserve `/api`, SSE streaming and cache headers; deploy at the domain root, not a path prefix. |

For the last option, Let's Encrypt (often via DNS validation) can provide a trusted
certificate without making the app public. **ArrView 1.10 still has no built-in
login. Its configuration API masks service keys, but anyone who can reach it can
still change settings.** Keep the front door LAN-
or tailnet-only, or protect it with an access-controlled gateway. Do not port-
forward this unauthenticated container or enable Tailscale Funnel for it. The
planned authentication sprint is the gate for public remote-access guidance.
Browser gateway login does not imply compatibility with native API clients.

Tailscale Serve is private to your tailnet (subject to its access policy); it is
not Tailscale Funnel. Bonjour/mDNS discovery on the local network is unchanged
and still uses the existing host-network advertisement. An HTTPS URL does not
extend mDNS discovery across networks.

### Development verification

```sh
npm ci
npm test                     # Node contracts + React component tests
npx playwright install chromium
npm run test:e2e              # production build + isolated HTTPS browser fixture
```

Browser tests generate a temporary localhost certificate with OpenSSL and run only
against fake loopback upstreams, never a configured live library. They cover HTTPS
registration, API cache isolation, offline recovery, insecure HTTP behavior and
the new install/offline UI at widths 305, 320, 360, 390, 402, 440, 466, 669, 834 and
1280 px. This is **not** a claim that all existing tabs meet mobile touch/layout
requirements. Actual iPhone/Android installation, notches/safe areas, app resume,
native proxy/Direct regression and persistent-volume upgrades remain the human
checks in CHANGELOG 1.10 before release promotion.

## Mobile dashboard (1.10.1 / W2)

Below 640px the main navigation is a fixed bottom bar: Downloads, Shows, Movies,
Search and Settings. Service tabs appear only when configured; NZB search requires
Hydra, and sending a result requires SABnzbd. Wider windows keep top navigation.
Touch controls are at least 44px; sheets keep a reachable Close button, trap
keyboard focus, support Escape, and return focus to the triggering control.
Episode rows/actions wrap, and mobile toasts sit above the bottom bar. Appearance
follows the system's light/dark preference, including theme-color and offline UI.

View preferences are stored **locally in that browser/origin** under
`arrview.ui.v1.*`: last tab, library search/filter/sort, expanded show/seasons,
release sorting/rejected filter, and NZB search text. Search results, media data,
API keys and service configuration are not stored there. Browser storage denial
or corrupted preferences falls back safely; clearing site data resets these
preferences. Moving from HTTP to HTTPS starts a separate browser preference set.
Changing/removing a service cannot restore an unavailable tab into a blank page.
This supersedes W1's note that the default tab always returns after relaunch.

One shared server-events connection is open while the dashboard is visible. It
closes while hidden; periodic health, download, show/episode and movie refreshes
pause too. Returning refetches the active view and reconnects. Movies also refresh
every 60 seconds while visible. Sonarr command-status checks pause while hidden
and are disposed when their card/tab closes. The server supplies a five-second
SSE retry hint. A dropped/reopened stream triggers a catch-up fetch. This is not a
background-download engine and does not guarantee mobile OS background execution.

Existing destructive actions now share explicit confirmations: deleting episode
or season files and unmonitoring them, removing a series from Sonarr while keeping
or deleting files, and removing a SABnzbd queue item. Partial file/unmonitor
failures are reported rather than claiming success. W2 does **not** add whole-
series Delete and Unmonitor or new Radarr management actions; W3 feature work
remains separate. Confirm only against disposable media during testing.

The test fixture now contains queues, shows/episodes, movies and search results.
Responsive tests cover the full current UI at 305, 320, 360, 390, 402, 440, 466,
669, 834 and 1280px, including sheets, touch target sizes, preference restoration,
keyboard focus, light/dark and simulated visibility transitions. Physical Safari/
Android installation, keyboard/notch behavior and real suspend/resume still need
the human checks in CHANGELOG 1.10.1.

## Library parity (1.10.2 / W3)

Movies now have lazy posters, List/Posters views, file details, interactive
release search, monitoring, Recently Downloaded sort and both explicit deletion
choices. Delete and Unmonitor keeps the library entry; Delete and Remove from
Radarr removes it and its files. Removal is gated by server capability or version
1.08+. A partial error is not success: close the sheet and refresh before retrying.
Posters are fetched from service-provided remote URLs, not precached offline.

Shows add posters, monitoring and Upcoming. The calendar covers yesterday through
14 days ahead in local time and opens the selected show. Upcoming is available
from the Shows toolbar and navigation when Sonarr is configured. Series monitoring
preserves the upstream resource's other fields. It does not delete series files.

Downloads poll every 2 seconds while downloading and 10 seconds idle while
visible; W2 hidden/resume rules still apply. Load more increases history by 15,
up to 1000. Settings lists configured services (not a connectivity claim; use
Test to verify). Movie presentation joins the existing browser-local preferences.
Human release checks are in CHANGELOG 1.10.2; native apps and Core are unchanged.

## Web redesign routes

Server routes for the art-led web redesign. They exist only in this proxy server
(Direct-mode clients bypass it). Clients detect support from the `capabilities`
strings in `GET /api/arrview/identify`.

| Route | Capability |
| --- | --- |
| `GET /api/sonarr/queue` | `sonarrQueue` |
| `GET /api/radarr/queue` | `radarrQueue` |
| `GET /api/sonarr/series/:id/episodes` (adds `includeImages=true`) | `episodeStills` |
| `GET /api/sonarr/calendar` (adds `includeEpisodeImages=true`) | `calendarStills` |
| `GET /api/radarr/calendar?start&end` | `radarrCalendar` |

### Queue: `GET /api/sonarr/queue`, `GET /api/radarr/queue`

Takes no parameters (client query parameters are ignored). The server requests the
first page of 100 records from the service (`includeSeries` and `includeEpisode` for
Sonarr, `includeMovie` for Radarr) with a 10 second timeout, a 4 MiB response limit,
no redirects and strict JSON. The response is
`{ page, pageSize, totalRecords, records }`; `totalRecords` larger than
`records.length` means the list is truncated at 100.

Each record holds only: `id`, `title`, `status`, `size`, `sizeleft`, `timeleft`,
`estimatedCompletionTime`, `trackedDownloadStatus`, `trackedDownloadState`,
`downloadId`, `quality` (`{ name }` or `null`), and either `seriesId`, `episodeId`,
`series` (`{ id, title, year, images }`) and `episode` (`{ id, seasonNumber,
episodeNumber, title, airDateUtc }`) or `movieId` and `movie` (`{ id, title, year,
images }`). Embedded items are `null` when the service has none. `images` holds at
most the first poster and the first fanart as `{ coverType, url, remoteUrl }`. No
filesystem paths, download client, indexer, overview or authentication material is
returned.

`downloadId` is passed through verbatim as a string, or `null` when absent, empty or
not a string. It is never trimmed or case-folded, so an exact comparison with
SABnzbd's `nzo_id` is the only matching rule a client should use.

Errors return only `{ error: 'Sonarr queue unavailable' }` or
`{ error: 'Radarr queue unavailable' }`: an invalid upstream page gives 502, an
upstream 404 gives 502, other upstream 4xx and 5xx statuses are kept, anything else
(connection failure, oversize or malformed body, redirect, service not configured)
gives 503.

### Radarr calendar: `GET /api/radarr/calendar?start&end`

Validated like the Sonarr calendar: `start` and `end` must each be one parseable
value, `end` after `start`, at most 32 days, otherwise 400 before any upstream call.
The server calls Radarr with the normalised ISO bounds and `unmonitored=false`.

**The server filters release types.** Radarr returns a movie when any of its dates
(cinema included) is in the window, so the server keeps a movie only when its
`digitalRelease` or `physicalRelease` falls inside the window (both bounds
inclusive). Movies with only a cinema date in the window, or with absent or
unparseable dates, are dropped; order is preserved and at most 500 movies are
returned. `inCinemas` is still returned but is informational and must not be shown
as a release date.

Each movie holds only `id`, `title`, `year`, `monitored`, `hasFile`, `isAvailable`,
`status`, `inCinemas`, `digitalRelease`, `physicalRelease`, `physicalReleaseNote` and
`images` (as above). Fields missing upstream are `null`. Limits and errors are as for
the queue routes, with the message `Radarr calendar unavailable` (a non-array upstream
body gives 502).

### Additive image parameters

`GET /api/sonarr/series/:id/episodes` now also sends `includeImages=true`, and
`GET /api/sonarr/calendar` also sends `includeEpisodeImages=true`. Both responses
stay pass-through; episodes simply carry their `images` when the service supports it.
