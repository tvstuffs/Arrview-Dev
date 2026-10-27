# ArrView server development changelog

## Unreleased — Optional password login

No version change: the maintainer renames this section when the version is set. `APP_VERSION` and `package.json` are
untouched.

- **An optional password login, off by default.** With no password nothing changes. With one (Settings → Security,
  or the Docker variables `ARRVIEW_PASSWORD` / `ARRVIEW_PASSWORD_FILE`) one gate in front of every `/api` route
  answers `401 {"error":"Authentication required","auth":true}` to anyone not signed in. Public: the app shell,
  `GET /api/health`, `GET /api/arrview/identify`, `GET /api/auth/status`, `POST /api/auth/login`,
  `POST /api/auth/logout`, `POST /api/auth/token` and the two webhook receivers. `GET /api/webhooks/last` is
  protected. A browser signs in with the password and holds a random session token in a 30-day sliding cookie
  (`arrview_session`); the server keeps only the token's SHA-256 digest. Apps and scripts send an app key as
  `X-Api-Key` or `Authorization: Bearer`; each app or script gets its own key, also stored only as a digest.
- **New routes (JSON):**
  - `GET /api/auth/status` → `{required, signedIn, source: "none"|"settings"|"docker", authDisabledByDocker,
    setupPending, passwordMinLength, passwordMaxLength}` (signed-out while required: `{required:true,
    signedIn:false}` plus `unavailable:true` when failing closed).
  - `POST /api/auth/login` `{password}` → `200 {success:true}` + cookie, `401 {error:"Incorrect password"}`, `429`.
  - `POST /api/auth/logout` → `200 {success:true}`; ends only that browser's session.
  - `POST /api/auth/token` `{password, name?}` → `200 {accessKey, id, name, created}`, no cookie; the key is in this
    response only. `409` at 50 keys.
  - `POST /api/auth/password` `{currentPassword?, newPassword}` (cookie session only), `POST /api/auth/password/remove`
    `{currentPassword}`, `POST /api/auth/logout-all`.
  - `GET /api/auth/keys` → `{max, keys:[{id, name, created, lastUsed}]}`, `POST /api/auth/keys` `{currentPassword, name?}`
    (same response as `/token`; `400` without the password, `403` when wrong, counted by the sign-in limit), `POST /api/auth/keys/remove` `{id}`, `POST /api/auth/keys/remove-all` (cookie session
    only). `GET /api/auth/access-key` and `POST /api/auth/access-key/regenerate` are gone: no key can be read back.
  - `POST /api/auth/setup/skip` (first-run choice, only while setup is pending).
- **`GET /api/arrview/identify`** gains `auth` (boolean) and the `'auth'` capability (last in the list).
- **New file and variables.** `auth.json` in the data directory (version 2; mode `0600`, atomic writes; the scrypt
  hash plus session and key digests, nothing usable to sign in; never in `config.json`). Sessions: at most 50, the
  oldest dropped, extended at most once a day. Keys: at most 50, each with a name (40 characters, default "App key"),
  a created date and a last-used date written at most once a day. A version 1 file from an earlier test build keeps
  its password and drops the old secret and key (everyone signs in again; logged). Variables: `ARRVIEW_PASSWORD`,
  `ARRVIEW_PASSWORD_FILE`, `ARRVIEW_AUTH` (`off` is the recovery switch), `ARRVIEW_TRUSTED_PROXIES` (an invalid
  entry, including IPv4-compatible `::192.0.2.1` forms, trusts nothing; a parser error can no longer stop start-up).
  A broken Docker password setting or an unreadable `auth.json` keeps the login on and lets nobody in.
- **Removing a session or a key cuts access at once,** open event streams included. Sign out everywhere and any
  password change remove every session and every key.
- **Removing the Docker password turns the login off.** With `ARRVIEW_PASSWORD` and `ARRVIEW_PASSWORD_FILE` both
  unset at start and a stored password that came from Docker, the password, sessions and keys are deleted and one
  line is logged. A password set in Settings is not affected.
- **First-run screen.** A new install (neither `config.json` nor `auth.json`, no Docker password, `ARRVIEW_AUTH` not
  `off`) opens on a setup screen: protect ArrView with a password or continue without one (it says that without a
  password anyone who can reach the address can use ArrView, including deleting files). Same screen in Modern and
  Classic. On a brand-new install reachable from outside, the first visitor could set the password; the Docker
  password, `ARRVIEW_AUTH=off` or removing `auth.json` recover it. An install that keeps every service in Docker
  variables and has no `config.json` shows the screen once after upgrading; Continue without a password dismisses it
  for good.
- **Web.** The first-run screen, a Sign in screen before any data loads, a Security card in Settings (both layouts)
  with a key list (make, remove one, remove all), and one `apiFetch` for every request (adds `X-Requested-With:
  ArrView`, announces a mid-session 401). A new key is shown once in a read-only field and Copy writes it in the same
  click (Clipboard API on secure pages, otherwise the copy command on the selected field, via `src/clipboard.js`);
  if a browser refuses, the key stays selected with a hint to copy it by hand.
- **Read before turning it on.** Behind a reverse proxy without `ARRVIEW_TRUSTED_PROXIES` every client shares one
  sign-in limit, so ten wrong passwords from anyone lock everyone out for 15 minutes. Each password check needs about
  128 MiB of memory for a moment, so a container with a tight memory limit cannot sign anyone in and a Docker password
  then fails closed. Rolling back to 1.9A4 or earlier opens the server.
- **The iOS and tvOS apps cannot sign in yet:** with the login on they fail with a 401 until an app update.
- **Not verified by the factory:** brute-force behaviour, proxies other than the maintainer's, any app sign-in, the
  fail2ban regex, and a run in real Chromium (CI).
- **Human test plan:**
  1. Upgrade an existing install (populated `config.json`, no `auth.json`): nothing changes; the shipped iOS app still
     works; webhooks still arrive; `identify` says `auth: false`.
  2. Set a password in Settings: that browser stays signed in; a private window gets Sign in; try a wrong password and
     the limit.
  3. Reload, relaunch the Home Screen app, restart the container: still signed in.
  4. Sign out; Sign out everywhere also signs out a second browser. Copy the cookie of a browser before signing it out:
     it no longer works. With two browsers signed in, Sign out in one leaves the other signed in.
  4a. Keys: in Settings make a key named "Script": the form asks for your current password. Leave it empty or type a
     wrong one: no key is made, the field is cleared, and ten wrong ones block the address for 15 minutes. With the
     right one the key appears in a read-only field and is not shown again after Done
     or a reload. Press Copy and paste somewhere: the same text. Check the list (name, created, last used) and make a
     second key. Remove one: only that one stops (curl returns 401 at once, also on an open `/api/events`). Remove all.
     Sign out everywhere and a password change also remove every key.
  4b. Copy in Safari: on a Mac and on an iPhone, open ArrView over plain HTTP (`http://arrview.example:7777`), make a
     key and press Copy, then paste it: it must paste. If it does not, the key is left selected with the hint to copy
     it by hand. Repeat over HTTPS and in one other browser.
  4c. New install: start with an empty data folder (no `config.json`, no `auth.json`, no Docker password). The first
     screen offers a password or "Continue without a password" with the delete-files warning, in Modern and in
     Classic. Choosing a password signs that browser in; choosing none never shows the screen again after a restart;
     Settings can still set a password. An install with a `config.json` never shows it, nor does one with
     `ARRVIEW_PASSWORD` or `ARRVIEW_AUTH=off`. An install with every service in Docker variables and no `config.json`
     shows it once after upgrading; Continue without a password dismisses it for good.
  4d. With a Docker password on, remove `ARRVIEW_PASSWORD` and recreate the container: the login is off (one log
     line says why). A password set in Settings survives the same step.
  5. With the login on, the iOS app fails cleanly and keeps its server; Test from Sonarr and Radarr still shows under
     "Last event received".
  6. Docker: `ARRVIEW_PASSWORD` and `_FILE` with a recreate; the card is read-only; a changed value signs everyone
     out; `ARRVIEW_AUTH=off`.
  7. Behind an HTTPS proxy with `ARRVIEW_TRUSTED_PROXIES` set the cookie is `Secure`; without it, it is not, and
     sign-in still works.
  8. Roll back to the previous image: the server is open again, `auth.json` is ignored and Settings saves still work;
     upgrade again and the password is still there.
  9. curl: a protected route without credentials (401), with the access key (200), a cookie POST without the
     `X-Requested-With` header (403).

## 1.9A4 (unreleased) — Webhooks in Settings

- **Version 1.9A4.** Adds a Webhooks card to the Settings page. Server and web client only: one new read-only
  route (`GET /api/webhooks/last`), no `capabilities` change, and nothing changes in the iOS or tvOS apps.
  - *Human check:* Settings shows "ArrView v1.9A4", and `GET /api/health` and `GET /api/arrview/identify`
    report `1.9A4`. Then run the test plan below.
- **Settings now has a Webhooks card** (both layouts), between the service cards and "Add to Home Screen". It
  appears once Sonarr or Radarr is saved, and only lists the ones that are. It holds:
  - **ArrView address for Sonarr and Radarr.** The address those two use to reach ArrView, which can differ from
    the one in your browser. Empty means this page's own address. A page opened as `localhost` says that Sonarr and
    Radarr elsewhere cannot use it.
  - **The webhook URLs** (`<address>/api/webhooks/sonarr` and `/radarr`), read-only, each with a Copy button. Copy
    uses the Clipboard API on HTTPS or `localhost` and selects the field and uses the older copy command on a
    plain-`http` LAN address, where browsers do not offer the API.
  - **Last event received.** One line per service, such as "Sonarr: Download (file import), 3 hours ago. Test
    message received less than a minute ago." or "Radarr: No event since ArrView started 2 days ago." It
    refreshes every five seconds while Settings is in view, at once when the tab comes back into view, and not at
    all when no Sonarr or Radarr is saved or Settings is closed. It says what it cannot tell: that a message
    arrived, not who sent it.
  - **Three guides**, collapsed: set up the webhook in Sonarr, in Radarr, and "If it does not work". They give
    the exact URL, the trigger names, `POST`, what a green Test means and where the message then shows up, the
    log line a real event writes, a `curl` command that posts an event by hand, and the limits (no
    authentication on webhook calls; the iOS app uses them in ArrView Server mode only).
- **What "last event" means.** `GET /api/webhooks/last` answers
  `{ uptimeSeconds, sonarr: { event, test }, radarr: { event, test } }`, where `event` and `test` are
  `{ eventType, ageSeconds }` or `null`.
  - **Kept in memory only**, so a restart starts it empty (hence "since ArrView started"). Nothing is written to
    disk and nothing is added to `config.json`.
  - **The Test message is kept apart from the event**, so pressing Test in Sonarr never hides when a real event
    last arrived. A Test message is noted but still changes no page: the live refresh of open pages is unchanged
    (real events only).
  - **Only an event type made of plain letters (1 to 40) is kept.** Webhook calls are not authenticated, so what
    Settings shows is limited to what no one can abuse: anything else is answered 200 as before and not recorded,
    and the page shows the type as text only.
  - **The server counts the ages**, so a browser clock that disagrees with the server's never shows a wrong time;
    the page adds the seconds since the answer arrived, so the text stays right between polls.
  - **A server without the route** (an older build) answers 404: Settings says "This version of ArrView does not
    report received events." and stops asking. A poll that fails keeps the last answer on the page.
  - No `capabilities` entry: only the web page uses it. It is an ordinary `/api` route, so it is answered with
    `Cache-Control: no-store` like the others and the service worker does not cache it.
- **Where the address is stored.** `config.json`, as `"webhooks": { "baseUrl": "http://host:7777" }`.
  - `GET /api/config` returns it. `POST /api/config` accepts `webhooks: { baseUrl }`: left out keeps the stored
    value (a client that does not know the field cannot erase it), an empty string or `{}` clears it.
  - The web client sends it only when it changed, so saving anything else posts exactly what it did before.
  - It is not a Docker environment setting, and no route reads it: it only builds the URLs shown in Settings.
- **What an address may be.** `http` or `https`, a plain host name or IP address (letters, digits, `.`, `_`, `-`,
  or an IPv6 address in brackets), an optional port and an optional plain path. No spaces, credentials, query or
  fragment. A missing scheme is read as `http`, trailing slashes are dropped, and a pasted full webhook URL is cut
  back to the address. These rules are written out on both sides on purpose:
  - **Browsers and Node disagree about URLs.** Edge accepted `http://bad host` and encoded the space, where Node
    refuses it; found by the browser test, not by the unit tests.
  - **The address is printed inside a shell command** that Settings shows for copying, and this API has no login,
    so only characters that mean nothing to a shell are allowed.
- **What the guides say was checked** against the `develop` branches of Sonarr and Radarr on 2026-10-23: the
  Webhook connection's fields (URL, Method defaulting to POST, Username, Password, Headers), the trigger labels
  (On File Import, On File Upgrade, On Rename, On Series Add/Delete, On Episode File Delete; On Movie Added/Delete,
  On Movie File Delete), the older names for the first two, and the payloads (`eventType`, `series.id`, `episodes`,
  `movie.id`). The live version of the apps was not available, so the wording is the current source's.
- **Compatibility and rollback.**
  - Old files load unchanged: no `webhooks` key means "this page's address".
  - The previous build (`dev` at `1eb4790`, run on 2026-10-23) starts and serves with the key present and ignores
    it. Its own Save rewrites the file without the key, so a saved address is lost after a rollback plus a Save,
    with no error. A Home Screen app that has not updated yet and tries to change the address against that older
    server gets `400 Unknown config key: webhooks`. That build has no `/api/webhooks/last`: a page from this build
    shows the "does not report" line and the rest of the card works.
- **Tests.**
  - Server `tests/webhook-address.test.js` (5): round trip, normalising, refusals, keep and clear, Docker-managed
    services. Server `tests/webhook-activity.test.js` (7): what is kept per service, the Test message apart, the
    character rule, bodies that are not events, ageing, and that open pages are still told about real events and
    still not about Test messages. Browser `tests/web/webhook-settings.test.jsx` (24): the card, the address rules
    (the same table as the server's), Copy on a secure and a plain page, the Settings page, both layouts. Browser
    `tests/web/webhook-activity.test.jsx` (18): reading the answer, the wording and ages, every state of the
    section, and the polling (every five seconds, kept on failure, stopped on 404, asked only when needed).
  - Browser `tests/e2e/webhooks.spec.cjs` (10): posts to the URLs Settings shows and checks that the open Shows and
    Movies pages refetch while a Test message does nothing; that Settings lists each event, the Test message
    beside it and each service on its own line, including a type that must never be shown; the 404 case; saves an
    address and reads it from a second browser; flags an address that is not one; fits at 305, 320, 390, 834 and
    1280 px with the longest list lines.
  - Breaking the feature in 31 different ways (each address rule on each side, the card, the fallback, what is
    recorded and where, the polling) fails the matching tests.
- **Test fix, no code change.** `tests/e2e/upcoming.spec.cjs`, "Classic: an episode row opens the Shows tab and a
  movie row opens the Movies tab", failed in CI on the first push of this build (twice, 140 of 141 passed, so the
  `dev` image was not rebuilt). It clicked the "Upcoming" tab button by name alone, but once the Shows page has
  loaded the page has an "Upcoming" button of its own, so the locator matched two elements and failed whenever the
  page loaded before the click was resolved. The test had been in CI only once before (it arrived with 1.9A3).
  Nothing in this build touches that flow. Shown by pausing before the click: the old locator failed 5 of 5, the
  scoped one passes with and without the pause, and 40 of 40 repeated runs pass. The click is now scoped to the
  tab bar. It was the only test that matched a tab name that also exists as a button in the page.
- **Test plan** (items marked *agent-verified* were run by the agent; the rest is yours):
  1. *Settings.* Open Settings in Modern and in Classic. A Webhooks card sits between the services and "Add to Home
     Screen", with the Sonarr and Radarr URLs. With the field empty the URLs use the address in your browser bar.
     *Agent-verified* in Edge (Chromium 154) at 1280, 390 and 320 px in both layouts, against a real server.
  2. *Address.* Type `<ArrView machine's IP>:7777`. Both URLs change as you type. Press **Save**, open Settings in
     another browser: the address is there. Clear it, Save: back to this page's address. *Agent-verified* with a
     second browser context and the file on disk (keys and `sabPath` of the three services unchanged).
  3. *Copy.* On `http://localhost:7777` and on `http://<LAN IP>:7777`, press Copy and paste somewhere. You get the
     URL both times, and "Sonarr webhook URL copied." appears. *Agent-verified* by pasting with the keyboard in the
     same tab and another tab; not on Safari, Firefox or a phone.
  4. *Sonarr and Radarr.* Follow the guides in the card, in each app: Settings, Connect, +, Webhook, tick the
     triggers, paste the URL, POST, **Test** (green check), **Save**. Then import, rename or delete something and
     watch an open Shows or Movies page change within a second or two. `docker logs arrview` shows
     `[Sonarr webhook] <event> — series: <name>`. **Not verified by the agent: no real Sonarr or Radarr was
     available.** *Agent-verified* with payloads shaped like theirs.
  5. *Last event received.* With Settings open, press Test in Sonarr: within about five seconds the Sonarr line
     says "Test message received less than a minute ago." and its event part is unchanged. Import, rename or
     delete something: the line says what happened, such as "Download (file import), less than a minute ago.",
     and keeps the Test sentence. Do the same in Radarr. Restart the container: both lines say "No event since
     ArrView started less than a minute ago." *Agent-verified* in Edge (Chromium 154) against a real server in a
     Linux VM, with payloads shaped like theirs: the Test message appeared 5.0 s after it was sent, the page
     asked every 5 s while Settings was open and not at all on another page, and a restart emptied the lines and
     the page caught up on its own. **Not verified: real Sonarr and Radarr messages.**
  6. *By hand.* Run the `curl` command from "If it does not work" from another computer: `200`, one log line, the
     event under Last event received, and open pages refresh. *Agent-verified*, running the command text exactly
     as the page shows it.
  7. *iOS.* With a webhook set up and the iOS app in ArrView Server mode, an import in Sonarr or Radarr refreshes
     its lists at once; in Connect Directly mode it does not. **Not verified**; needs a physical device (the
     Simulator does not implement local network privacy, Apple TN3179).
  8. *Upgrade path.* No change to anything in use before: the shipped iOS app and the existing keys are untouched.
     Install the previous build, configure, upgrade in place: the settings and the connection survive.
     *Agent-verified* for the file (an old-style `config.json` loads, and Save changes only the new key) and for
     the rollback described above; not with a shipped iOS build.
- **Not verified:** a real Sonarr or Radarr (the apps' own wording, Test button and message bodies); Safari,
  Firefox and a screen reader (the card has labels and descriptions; only Edge was run); the iOS app; behind a
  reverse proxy (whether one buffers the live-update stream does not matter to the list, which polls); CI's own
  Chromium run of the browser tests, which ran here on Edge.

## 1.9A3 (unreleased) — Web redesign: art-led layout, Upcoming, Downloads and Add flow

- **Version 1.9A3.** Test build of the web redesign, on top of 1.9A2. It merges factory jobs 003–007
  into `main`:
  - the art-led layout and the Classic/Modern switch;
  - Upcoming;
  - Downloads;
  - the Add flow;
  - the NZBHydra connectivity-check fix.

  Every job passed its reviews and the full test suites before it was merged.
  - *Human check:* Settings shows "ArrView v1.9A3", and `GET /api/health` and
    `GET /api/arrview/identify` report `1.9A3`. Then run the job test plans below.
- **Fix: quality tiers were missing in the Add sheet.** This was found in the first 1.9A3 container,
  before anyone tested it. The Quality Profile picker showed no tier ("UHD · 4K", "HD · 1080p", ...)
  for any real profile.
  - **Cause:** Sonarr and Radarr send every single quality with an empty `items` list, and the tier code
    treated that as a group and skipped it.
  - **Fix:** only a non-empty list now counts as a group.
  - **Tests:** the unit tests and the e2e fixture now use the real shape.
  - *Human check:* open Add Movie and Add Show, search, and pick a result. The picker shows each profile
    with its tier (for example "Ultra-HD · UHD · 4K") and the Default tag.
- **Fix: a failed Bonjour bind no longer restarts the container in a loop.** Found when the server moved
  to a host whose own mDNS responder (TrueNAS's built-in discovery service) owns UDP port 5353 and does
  not share it. The container exited about a second after every start, and the restart policy looped it.
  - **Cause:** with host networking, `bonjour-service` cannot bind 5353, and `multicast-dns` reports that as
    an asynchronous `error` event (`Unhandled 'error' event ... bind EADDRINUSE 0.0.0.0:5353`). Nothing
    listened for it, and the `try`/`catch` around `publish()` cannot catch an event. The library's default
    `errorCallback` also rethrows, so a failed send could end the process the same way.
  - **Fix (`server.js`, the Bonjour block only):** an `error` listener on the library's mDNS instance and an
    `errorCallback` now log instead of throwing, each distinct message once (the library reports one failed
    bind twice and retries it). A startup failure other than a missing package is reported as such, not as
    "bonjour-service not installed". Where Bonjour works, the advertisement and the
    `Bonjour: advertising ...` log line are unchanged.
  - **On a host that blocks the port:** the server runs normally and logs one
    `Bonjour: bind EADDRINUSE 0.0.0.0:5353 — another mDNS responder on this host ... so iOS auto-discovery
    is unavailable` line. Only auto-discovery is lost: the iOS app needs the address typed in. The README
    now says so and names the two ways to get discovery back.
  - **Tests:** `tests/bonjour-failure.test.js`, 4 tests. The main one holds a UDP port exclusively and lets
    the real `bonjour-service` try to bind it, so the kernel raises a real `EADDRINUSE`; it fails on the old
    code with the uncaught error above. `tests/helpers/server-harness.js` gained two options
    (`runListenCallback`, `modules`), because no earlier test ran the `app.listen` callback where Bonjour
    starts.
  - **Test plan** (items marked *agent-verified* were run by the agent; the rest is yours):
    1. *Blocked port.* Start the new container with `network_mode: host` and a restart policy on a host where
       something else holds UDP 5353 without sharing it. Any Linux host can reproduce that:
       `docker run -d --network host node:20-alpine node -e "require('dgram').createSocket('udp4').bind(5353); setInterval(() => {}, 1e6)"`.
       Expect in `docker logs` the startup banner, `Bonjour: advertising ...`, then one
       `Bonjour: bind EADDRINUSE 0.0.0.0:5353 — ...` line. `docker inspect -f '{{.RestartCount}}'` stays `0`
       for several minutes, the web UI loads and `GET /api/health` returns `200`.
       *Agent-verified* in a Linux VM (Node 20.20.2, host networking, `--restart unless-stopped`): the old
       code restarted 7 times in 10 seconds with exit code 1; the new code stayed up with 0 restarts.
    2. *Free port.* Where nothing holds 5353, the log has `Bonjour: advertising ...` and no other Bonjour
       line, and the process owns UDP 5353. *Agent-verified* in the same VM, including a real mDNS query for
       `_arrview._tcp.local` that returned the PTR, SRV, TXT and A records. *You:* on a physical iPhone, the
       server appears in setup without typing an address. The Simulator cannot show this, because it does
       not implement local network privacy (Apple TN3179).
    3. *Both connection modes.* ArrView Server (proxy) mode against a blocked-port host works once the
       address is typed in. Direct mode never contacts the ArrView server, so this change cannot affect it.
    4. *Upgrade path.* No storage change, so not applicable.
  - **Not verified:** the real TrueNAS 27 host and its real discovery daemon (an equivalent exclusive holder
    stood in for it); discovery from an iPhone while another responder is live on the host; the Playwright
    e2e job (CI runs it, and the web client is untouched); `bonjour-service` 1.4.4 (its source was read and
    has the same wiring, but it was not run; the lockfile pins 1.4.1).
- **Settings now says when Bonjour could not start.** Follows the fix above. A server that cannot start
  Bonjour keeps working, and now also says so on the Settings page (both layouts), not only in its log.
  - **Server:** `GET /api/arrview/identify` gains a `bonjour` object, `{ "state": ..., "reason": ... }`.
    `state` is `off` (not started), `starting`, `advertising` or `unavailable`. `reason` appears only with
    `unavailable`: `port-in-use`, `permission-denied`, `not-installed` or `start-failed`. These are codes,
    not error text. The two bind-failure errors (`EADDRINUSE`, `EACCES`) and a failed startup set them; any
    other error is logged and changes nothing. `advertising` is set when `multicast-dns` reports that its
    socket is bound (`ready`) or has joined the multicast group (`networkInterface`). The capabilities list
    and `GET /api/health` are unchanged, so health stays independent of Bonjour.
  - **Retries:** by the library's code, it binds the port again each time it announces itself (about 1 s,
    4 s, 13 s, 40 s, 2 min, 6 min, 18 min and 55 min after start, then never). If the port frees up before
    one of those, Bonjour starts by itself and the state returns to `advertising`; otherwise restart the
    container.
  - **Web:** a flat amber notice between the Layout choice and the Services list, shown only for
    `unavailable`. It names the cause, says ArrView works normally and points to "Or enter the address
    manually" in the iOS app, with this page's address when the page is open from another device (not
    `localhost`). New component `src/components/DiscoveryNotice.jsx`.
  - **Compatibility:** the iOS and tvOS apps decode identify into a struct that ignores keys it does not
    declare (it already ignores `capabilities`), so the extra key is safe. An older server sends no
    `bonjour` key and shows no notice. It is not a capability: the key's presence is the signal.
  - **Tests:** server 112/112 (Mac with Node 24.19.0, and Linux with Node 20.20.2), web 379/379.
    `tests/bonjour-failure.test.js` gained two tests and more assertions; one uses the real library and a real
    socket to show that a blocked Bonjour recovers once the port is freed. `tests/web/discovery-notice.test.jsx`
    has 14. The identify test in `tests/env-config.test.js` now expects the new key. Breaking the feature in
    three ways (no notice rendered, no `bonjour` key, no recovery events) fails the matching tests.
  - **Test plan** (items marked *agent-verified* were run by the agent; the rest is yours):
    1. *Blocked port.* Start the server container with `network_mode: host` where UDP 5353 is held (the
       one-liner in the Bonjour fix's test plan above). Open Settings in Modern and in Classic: an amber notice
       sits between Layout and Services and names UDP 5353. From another device it ends with this server's
       address, for example `http://<host>:7777`; opened on the server itself it does not. At 320 px nothing
       overflows. `GET /api/arrview/identify` has `"bonjour":{"state":"unavailable","reason":"port-in-use"}`.
       *Agent-verified:* real servers in a Linux VM (a second container holding 5353 in the same network
       namespace), Microsoft Edge (Chromium 154) at 1280 and 390 px in both layouts and at 320 px in Modern,
       and through a LAN address.
    2. *Free port.* No notice, and `identify` has `"bonjour":{"state":"advertising"}`. *Agent-verified* in the
       same VM.
    3. *Both connection modes.* The iOS app in ArrView Server (proxy) mode still connects, because it reads
       identify. Direct mode never contacts the ArrView server. Check on a physical iPhone (the Simulator does
       not implement local network privacy, Apple TN3179).
    4. *Upgrade path.* No storage change, so not applicable.
  - **Not verified:** the iOS app and ArrViewCore reading the new key (the Swift struct was read, not run);
    the real TrueNAS host; Safari, Firefox and a screen reader (the notice has `role="status"`; only Edge was
    run); the Playwright e2e suite (CI runs it, and its fixture never produces the unavailable state); a
    server started with an `ADVERTISE_IP` that is not an address of the host (the multicast join then fails,
    which is not reported as a problem).

### NZBHydra connectivity check (factory job 007)

- **Server only.** No web, dependency, service-worker or `APP_VERSION` change.
  - **What was wrong.** `GET /api/nzbhydra/ping` reported a working NZBHydra2 as unavailable
    (503), so the "Can't reach NZBHydra" banner (Modern) and the offline pill (Classic) showed
    for a healthy server. The check required a `caps` key, but NZBHydra2 answers
    `t=caps&o=json` without one (its top-level keys are `server`, `limits`, `registration`,
    `searching`, `categories`).
  - **What is accepted now.** A JSON object with no `error` key and either a `caps` object or
    at least one object under `server`, `searching` or `categories`.
  - **Still rejected (503, same fixed body).** An HTML login page at HTTP 200, a non-object
    body (array, string, `null`), any body with an `error` key, a redirect (not followed) and
    a timeout (still 10 seconds). The 503 body never contains the upstream address or key.
  - **Unchanged.** Sonarr, Radarr and SABnzbd pings, `GET /api/nzbhydra/status`, the 404 for an
    unknown service and the 503 "Service not configured".
  - **Released servers.** Servers back to 1.09 share the false result; the fix reaches people
    only when they run a server build containing it.
- **Test plan** (not verified by an agent):
  1. With a working NZBHydra2 configured, check both layouts. Modern: no "Can't reach
     NZBHydra" banner. Classic: the NZBHydra pill shows connected.
  2. Set a wrong NZBHydra URL in Settings. The banner or pill reports it within one status
     poll. Restore the URL afterwards.
  3. In the iOS app, if it shows NZBHydra's status from the server, it shows connected.

### Add Show / Add Movie (factory job 006)

- **Web client only.** No server, dependency, service-worker or `APP_VERSION` change. One
  rebuilt Add sheet serves both layouts (Modern and Classic).
  - **Default quality profile.** The profile that most of your library already uses is
    pre-selected (ties go to the profile listed first; an empty library gives the first
    profile). The root folder is pre-selected the same way. Both can be changed for each
    add; nothing is remembered between adds, because Sonarr and Radarr save the pick on the
    item. The profile picker says "Used by N of your M shows" (movies for Radarr) for the
    profile currently shown, and tags the library default "Default".
  - **Named tiers.** Each profile shows a tier worked out from the qualities it allows
    ("HD · 1080p", "HD · 720p–1080p", "UHD · 4K", "SD to 4K" and so on). A profile with
    nothing derivable, or the SD-to-720p range, shows its name only. Root folders show their
    free space ("2.1 TB free").
  - **New sheet.** Search field, a row of result posters (the first result not already in
    your library is selected for you; selecting never adds anything), the selected result's
    poster, meta line and three-line overview, the two pickers (custom listboxes with full
    keyboard support: arrows, Home, End, Enter, Space, Escape, Tab), the Monitored and search
    switches, and a footer with Cancel and "Add Show" / "Add Movie" that always stays on
    screen. On phones it is a bottom sheet with a grabber and the footer respects the
    bottom safe area. The dialog title and button changed from "Add TV Show" to "Add Show".
  - **Focus fix.** The search field takes keyboard focus as the sheet opens. `Sheet` gained
    two optional props (`footer`, `initialFocus`); other sheets are unchanged.
  - **Human test plan (not verified by an agent).** Open Add Show in both layouts and
    confirm the search field is focused. Confirm the pre-selected profile carries "Default"
    and the "Used by N of your M shows" text matches your library. Check the tier labels of
    your real profiles (especially Remux and "Any") and the free space of each root folder.
    Pick another profile and folder, add a show, and confirm in Sonarr that it kept both;
    repeat for a movie in Radarr, then delete the test items. At phone width open the quality
    list and confirm Cancel and Add never leave the screen. On a real iPhone check the
    bottom sheet, grabber, safe area and the soft keyboard. With VoiceOver or a keyboard, open
    a picker, move through it, and confirm Escape closes the list but not the sheet in
    Safari and Firefox as well as Chrome.

### Downloads (factory job 005)

- **Web client only.** No server, dependency, service-worker or version change; Classic
  Downloads is untouched.
  - **Downloads shown as shows and movies (Modern).** A SABnzbd queue item is matched to
    Sonarr or Radarr exactly (`nzo_id` equals the record's `downloadId`) through
    `GET /api/sonarr/queue` and `GET /api/radarr/queue`, so the page leads with the real
    episode or movie, its artwork, the quality line ("4K · Dolby Vision · HDR · Atmos"),
    a progress bar, the size and the time left. A season pack reads as one item
    ("S3 · Episodes 1–8"). History is matched best-effort by parsing the release name
    against the Sonarr and Radarr libraries.
  - **Unmatched downloads** (manual NZBs from Search, music, software, a show that is not
    in Sonarr) are still listed, with a category glyph tile, a tidied name, the exact
    release name and, for a TV or movie name, a muted "Not in Sonarr" / "Not in Radarr".
    They never borrow artwork.
  - **Idle state.** With an empty queue the page leads with the last finished download
    that has artwork ("Downloaded 25 min ago"), says nothing is downloading and shows
    "Coming up" (up to three items from Upcoming, with a See all link).
  - **Top-bar pill** (640 px and wider): a progress ring and the speed while something is
    downloading. **Live status elsewhere:** "Downloading" with a thin bar on show-page
    episodes, and "Downloading · 64%" / "Paused · 12%" with a bar on movie tiles, rows and
    the movie page.
  - **One shared poller.** SABnzbd is polled only while a visible surface needs it (the
    top bar's pill, the Downloads page, or a show or movie surface); Sonarr and Radarr
    queues only when a surface needs matched data, and a show or movie page whose item is
    not downloading costs one request per change of the queue. Phones away from these
    surfaces make no queue request.
  - New icons: `file`, `package`, `music-notes`, `book-open` (Phosphor regular,
    checksum-verified). Cyan is used only for live download state (`.m-live-*` rules).
  - Test-only: the e2e fixture gains download scenarios (`legacy` keeps today's responses),
    and the Modern deep-link focus test starts on Search because the Downloads page now
    loads the library lists.
- **Human test plan** (placeholders only; use a stack with real SABnzbd, Sonarr and Radarr):
  1. During a real download open `#/downloads` in Modern. Confirm the hero is the right
     episode or movie, the artwork fits, and the quality line matches the release.
  2. Send a manual NZB from Search. Confirm it appears as an unmatched item with a glyph
     tile, a tidied name and the exact release name underneath.
  3. Pause and resume one item, then remove one through the confirm sheet. Confirm the queue
     updates and the toast reads "Item removed from the SABnzbd queue".
  4. Let the queue empty. Confirm the last finished download leads ("Downloaded ..."), the
     empty-queue note shows, and Coming up lists at most three items.
  5. At 640 px and wider confirm the top-bar pill appears only while something downloads and
     links to Downloads; at phone width confirm there is no pill.
  6. Open the show page of a downloading episode and the Movies grid for a downloading
     movie. Confirm the status text and the thin bar.
  7. Grab a whole season. Confirm it reads as one item ("S<n> · Episodes 1–N").
  - Look-checks (only a person can judge): the fanart hero, the poster over its blurred
    copy and the glyph tile on real artwork; cyan versus amber against the artwork; the
    pill at 640 to 700 px; touch feel on a real iPhone; real SABnzbd statuses, `timeleft`
    and `completed` values; that `nzo_id` really equals Sonarr's and Radarr's `downloadId`.

### Upcoming (factory job 004)

- **Web client only.** No server, dependency, service-worker or version change.
  - **Movies in Upcoming.** Radarr digital and physical releases appear next to Sonarr
    episodes (from `GET /api/radarr/calendar`, only when the server reports the
    `radarrCalendar` capability). Cinema dates are never shown. A release is a calendar
    date: its UTC date part is the day, so it never shifts with the time zone. A movie
    whose digital and physical dates fall on the same day appears once, as Digital.
  - **Season drops collapse.** Episodes of one series that air at the same instant become
    one entry ("S3 · Episodes 1–8", "S3 · 3 episodes", or "S2, S3 · 9 episodes" across
    seasons). Always on, in both layouts.
  - **Modern: filter chips and views.** All / TV / Movies chips (shown when both Sonarr and
    Radarr are available) and a Thumbnails / List toggle; both choices are remembered
    (`upcoming.filter`, `upcoming.view`). Thumbnails is an agenda of day sections with
    16:9 tiles, a stacked-card look and an "N episodes" badge for drops, and movie tiles
    with a Digital or Physical badge. Today's label is the one cyan use in Modern.
  - **Classic** keeps its list and gains the collapsed drops and the movie releases
    (a movie row opens the Movies tab).
  - **Section availability.** Upcoming now appears when Sonarr or Radarr is configured.
  - New icons: `stack`, `monitor-play`, `disc` (Phosphor regular, checksum-verified).
  - Test-only: the monitor-toggle e2e test no longer races the service worker (it creates
    its context with the worker blocked); two other tests that gate on `page.route` got the
    same option.
- **Human test plan** (placeholders only; use a stack with real Sonarr and Radarr):
  1. Open `#/upcoming` in Modern with both services. Confirm the All / TV / Movies chips and
     the Thumbnails / List toggle; pick TV, then Movies, then List, reload, and confirm both
     choices stayed.
  2. Find a season premiere that released all episodes at once. Confirm one tile reads
     "S<n> · Episodes 1–N" with an "N episodes" badge, not N tiles.
  3. Find a movie with a digital or physical release in the next 14 days. Confirm the
     Digital or Physical badge and the "Movie · Digital release" line, and that a movie that
     is only in cinemas is not listed.
  4. In List view confirm the day headings (for example "Tomorrow Saturday, Oct 17") and the
     right-hand state (Downloaded, Missing, "N of M", or the stack icon with "N episodes").
  5. Click a tile: an episode or drop opens the show page; a movie opens the movie page.
  6. Stop Sonarr (or Radarr): the page shows "Cannot reach Sonarr" with a Retry button and
     still lists the other service's items.
  7. Switch to Classic in Settings: Upcoming is a list with collapsed drops and movie rows;
     tapping a movie row opens the Movies tab.
  8. Set the device or browser time zone to one far from the server's (for example UTC-8 and
     UTC+13) and confirm a movie released on a given date stays on that date.
  - Look-checks (only a person can judge): the stacked-card look and the blurred movie
    background on real artwork; the cyan Today label against the amber and neutral palette;
    agenda density at 360 to 400 px columns; touch feel and safe areas on a real iPhone;
    real Radarr `digitalRelease` / `physicalRelease` values (assumed `T00:00:00Z`) and
    `physicalReleaseNote` text.

### Modern layout (factory job 003)

- **Web client only.** No server, dependency, service-worker or version change.
  - **Modern is the new default layout; Classic stays as an option.** Settings has a
    "Layout" choice (Modern or Classic). It applies at once, is remembered on the
    device (`layout` preference) and does not need Save. Switching keeps the section you
    are in (a show or movie page opens its Shows or Movies tab in Classic).
  - **Hash routes.** `#/downloads`, `#/shows`, `#/shows/<id>`, `#/upcoming`, `#/movies`,
    `#/movies/<id>`, `#/search` and `#/settings`. Links, the browser Back and Forward
    buttons, reload and deep links all work. An empty or unknown address is replaced
    (no extra history entry); a missing id shows a "Not found" page with a link back.
  - **Navigation.** A top bar from 640 px (brand, five links, Settings gear) and a
    five-link bottom bar on phones with the Settings gear in the page header. The bar is
    translucent over a show or movie page. Focus moves to the page heading when the page
    changes.
  - **A banner instead of service pills.** "Can't reach Sonarr" (or Radarr, SABnzbd,
    NZBHydra) with Retry and a Settings link, shown on the pages that depend on that
    service, one strip per offline service. It never shows before the first check.
  - **Shows and Movies libraries** with Large posters, Small posters and List views
    (remembered per section in `shows.view` and `movies.view`), meta line, filter
    chips, sort, search, an amber missing count and, for movies, Download All Missing.
    Unmonitored titles read "Unmonitored" with a grey poster; movies that are not out
    yet show their next digital or physical date.
  - **Show page** (hero, up to three genres, progress, Search Missing, Monitored, Open in
    Sonarr, a More button for removal) with season chips, per-season search and delete,
    and episode rows with stills, runtime, status and the existing episode actions.
  - **Movie page** (poster, status or file line, Download, Interactive Search, Monitored,
    Delete…). Movie tiles show their actions on hover or keyboard focus where the pointer
    can hover; touch devices open the page instead.
  - **Classic gains one thing:** the Movies view toggle reads List, Posters and Small
    posters (stored `movies.view = small`). Classic is otherwise unchanged.
  - The Modern shell reuses Downloads, Upcoming, Search and Settings as they are (jobs
    004 and 005 restyle Downloads and Upcoming); a visually hidden "Downloads" heading
    gives that page its `<h1>`. The Search field gained an accessible name.
  - The focus ring inside the Modern shell is neutral (light) rather than cyan; cyan is
    kept for live activity.
  - Artwork uses the smallest suitable TMDB size (tiles `w342`, show and movie pages
    `w780`/`w1280`) and falls back from a failing image to the next candidate and then to
    a placeholder.
  - Internal: search and removal code shared by both layouts moved to
    `src/hooks/useMediaActions.js` and `src/components/MediaSheets.jsx` with the toast and
    sheet wording unchanged; pure helpers are in `src/media.js`. The Phosphor icons
    `plus`, `dots-three`, `squares-four`, `grid-nine` and `list` were added.

#### Human test plan

1. Open the web app on a desktop with no stored layout (a fresh browser profile or after
   clearing site data). Check: it opens the Modern layout at `#/downloads`; Settings
   shows "Layout" with Modern selected.
2. In Settings choose Classic. Check: the Classic layout appears at once, Settings stays
   open, and a reload keeps Classic. Choose Modern again.
3. From Shows open a show, then from Movies open a movie. Use the browser Back and
   Forward buttons and reload on each page. Open `#/shows/<id>` in a new tab.
4. Stop Sonarr (or give ArrView a wrong Sonarr address), reload Shows. Check: one
   "Can't reach Sonarr" strip with Retry and Settings; Movies shows no strip. Start Sonarr
   again and press Retry: the strip disappears.
5. On Shows and Movies switch between Large posters, Small posters and List, reload, and
   check each choice is remembered per section.
6. Open a show with several seasons. Check hero art, the season chips (newest first),
   "Search N Missing", episode stills and runtimes, and the Downloaded, Missing and
   Upcoming episode states.
7. Open the movie page of a missing movie and of a movie with a file. Check the status
   line, the Download button only for the missing one, and that Delete… offers the same
   options as before.
8. In Movies (Large) hover a tile and Tab through it. Check Download, Interactive Search,
   Monitored and Delete appear over the poster.
9. In Classic Movies choose Small posters and check the tiles are about half as wide
   with no visible titles.
10. Resize to 640 px and 639 px (or use a phone): top bar at 640, bottom bar at 639.

Human checks that automated tests cannot judge:

- Hero feathering, and that the artwork never collides with the title on real artwork
  (try bright, dark and busy backdrops, at about 1024 px and 1440 px).
- How the desaturated stills (missing episodes) and greyscale posters look.
- Amber (missing) and cyan (live) restraint across all screens; the translucent top bar
  over a bright backdrop.
- Feel of the tile hover overlay on a real desktop.
- Safe areas (bottom bar, Settings gear, the round back and gear buttons) on a real
  iPhone, including landscape.
- A live Sonarr and Radarr run: real episode stills and runtimes appear (the fixture
  stills are local images; the real Sonarr `images` shape for episodes is unverified from
  this repo alone), and real `digitalRelease` and `physicalRelease` values show as dates.
- The Classic-versus-Modern preference after a real upgrade from 1.9A2: an existing
  `movies.view = posters` user sees Large posters in Modern and Posters in Classic.

## 1.9A2 (unreleased) — Web redesign foundation, Classic layout and server routes

- **Version 1.9A2.** Merges factory jobs 001 (server routes) and 002 (foundation and
  Classic layout) into `main`; the maintainer asked for this build on the `dev`
  channel. Both jobs passed their reviews. The merge conflicts were mechanical (README
  sections, and the identify assertions, which keep job 001's capabilities and read
  the version from `server.js`).
  - Checked in upstream source (2026-10-17): Sonarr and Radarr set a SABnzbd item's
    `downloadId` to its `nzo_id` unchanged (`Download/Clients/Sabnzbd/Sabnzbd.cs`), so
    exact queue matching holds. The `Episode` models of the shipped iOS app and of
    ArrViewCore declare no `images` field, so the new episode `images` are ignored
    when decoding. Both still deserve a live check (below).
  - *Human check:* Settings shows "ArrView v1.9A2", and `GET /api/health` and
    `GET /api/arrview/identify` report `1.9A2`. Then run both test plans below.

### Foundation and Classic layout (factory job 002)

- **Web client only.** No server,
  dependency or version change.
  - Dark only. The system light theme from 1.10.1 (W2) is superseded: the app and the
    offline page stay dark whatever the system setting, with one `theme-color`
    (`#0b0b0c`, also the manifest colours).
  - Inter 4.1 (variable, SIL OFL 1.1) is self-hosted under `public/fonts/inter/` and added
    to the service-worker precache, so it renders offline. No third-party font request.
  - Phosphor icons (2.1.1, MIT, licence in `licenses/`) as inline SVG replace every emoji
    and glyph icon; no emoji or symbol glyphs remain. Icon-only buttons keep their
    accessible names; a few gain a `title`. The episode-description button uses `info`
    (filled while open), error states and release rejections use `warning`, empty states
    use `question`, release protocol badges use `newspaper` (Usenet) and `plant` (Torrent)
    beside the text, and seeders show `arrow-up` with the count. The episode status badge
    now reads "Downloaded" with a check icon. The Monitor toggle keeps one width in its
    idle and "Saving…" states, so the row no longer shifts.
  - New neutral dark tokens replace the GitHub-style palette. Cyan is for live activity
    and focus only, amber for missing items and Search Missing actions, red for
    destructive actions. Progress fills are solid; there are no glows. Primary buttons
    are a neutral light fill.
  - Classic layout: left sidebar from 1024px (Settings at the bottom), horizontal bar from
    640px, and on phones a five-tab bottom bar with Settings as the gear in the top bar.
    One-line stats, segmented filters, icon-button row actions, quiet service status and,
    for Movies "Posters", a poster wall with hover/keyboard-focus actions (always visible
    under the poster on touch and phones). Wording, filters and destructive text unchanged.
  - *Human test plan:* back up `config.json`. Open the dashboard on desktop and phone. Set
    the system to light mode and confirm the app stays dark. Check each tab. Hover posters
    and tab through their actions. Pause and resume a queue item. Open and cancel each
    destructive sheet. Go offline after the first load and confirm the offline page. In
    DevTools Network, confirm `InterVariable.woff2` loads from the server and no font
    or icon loads from another origin. Not covered by automated tests: a real Sonarr/Radarr library,
    iOS/Android installs, VoiceOver, and a Docker image build.

### Server routes (factory job 001, server only, no web UI change)

- New `GET /api/sonarr/queue` and `GET /api/radarr/queue`: bounded (first 100 records),
  allowlisted proxies of the upstream queues with the series, episode or movie embedded.
  `downloadId` is passed through verbatim so a client can match SABnzbd slots exactly.
- New `GET /api/radarr/calendar?start&end`: same window rule as the Sonarr calendar (at
  most 32 days). The server keeps only movies whose digital or physical release falls in
  the window (cinema dates never qualify) and returns an allowlist, at most 500 movies.
- Additive: `GET /api/sonarr/series/:id/episodes` also sends `includeImages=true` and
  `GET /api/sonarr/calendar` also sends `includeEpisodeImages=true` (responses stay
  pass-through).
- `GET /api/arrview/identify` capabilities gain `sonarrQueue`, `radarrQueue`,
  `episodeStills`, `calendarStills` and `radarrCalendar`. The version label is unchanged by that job.

Human verification (not covered by the automated tests, which use a fake upstream):

- With a live Sonarr and Radarr and an active SABnzbd download, confirm each queue
  record's `downloadId` equals the matching SABnzbd slot's `nzo_id` exactly, including
  case. Unverified assumption: the services report SABnzbd's `nzo_id` verbatim
  (expected shape `SABnzbd_nzo_` plus random characters).
- Confirm `images[].url` values load artwork as they do for the existing series and
  movie routes (copied unchanged from upstream, often relative `/MediaCover/...`).
- Confirm the installed versions honour `includeImages` (Sonarr episodes),
  `includeEpisodeImages` (Sonarr calendar) and `includeMovie` (Radarr queue), and
  whether `physicalReleaseNote` is present on Radarr calendar movies.
- Compare the Radarr calendar for a month with known digital and physical dates against
  Radarr's own calendar.
- Confirm iOS proxy-mode episode lists and the web Shows and Upcoming tabs still work.

## 1.9A1 (unreleased) — Docker environment seeding, masked keys, safer saves

- **Version 1.9A1.** This build starts the pre-2.0 track. Each build increments the A
  number (1.9A2, 1.9A3, …) until 2.0. The label is display text, and it sorts below
  1.10.2 if compared as numbers, so clients must detect features through the
  `capabilities` list in `GET /api/arrview/identify`, never by comparing versions.
  ArrView's own clients only display the version. Tests read the label from `server.js`
  (`tests/helpers/app-version.js`), so a bump is a one-line change.
  - *Human check:* Settings shows "ArrView v1.9A1", and `GET /api/health` and
    `GET /api/arrview/identify` report `1.9A1`. An iOS app in ArrView Server (proxy) mode
    still connects and shows the version (shipped 1.0 and the current Dev build). Direct
    mode doesn't read the server version. Not verified: a running Docker image and real
    iOS/tvOS devices.
- Services can be configured from container environment variables
  (`ARRVIEW_HOST`, `ARRVIEW_<SVC>_API_KEY` / `_API_KEY_FILE`, `ARRVIEW_<SVC>_URL`).
  A service with both a key and an address is env-managed: applied on every read,
  never written to `config.json`, read-only in Settings.
- `GET /api/config` masks API keys and adds a read-only `envManaged` object. A
  masked key sent back is reused only when the service address is unchanged
  (`POST /api/config` and `POST /api/test/:service`).
- Config-wipe fix: non-JSON POST/PUT/PATCH under `/api` (webhooks excepted) get
  415, malformed JSON gets 400, `POST /api/config` is validated (service URLs may
  not contain a query or fragment) and written atomically.
- API keys are trimmed and must contain at least one letter or number, in
  Settings, `POST /api/config`, `POST /api/test/:service` and environment keys.
  A spaces-only key is blocked in Settings rather than treated as removal.
- Settings preserves a stored SABnzbd path and shows server error messages.
- `.gitignore` gains `data/`, `.env` and `secrets/`; `.dockerignore` gains `.env` and
  `secrets` (it already excluded `data`).
- `POST /api/config` answers 409 when it tries to change an env-managed service. A
  SABnzbd path is kept only while the SABnzbd address is unchanged (otherwise it is
  detected again), and a stored service URL containing `?` or `#` now blocks Settings
  saves until it is fixed. `POST /api/test/:service` normalises and validates the URL
  and key the same way.
- Saves are atomic (temporary file, then rename): a new `config.json` is mode `0600`;
  an existing one keeps its mode but is owned by the server user after the first save;
  a single-file bind mount of `config.json` makes saves fail (mount the data
  directory); a symlinked `config.json` is replaced by a regular file; a read-only data
  directory makes every save fail with a 500.
- The letter-or-number key rule means ASCII (`A`–`Z`, `a`–`z`, `0`–`9`); typed keys are
  limited to 256 characters with no control characters. Stored keys are not migrated.

### Test plan (what a person must do to verify; placeholders only, back up `config.json` first)

Verified by CI on a clean checkout of commit `439774f` (GitHub Actions, 2026-10-12):
`npm ci`; `npm test` (node 65/65, vitest 41 tests in 6 files); Playwright e2e 34/34;
and the multi-arch (linux/amd64 + linux/arm64) image build and publish as `dev`.

1. **Settings save guard** (browser, Settings-managed install with two services): edit a
   service address and confirm its key clears and Save is blocked, with no request
   sent, until a key is typed; type then erase the key and confirm Save stays blocked
   and nothing is deleted; spaces-only and `----` keys are refused with "API key must
   contain at least one letter or number."; a completely empty key removes the
   service; a padded key is stored trimmed.
2. **SABnzbd path**: change the SABnzbd address and key, save, open Downloads and
   confirm the queue loads and the path is detected again; an unchanged save keeps the
   stored path.
3. **Linux Docker with `network_mode: host`**: set `ARRVIEW_HOST`, one `_FILE` secret
   key and one per-service address override, then `docker compose up -d`. Logs name
   variables but never values; both services load, show read-only with a masked key
   and a note; `GET /api/config` shows `envManaged`; a `POST /api/config` that
   changes an env-managed service returns 409; the env address and key never appear
   in `config.json`. Each bad configuration (address with `?`, plain and `_FILE` key
   together, empty key, `ARRVIEW_HOST` with a port) logs one `[config]` line and
   leaves the service editable.
4. **Upgrade**: copy a populated production `config.json` to a test volume, start the
   image, save with no changes, and confirm keys and the stored SABnzbd path are
   unchanged; note the file's owner and mode afterwards. Also try a first install (new
   file `0600`, root-owned), a single-file bind mount (saves fail with 500; the
   directory mount works) and a symlinked `config.json`.
5. **Shipped iOS 1.0 and tvOS**, in **ArrView Server (proxy)** and **Direct** mode,
   against an env-managed and a Settings-managed server: services are detected, and
   queue, history, search, add and monitor work with no 415 or 400; the apps accept
   the masked keys from `GET /api/config`. Direct mode should be unaffected.
6. **curl hardening** (throwaway data directory): `POST /api/config` with `text/plain`
   and with no content type (415, file unchanged); malformed JSON (400);
   `POST /api/webhooks/sonarr` with `text/plain` (200); `POST /API/config` in capitals
   (415); a masked key with a changed address on `POST /api/config` and
   `POST /api/test/sonarr` (400, nothing sent upstream); a padded real key against a
   live Sonarr (the trimmed key reaches it).

Not verified: anything on a real Linux Docker host, against live Sonarr, Radarr,
SABnzbd or NZBHydra, with a populated production `config.json`, with the shipped apps
in either mode, or on a device; the Settings page was exercised only by component
tests, not by eye. Stored keys with surrounding spaces or no letter or number are
intentionally not migrated and were not tried against a real config; a key of only
non-ASCII letters is refused by design; a key typed as a space plus the bullet mask is
stored literally (the optional guard is not built).

## 1.10.1 — 2026-09-19 — Web parity W2: mobile layout and lifecycle

Completes W2's nine areas in the container development repo. Version 1.10.1 leaves
1.11 available for the planned authentication sprint. No native iOS/tvOS/Core
changes and no server config schema changes; the server adds only an SSE retry
hint alongside its version bump.

- Service-gated bottom navigation below 640px, existing top navigation above;
  Search and Settings are reachable without modal-only navigation.
- At least 44px touch controls, accessible icon names/form labels, wrapping rows
  and action controls, responsive movie grid, and toasts above the bottom bar.
- Shared native-dialog sheets for add-media, interactive release search, NZB
  search and confirmations. Scrollable body, reachable header Close, focus trap,
  Escape and focus return. Desktop retains centred panels.
- Confirmation wording distinguishes Delete and Unmonitor from Delete and Remove
  from Sonarr, and preserves Remove/Keep Files. SAB queue deletion also confirms.
  Partial episode-file or monitor failure is reported, not a false success.
  No new whole-series unmonitor or Radarr management features are added (W3).
- Versioned local view preferences: tab, library search/filter/sort, expanded
  show/seasons, release options and NZB query. No API/config/key/result caching.
  Denied/corrupt storage is tolerated; removed services get a valid fallback tab.
- Single shared EventSource; health/download/library/episode polls pause hidden
  and resume with immediate fetch. Movies get a 60-second safety poll. Network
  reconnection catches up; per-second countdowns removed. Command-status checks
  suspend and clean up on unmount. Server emits retry: 5000.
- System light/dark colors, matching theme-color metadata and offline appearance.

Post-merge CI exposed an online-event/network-readiness race in the W1 offline
page. A bounded recovery retry now tolerates transient failures after the online
event; a browser regression simulates delayed network availability.

### Human test plan

1. Upgrade a test container from **1.10** (and from the currently shipped image
   where applicable) using the existing /data mount. Confirm service credentials
   remain, health is healthy, identify/Settings show 1.10.1, and all libraries load.
   Configure the old image before upgrading; there is no config-schema migration.
   Only browser view preferences are new; native app credentials remain untouched.
2. On physical iPhone/iPad and Android, use browser and installed Home Screen app.
   Check widths 305, 320, 360, 390, 402, 440, 466, 669, 834, 1280; sweep through
   450–750px and confirm bottom/top navigation switches at 640 without losing
   selection. Check Duo cover/folding and a short 320×568 viewport, portrait and
   landscape, real notches/home indicator and the on-screen keyboard. Repeat narrow
   layouts with enlarged text. Expected: controls accessible, no horizontal scroll,
   sheets scroll without losing Close, bottom navigation/toasts do not hide actions.
3. Browse Downloads, expand Shows/seasons, search Movies, open add-media and
   interactive/NZB results. Try touch, keyboard Tab/Shift-Tab/Escape, VoiceOver and
   TalkBack. Expect labelled actions, contained dialog focus and focus returned on
   close. Change system light/dark while open; text and controls remain readable.
4. Change tab, filters, sort and expanded show/season; reload or relaunch the
   installed app. Expect them restored. Remove a configured service and verify its
   old saved tab falls back to an available tab. Clear/deny browser storage: app
   should still work. HTTP and HTTPS origins have separate preferences. Inspect
   localStorage/Cache Storage: view preferences/shell only, no API keys or data.
5. Open Movies or Shows, background the app and change data upstream. Return:
   expect one reconnected SSE stream and refreshed active data. In browser Network
   tools check hidden-page polling stops, visible Movies polls every 60 seconds,
   and dropping/recovering the event connection triggers refresh. Test offline/
   online return and W1's offline screen. Real OS suspension is not proven by a
   synthetic visibility test; verify on both physical platforms.
6. Using **disposable media only**, open each destructive sheet and Cancel first:
   no upstream mutation or success toast. Then test episode/season Delete and
   Unmonitor, Remove from Sonarr/Keep Files, Delete and Remove from Sonarr, and
   SAB queue removal. Verify exactly the named consequence. Interrupt an upstream
   operation: sheet/error must describe failure or partial completion, not success.
   Check Sonarr monitoring after any partial delete/unmonitor error before retrying.
7. Regression-check native iOS **proxy mode** against the dev server, then
   **Direct mode** against the same services: browsing, downloads, calendar and
   discovery. Core/native unchanged, but backend behavior must be smoke-tested in
   both modes. Physical LAN/privacy check required: Simulator does not implement
   local-network privacy (TN3179). No Apple builds were needed for this web-only UI.

### Verification / not verified

Production Vite build and server syntax/diff checks pass. Automated results:
**30/30 Node server checks**, **18/18 React/component checks**, **34/34 Chromium
browser checks** using fake loopback services. Includes SSE retry framing,
visibility/timer cleanup, reconnect and in-flight catch-up, command disposal,
partial destructive failures, storage fallback, single real event-stream ownership,
all populated tabs and sheets at all ten widths, 44px touch targets, short viewport,
keyboard focus, cancelled-mutation regression, system theme and enlarged text.
W1 offline/API cache isolation and worker-update checks remain passing. Narrow
305px light/466px dark Shows and 305px Add sheet screenshots visually inspected.
Early iterations corrected modal markup, a test's ambiguous season selector,
Node 26's native localStorage collision in the unit harness, and touch sizing in
narrow layouts. Final runs above passed; earlier failures are not counted as passes.

**Not verified:** live destructive operations/services, physical iPhone/Android
install/relaunch and OS suspend/resume, actual notches/folding/keyboard, Safari/
WebKit, VoiceOver/TalkBack, native proxy/Direct/LAN and real container volume
upgrade. Local Docker daemon remains unavailable; CI/image publication recorded
separately. The full native iOS size matrix is not claimed: native UI is unchanged.

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

> **Superseded 2026-10-12:** no longer identical. Dev's `publish-ghcr.yml` now runs
> `test.yml` first (`build-and-push` has `needs: test`, commit `9638014`), so promote
> the workflow only together with `test.yml`, `tests/`, `playwright.config.cjs` and the
> dev dependencies; the release repository does not have them yet.

Human test plan: follow README's "Docker channels and ARM64" verification plan:
verify channel digest isolation, both manifest architectures, startup/service
connections and config persistence on both host architectures, physical-device
Bonjour/proxy and Direct regression, and switching back to latest. Application
storage and Apple code are unchanged, so no Apple rebuild or schema-migration
check is required for this infrastructure change alone.

Verification results are recorded below after local checks. GHCR publication,
ARM64/AMD64 container builds and live runtime/device checks are not yet verified.

> **Update 2026-10-12:** the multi-architecture image builds and publishes (re-checked
> today: the `dev` tag carries linux/amd64 and linux/arm64). Live runtime and device
> checks of this infrastructure change remain unrecorded.

Local verification: Actionlint 1.7.12 passed both workflows; 10 evaluated
repository/ref/event cases passed the channel isolation checks. Both Compose
files parsed as YAML with the expected ARRVIEW_TAG/default-latest template;
workflow byte equality and both architecture targets were checked. No Docker
daemon or Compose CLI is available here, so these are static checks, not image
builds, Compose execution or runtime tests. No image was pushed or deployed.

## 1.10.2 — 2026-09-19 — Web parity W3: library management and Upcoming

W3 implemented in the container development repo; native apps and ArrViewCore
unchanged. W4 retains version 1.11. No config schema changes.

- Movies: lazy remote posters with a missing-image fallback, persisted List /
  Posters view, interactive release search shared with Shows (Radarr grab or
  NZBHydra-to-SAB fallback), file size/quality/resolution/languages, monitoring,
  Recently Downloaded sorting by `movieFile.dateAdded`, and explicit Delete and
  Unmonitor / Delete and Remove from Radarr confirmations. Removal requires the
  advertised capability or legacy server 1.08+. Partial failures stay visible.
- Shows: posters and series monitoring; Upcoming from the Shows toolbar and
  service-gated navigation. Calendar spans yesterday through +14 local days,
  groups by local air date and displays episode/time/status. Selecting an episode
  clears hidden library filters, expands its show and scrolls it into view.
- Downloads: visible-page polling at 2 seconds while downloading, 10 seconds idle,
  Live indicator, history Load more in increments of 15 (maximum 1000).
- Settings: explicit configured-service checklist alongside version and W1 help.
- Additive server changes: `PUT /api/sonarr/series/:id` accepts boolean monitored,
  reads the current upstream resource and preserves its other fields on update;
  `/api/sabnzbd/history?limit=` validates 1–1000, retaining default 15. Identify
  advertises movieDelete, seriesMonitor and historyLimit capabilities.

### Human test plan

1. Upgrade the prior dev image using its existing `/data` volume. Expect the
   same service configuration, API keys and saved browsing preferences. Confirm
   Settings shows 1.10.2 and its service checklist agrees with configuration.
2. On physical iPhone Safari/Home Screen and Android Chrome/installed HTTPS app,
   check posters (including a failed image), List/Posters persistence, file
   details against Radarr, and Recently Downloaded order after a fresh import.
   Use interactive search and grab a disposable release; confirm the correct
   Radarr movie or Sonarr episode is targeted. Check rejected results and Hydra
   fallback. Plain HTTP Android remains a shortcut, not a full installed PWA.
3. With disposable media only, cancel both movie deletion choices first (nothing
   changes), then test Delete and Unmonitor (file gone, movie remains unmonitored)
   and Delete and Remove (files and library entry gone). Disconnect the upstream
   during an action: expect an error, never success. Close to refresh before a
   partial-action retry. Toggle movie/series monitoring and verify in each service;
   series path, quality profile and season settings must remain unchanged.
4. Check Upcoming around local midnight/timezone changes: yesterday through +14
   days, Downloaded/Missing/Upcoming badges, times, empty/error states, and selecting
   an episode opens its show even with previously saved nonmatching filters.
5. Start/stop a disposable SAB download: expect 2-second/10-second updates and
   working history Load more. Background the installed app, then return: polling
   stops hidden, resumes immediately, and one SSE connection reconnects. Check
   service failure/recovery, settings save, and existing episode actions.
6. Check widths 305, 320, 360, 390, 402, 440, 466, 669, 834 and 1280px, short
   320×568, large text, light/dark, keyboard and screen reader. Verify actual
   notch/Duo safe areas, software keyboard and reachable sheet controls.
7. Smoke-test the native app on a physical device in BOTH Server/proxy and Direct
   modes: libraries, calendar, search, monitoring and disposable deletion. Direct
   implementation is unchanged, not proven by server tests. iOS Simulator does
   not implement local network privacy (Apple TN3179).

**Agent verification:** production Vite build; 35/35 Node server checks, 27/27
React component tests, 34/34 Chromium browser checks (W3 integrated into all ten
width checks). Covers metadata-preserving monitor updates, invalid limits,
upstream errors, movie deletion partial failures, Radarr/Hydra release routing,
legacy removal gating, calendar boundaries, adaptive polling, pagination and
view persistence. W1/W2 cache/offline/worker/lifecycle regressions included.
Narrow layouts visually reviewed. CI/publication recorded after verification.

**Not verified:** physical iPhone/Android install, Safari engine, notch/fold/
keyboard/screen-reader behavior, real OS suspension/LAN permissions, live media
services or destructive actions, native proxy/Direct and real persistent-volume
upgrade. No native build needed: apps/Core unchanged. No running container was
restarted; dev publication is not deployment. No release/latest promotion.
