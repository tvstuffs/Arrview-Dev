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
