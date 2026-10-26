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

Settings are saved to `config.json` (gitignored). You can re-open them any time from **Settings**: the gear in the header on phones, or the navigation on wider screens.

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
> - Another mDNS responder on the host (Avahi, or a NAS's built-in discovery
>   service) may already own UDP **5353** without sharing it. ArrView then logs
>   one `Bonjour: bind EADDRINUSE 0.0.0.0:5353 — …` line, shows a notice on the
>   Settings page and keeps running, but iOS auto-discovery is unavailable:
>   enter `http://<host>:7777` in the app by hand. To get discovery back, give
>   the container its own LAN address (a Docker macvlan or ipvlan network) or
>   turn the host's responder off, then restart the container.
> - If you can't use host networking, the app still works — just choose
>   **Connect Directly** in setup and enter `http://<host>:7777` manually.

### Webhooks: instant updates (optional)

Sonarr and Radarr can tell ArrView the moment something changes, so the web
dashboard and the iOS app (in ArrView Server mode) refresh at once instead of at
the next timed refresh, which is up to a minute later. Without webhooks
everything still works, just a little later. The iOS app's Connect Directly mode
never uses them.

**Settings → Webhooks** appears once Sonarr or Radarr is saved. It holds:

- **ArrView address for Sonarr and Radarr**: the address those two use to reach
  ArrView, such as `http://<host>:7777`. It has to work from where Sonarr and
  Radarr run, which can differ from the address in your browser: use the IP
  address of the machine that runs ArrView, not a name ending in `.local`
  (containers often cannot look those up). Leave it empty to use the address of
  the page you have open. Press **Save** to keep it; it is stored in
  `config.json` as `"webhooks": { "baseUrl": "http://192.0.2.10:7777" }`.
- The two webhook URLs built from it, `<address>/api/webhooks/sonarr` and
  `<address>/api/webhooks/radarr`, each with a **Copy** button.
- **Last event received**: for Sonarr and for Radarr, the last event that
  reached ArrView and how long ago, such as `Download (file import), 3 hours ago`,
  and separately the last test message. It refreshes every few seconds while
  Settings is open and straight away when you come back to the tab, so you can
  press Test in Sonarr and watch `Test message received less than a minute ago`
  appear. It lives in memory, so it starts empty (`No event since ArrView started
  2 days ago`) whenever the container restarts, and it only shows that a message
  arrived, not who sent it.
- Step-by-step setup for each app and a troubleshooting list, with the same
  content as below.

In Sonarr and Radarr, open **Settings → Connect**, select **+** and choose
**Webhook**:

| Field | Value |
|---|---|
| Name | `ArrView` |
| Notification Triggers | Sonarr: On File Import, On File Upgrade, On Rename, On Series Add, On Series Delete, On Episode File Delete. Radarr: On File Import, On File Upgrade, On Rename, On Movie Added, On Movie Delete, On Movie File Delete. Older versions call the first two On Download and On Upgrade. Leave the others off: health and update events do not change what ArrView shows. |
| Webhook URL | The URL from Settings |
| Method | `POST` (ArrView only accepts POST) |
| Username, Password, Headers | Leave empty; ArrView does not use them |

Select **Test**, then **Save**. A green check on Test means ArrView answered, and
the message appears under **Last event received**. ArrView changes no page for
the test message, so Test checks the address, not the triggers. Each real event
shows under Last event received, adds a line such as
`[Sonarr webhook] Download — series: Name` to ArrView's log
(`docker logs arrview`), and refreshes the pages that are open. If Last event
received stays at `No event` while things change in Sonarr or Radarr, the events
never arrive: check the triggers and the address.

To check ArrView on its own, send an event by hand from any computer that can
reach it (no Sonarr or Radarr involved):

```bash
curl -X POST -H "Content-Type: application/json" \
  -d '{"eventType":"Download","series":{"title":"ArrView test"}}' \
  "http://<host>:7777/api/webhooks/sonarr"
```

`GET /api/webhooks/last` is what Settings reads. It answers with the seconds
since ArrView started and, for each service, the last `event` and the last
`test`, each as `{ "eventType": "Download", "ageSeconds": 125 }` or `null`:

```json
{ "uptimeSeconds": 4321,
  "sonarr": { "event": { "eventType": "Download", "ageSeconds": 125 }, "test": null },
  "radarr": { "event": null, "test": null } }
```

Only event types made of plain letters (up to 40) are kept, whatever is posted.
Ages are counted by the server, so a browser clock that disagrees with it never
shows a wrong time. Nothing is written to disk.

If Test fails in Sonarr or Radarr, the address cannot be reached from where it
runs: use the machine's IP address, remember that `localhost` inside a container
is the container itself, and check the firewall. If ArrView sits behind an HTTPS
proxy whose certificate Sonarr or Radarr does not trust, use ArrView's plain
`http` address for the webhook.

ArrView does not check who calls a webhook, so anyone who can reach its address
can make it refresh. This stays true when the password login is on: the two
receivers, `POST /api/webhooks/sonarr` and `/radarr`, are the only data routes that
stay open, so Sonarr and Radarr keep working without edits (`GET /api/webhooks/last`
needs sign-in). Keep ArrView off the public internet unless something in front of
it asks for a login.

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
| `ARRVIEW_PASSWORD` | Turns the password login on with this password, for example `<your-password>`. See [Password login (optional)](#password-login-optional). |
| `ARRVIEW_PASSWORD_FILE` | Path inside the container to a file holding the password, for example `/run/secrets/arrview_password`. Set this or `ARRVIEW_PASSWORD`, not both. |
| `ARRVIEW_AUTH` | `off` turns the login off whatever else is set (the recovery switch). Any other value is ignored. |
| `ARRVIEW_TRUSTED_PROXIES` | Comma-separated proxy addresses or ranges whose `X-Forwarded-For` and `X-Forwarded-Proto` are believed, for example `192.0.2.10, 198.51.100.0/24, 2001:db8::/32`. |

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
you must re-enter its key. ArrView has an optional password login, off by default;
see [Password login (optional)](#password-login-optional).

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

### Password login (optional)

ArrView can ask for a password. It is **off by default**: with no password set
nothing changes anywhere.

> **The ArrView iOS and tvOS apps cannot sign in yet.** Turning the login on makes
> them fail (cleanly, with a 401) until an app update adds it. Webhooks from
> Sonarr and Radarr keep working. Do not turn the login on if you rely on those
> apps.

**What it protects.** With a password set, one gate in front of every `/api`
route answers `401` to anyone who is not signed in. Reads need sign-in too. What
stays open: the app shell (so the Sign in screen can load), `GET /api/health`,
`GET /api/arrview/identify`, `GET /api/auth/status`, the sign-in routes
(`/api/auth/login`, `/logout`, `/token`) and the two webhook receivers
(`POST /api/webhooks/sonarr` and `/radarr`). `GET /api/webhooks/last` is protected.
Nothing else is public. `identify` reports `auth: true` and the `auth` capability.

**Turn it on in Settings.** Open **Settings → Security → Set a password** (8 to
256 characters; composed and decomposed accents count the same, and a password of
only spaces is refused). That browser is signed in at once and stays signed in for
30 days of use. While the login is off, anyone who can reach Settings can set the
first password.

**First run on a new install.** When the data folder has neither `config.json` nor
`auth.json`, no Docker password is set and `ARRVIEW_AUTH` is not `off`, the web app
opens on a setup screen before anything else: protect ArrView with a password, or
continue without one. It says plainly that without a password anyone who can reach
the address can use ArrView, including deleting files. Setting the password signs
that browser in. Continuing without one writes `auth.json` with no password, so the
screen never comes back; Settings can set a password later. Installs that have a
`config.json` never see it. An install that keeps every service in Docker variables
and has no `config.json` shows it once after upgrading; Continue without a password
dismisses it for good. **On a brand-new install that is
reachable from outside, the first visitor could set the password.** The Docker
password, `ARRVIEW_AUTH=off` or removing `auth.json` recover it (see Recovery).
The screen makes nothing else public: `GET /api/auth/status` only reports whether
setup is pending.

**Or from Docker.** Set one of these (never both):

| Variable | Value |
|---|---|
| `ARRVIEW_PASSWORD` | `<your-password>`. Visible in `docker inspect`; prefer the file form. Never trimmed. |
| `ARRVIEW_PASSWORD_FILE` | `/run/secrets/arrview_password`, bind-mounted from `./secrets/arrview_password`. One trailing newline is removed; nothing else is trimmed. |
| `ARRVIEW_AUTH` | `off` turns the login off whatever else is set. Any other value is ignored (logged without printing it). |
| `ARRVIEW_TRUSTED_PROXIES` | For example `192.0.2.10, 198.51.100.0/24, 2001:db8::/32`. See below. |

- A Docker password wins: the password is read-only in Settings, a password
  saved in Settings no longer works, and changing it means editing the compose
  file or secret file and recreating the container with `docker compose up -d`.
  No image rebuild is needed.
- A changed value signs everyone out and removes every app key. An unchanged
  value across restarts keeps sessions and keys.
- **Memory.** Each password check (sign-in, and checking a Docker password at
  start-up) needs about 128 MiB of memory for a moment. In a container with a tight
  memory limit nobody can sign in, and a Docker password then fails closed (the
  login stays on, nobody gets in). Give the container at least 256 MiB.
- A Docker password setting that is set but invalid (both variables, empty, an
  unreadable file, the wrong length) keeps the login **on** and lets nobody in,
  with a log line naming the variable (never its value). Fix it, or set
  `ARRVIEW_AUTH=off`. This is deliberate: a mistyped secret path must not open
  the server.
- **Removing the Docker password turns the login off.** If both
  `ARRVIEW_PASSWORD` and `ARRVIEW_PASSWORD_FILE` are unset at start and `auth.json`
  holds a password that came from Docker, ArrView deletes that password with every
  session and key, so the login is off, and logs one line saying why. If that
  deletion cannot be written, the login stays on and nobody can sign in. A
  password set in Settings is not affected.
  **If the Docker password variable is accidentally missing when you recreate the
  container (a typo, a lost `.env` file, a secret that did not mount), the login
  turns off and ArrView is open to anyone who can reach it.**
- **Moving from a Docker password to a Settings password.** While a Docker
  password is set, the password controls in Settings are read-only, so you cannot
  set a Settings password first. To switch: restrict access to ArrView outside
  ArrView (firewall, reverse proxy rule or closed port), recreate the container
  without `ARRVIEW_PASSWORD` and `ARRVIEW_PASSWORD_FILE` (the login is off while
  you do this), set the password in Settings, check that the login screen now
  appears, and only then restore access. Or keep managing the password through
  Docker.

**The session cookie.** The browser holds `arrview_session`: a random token,
`HttpOnly`, `SameSite=Lax`, valid for 30 days and renewed as you use ArrView (the
server extends it at most once a day per session). `auth.json` keeps only a
SHA-256 digest of each token, so nothing in the file can be used to sign in. It
carries the `Secure` flag only when the request arrived over HTTPS, directly or
through a trusted proxy. Sessions live on the server (at most 50; the oldest is
dropped): **Sign out** ends only that browser's session, so a copied cookie stops
working at once; **Sign out everywhere** and any password change end every
session and remove every app key. Removing a session or a key also ends its open
event stream. Browsers send
cookies to every port on the same host name, so a second ArrView on another port
of the same host name shares and overwrites the cookie, and other apps on that
host name (Sonarr, Radarr) receive it. Requests from a signed-in browser that
change something must send `X-Requested-With: ArrView`; the web app does this.

**Trusted proxies.** `ARRVIEW_TRUSTED_PROXIES` lists the reverse proxies whose
`X-Forwarded-For` and `X-Forwarded-Proto` ArrView believes: comma-separated IPv4 or
IPv6 addresses or ranges. Unset, nothing is trusted and those headers are ignored.
Any invalid entry (a `/0` range counts) makes the whole list trust nothing, with a
log line. IPv6 entries in the old dotted-tail form (`::192.0.2.1`,
`::192.0.2.1/96`) are refused the same way; write them as `192.0.2.1`. The address
decides the sign-in limit, and `X-Forwarded-Proto: https` from a listed proxy gets
the cookie its `Secure` flag.

> **Behind a reverse proxy, set `ARRVIEW_TRUSTED_PROXIES`.** Without it every
> client reaches ArrView from the proxy's address and shares one sign-in limit, so
> ten wrong passwords from anyone lock everyone out for 15 minutes.

**App keys (apps and scripts).** Make one key for each app or script, so you can
remove one without touching the others. In **Settings → Security → Keys for apps
and scripts** a signed-in browser can make a key (it asks for your current password,
and a wrong one counts toward the sign-in limit; the name is optional, up to 40
characters, "App key" if left empty), see the list (name, created, last used) and
remove one key or all of them. A new key appears once, in a read-only field, with a
**Copy** button; **ArrView stores only a digest, so nothing can show it again.**
If you lose a key, remove it and make another. At most 50 keys. A script can make
one with the password:

```bash
curl -s -X POST -H "Content-Type: application/json" \
  -d '{"password":"<your-password>","name":"Backup script"}' http://arrview.example:7777/api/auth/token
# {"accessKey":"<your-access-key>","id":"<key-id>","name":"Backup script","created":1790000000}
curl -s -H "X-Api-Key: <your-access-key>" http://arrview.example:7777/api/config
```

Send the key as `X-Api-Key` or `Authorization: Bearer`. The "last used" date is
written at most once a day. Copy works in every browser, including Safari over
plain HTTP: if a browser refuses, the key stays selected so it can be copied by
hand.

**Wrong passwords.** Each address may fail 10 times in 15 minutes; then the
server answers `429` with `Retry-After` until the oldest failure ages out. A wrong
password takes at least half a second to answer. The limit is in memory and a
restart clears it. Every failure logs one line, which a fail2ban filter can use
(this regex is **unverified** here):

```
[auth] sign-in failed from <ip> route=login
failregex = \[auth\] sign-in failed from <HOST>
```

**Where it lives.** `auth.json` in the data directory (mode `0600`, written
atomically), never in `config.json`. It holds a scrypt hash of the password and
SHA-256 digests of the session tokens and app keys, and nothing that can be used
to sign in. It is read once at start; editing it by hand needs a restart. A file
from an earlier test build (version 1) keeps its password, drops the old secret and
key, and everyone signs in again. Rolling back to an older image (1.9A4 or
earlier) **opens the server**: those builds ignore the file and have no login.
Upgrading again finds the password intact.

**Recovery.** Lost the password? `ARRVIEW_AUTH=off` alone does not reset it: it
only switches the login off while the variable is set, and the saved password
comes back when you remove the variable. Use one of these two procedures. If
`auth.json` exists but cannot be read or is invalid, the login stays on, nobody
can sign in, and the log points here; either procedure fixes it.

*Replace the password with a Docker one:*

1. Remove `ARRVIEW_AUTH=off` from the container's environment if it is set.
   While it is set, any password variable is ignored.
2. Set exactly one of `ARRVIEW_PASSWORD` or `ARRVIEW_PASSWORD_FILE` to the new
   password (or the path of a file that holds it) and remove the other.
3. Recreate the container. Everyone is signed out and the new password applies.

*Reset to no password and set a new one in Settings:*

1. Stop the container.
2. Remove `auth.json` from the data directory.
3. Remove `ARRVIEW_AUTH=off`, `ARRVIEW_PASSWORD` and `ARRVIEW_PASSWORD_FILE`
   from the container's environment. If a Docker password is still set, the
   start-up recreates the file from it.
4. Start the container. The login is off until you act.
5. Open Settings and set a new password.

Not built yet: signing in from the iOS and tvOS apps, reading without signing in
from the local network, identity headers from a proxy such as Tailscale Serve, and
a Host allow-list. Keep ArrView off the public internet until they exist.

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
certificate without making the app public. **ArrView has an optional password
login, off by default (see [Password login (optional)](#password-login-optional)).
Without a password, anyone who can reach it can change settings.** Keep the front
door LAN- or tailnet-only, or protect it with an access-controlled gateway. Do not
port-forward this container or enable Tailscale Funnel for it yet: the iOS and tvOS
apps cannot sign in, and the local-network and trusted-proxy options are not built.
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
Episode rows/actions wrap, and mobile toasts sit above the bottom bar. The app is
dark only: it ignores the system's light/dark preference, including theme-color and
the offline page.

Update (1.9A1): below 640px the bottom bar has the five content tabs and Settings is
the gear in the top bar; from 640px the navigation is a horizontal bar, and from 1024px
it is a left sidebar with Settings at the bottom.

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
keyboard focus, dark-only rendering and simulated visibility transitions. Physical Safari/
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

## Credits

- [Inter](https://rsms.me/inter/) 4.1, SIL Open Font License 1.1. The variable font is self-hosted from `public/fonts/inter/InterVariable.woff2`; the licence text is [public/fonts/inter/LICENSE.txt](public/fonts/inter/LICENSE.txt).
- [Phosphor Icons](https://phosphoricons.com/) 2.1.1, MIT. A small set of icons is inlined as SVG paths in `src/components/Icon.jsx`; the licence text is [licenses/phosphor-icons-MIT.txt](licenses/phosphor-icons-MIT.txt); a copy ships in the built app at `licenses/phosphor-icons-MIT.txt`.
