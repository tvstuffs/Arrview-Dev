# ArrView's server API

The web app and the ArrView app for iPhone and iPad talk to ArrView's server through the routes below. Scripts can
use them too. The server is a proxy: it holds the addresses and API keys of Sonarr, Radarr, SABnzbd and NZBHydra and
asks them on the client's behalf, so a client needs only ArrView's address. The iPhone app's Connect Directly mode
does not use this server.

All routes answer JSON. In the examples, `http://arrview.example:7777` stands for your ArrView.

## Basics

**Features, not versions.** `GET /api/arrview/identify` describes the server:

```json
{ "app": "arrview", "version": "2.0",
  "capabilities": ["pwa", "ping", "health", "movieDelete", "seriesMonitor", "historyLimit", "sonarrQueue", "radarrQueue",
                   "episodeStills", "calendarStills", "radarrCalendar", "seasonMonitor", "seasonMonitorFrom", "auth"],
  "auth": false,
  "services": { "sabnzbd": true, "sonarr": true, "radarr": true, "nzbhydra": false },
  "bonjour": { "state": "advertising" } }
```

`services` says which apps are set up (an address and a key). The version label is display text only (earlier
labels look like `1.9A24`): never compare it. A client checks for the capability it needs. The list only grows, and
`auth` is always last.

**Health.** `GET /api/health` answers `{"status":"ok","version":"2.0"}` whenever the process is running, even before
setup or when the apps are offline. The image's health check calls it every 30 seconds. It does not mean the apps
can be reached.

**The apps' status.** `GET /api/<service>/ping`, where `<service>` is `sonarr`, `radarr`, `sabnzbd` or `nzbhydra`,
answers `{"status":"ok"}` when the app answers as itself and accepts the key, 503 when it does not or is not set up,
and 404 for any other name. Sonarr and Radarr must name themselves correctly; SABnzbd and NZBHydra are asked
something that needs the key.

**Signing in.** With the password login off (the default), every route is open. With it on, send the browser's
session cookie or an app key, as `X-Api-Key: <key>` or `Authorization: Bearer <key>`. Which routes stay open, and how
to make a key, is in the README under
[Password login](../README.md#password-login-optional).

**Requests that change something.** `POST`, `PUT` and `PATCH` requests to `/api` (other than `/api/webhooks/*`) must
send `Content-Type: application/json` with a body, otherwise the server answers 415; malformed JSON gets 400
`{"error":"Invalid JSON"}`. `curl -d` therefore needs `-H 'Content-Type: application/json'`. Requests from a signed-in
browser also send `X-Requested-With: ArrView`.

**Ids.** An id in a route's path that is passed on to Sonarr or Radarr (`:id`, `:season`) must be 1 to 10 digits, and so
must `episodeId` and `movieId` on the release searches; anything else gets 400 `{"error":"Invalid id"}` and nothing is
sent. A query value that is passed on must be given once, as plain text; a repeated or bracketed value gets 400
`{"error":"Invalid query"}`.

**Commands.** `POST /api/sonarr/command` takes only `SeriesSearch` (`seriesId`), `SeasonSearch` (`seriesId`,
`seasonNumber`) and `EpisodeSearch` (`episodeIds`, 1 to 10000 ids); `POST /api/radarr/command` only `MoviesSearch`
(`movieIds`, 1 to 10000 ids). Ids are JSON numbers above 0, and other fields are dropped. `POST /api/sabnzbd/action`
takes only `{"mode":"pause"}` or `{"mode":"resume"}`, the same with one `nzo_id`, and
`{"mode":"queue","name":"delete","value":"<nzo id>"}`, where an nzo id is one token of up to 64 letters, digits, `_`
or `-`, never `all`. Anything else gets 400 `{"error":"That command is not supported"}` and nothing is sent.

**Live updates.** `GET /api/events` is a server-sent events stream that tells clients when to refresh (for example
after a webhook from Sonarr or Radarr). The server sends a five-second retry hint. Removing a session or an app key
ends its open stream.

**Caching.** Hashed build files under `/assets/` may be cached for a year. The HTML shell and the other public files
revalidate, API answers are never stored, and a missing file answers 404 rather than the app shell. A reverse proxy
should keep these headers.

## Configuration

- `GET /api/config` answers the saved configuration, with each API key masked (`••••` plus its last four characters;
  keys of eight characters or fewer show only `••••`).
- `POST /api/config` saves it. The body is validated: unknown keys, invalid addresses and invalid keys get 400. A
  service set from Docker variables cannot be changed (409). A service set in Settings that is left out of the body
  is removed, so send the whole configuration. A masked key sent back is kept only if that service's address is
  unchanged; with a new address, send the key again.
- `POST /api/test/<service>` is the Settings Test: `{ "url": "...", "apikey": "..." }` for an address and key that are
  not saved yet. It answers `{ "success": true, "version": "..." }`, or 503 with an `error` in words a person can act
  on.

## Routes

Grouped by app. The detailed sections below cover the routes whose behaviour is not obvious from their name.

| Area | Routes |
|---|---|
| Server | `GET /api/arrview/identify`, `GET /api/health`, `GET /api/<service>/ping`, `GET /api/events`, `GET /api/config`, `POST /api/config`, `POST /api/test/<service>` |
| Sonarr | `GET /api/sonarr/series`, `POST /api/sonarr/series`, `PUT /api/sonarr/series/:id`, `DELETE /api/sonarr/series/:id`, `GET /api/sonarr/series/:id/episodes`, `PUT /api/sonarr/series/:id/season/:season`, `PUT /api/sonarr/series/:id/seasons`, `PUT /api/sonarr/episode/monitor`, `DELETE /api/sonarr/episodefile/:id`, `GET /api/sonarr/calendar`, `GET /api/sonarr/queue`, `GET /api/sonarr/release`, `POST /api/sonarr/release`, `POST /api/sonarr/command`, `GET /api/sonarr/command/:id`, `GET /api/sonarr/lookup`, `GET /api/sonarr/qualityprofiles`, `GET /api/sonarr/rootfolders` |
| Radarr | `GET /api/radarr/movies`, `POST /api/radarr/movie`, `DELETE /api/radarr/movie/:id`, `PUT /api/radarr/movie/monitor`, `DELETE /api/radarr/moviefile/:id`, `GET /api/radarr/calendar`, `GET /api/radarr/queue`, `GET /api/radarr/history/recent-imports`, `GET /api/radarr/release`, `POST /api/radarr/release`, `POST /api/radarr/command`, `GET /api/radarr/lookup`, `GET /api/radarr/qualityprofiles`, `GET /api/radarr/rootfolders` |
| SABnzbd | `GET /api/sabnzbd/queue`, `GET /api/sabnzbd/history`, `POST /api/sabnzbd/action`, `POST /api/sabnzbd/addurl` |
| NZBHydra | `GET /api/nzbhydra/search`, `GET /api/nzbhydra/status` |
| Webhooks | `POST /api/webhooks/sonarr`, `POST /api/webhooks/radarr`, `GET /api/webhooks/last`, `GET /api/webhook-setup/<service>`, `POST /api/webhook-setup/<service>`, `DELETE /api/webhook-setup/<service>` |
| Sign-in | `GET /api/auth/status`, `POST /api/auth/login`, `POST /api/auth/logout`, `POST /api/auth/logout-all`, `POST /api/auth/token`, `POST /api/auth/password`, `POST /api/auth/password/remove`, `POST /api/auth/setup/skip`, `GET /api/auth/keys`, `POST /api/auth/keys`, `POST /api/auth/keys/remove`, `POST /api/auth/keys/remove-all` |

## Sonarr calendar: `GET /api/sonarr/calendar?start&end`

Returns monitored Sonarr episodes with their series. `start` and `end` (ISO 8601) are both required; the interval must
be positive and at most 32 days. The server asks Sonarr with `includeSeries=true`, `includeEpisodeImages=true` and
`unmonitored=false`. Without Sonarr set up it answers 503; an error from Sonarr is never turned into an empty
calendar.

## Radarr calendar: `GET /api/radarr/calendar?start&end`

Validated like the Sonarr calendar: `start` and `end` must each be one parseable value, `end` after `start`, at most
32 days, otherwise 400 before Radarr is asked. The server calls Radarr with the normalised bounds and
`unmonitored=false`.

**The server filters release types.** Radarr returns a movie when any of its dates (cinema included) is in the window,
so the server keeps a movie only when its `digitalRelease` or `physicalRelease` falls inside the window (both bounds
inclusive). Movies with only a cinema date in the window, or with absent or unparseable dates, are dropped; order is
kept and at most 500 movies are returned. `inCinemas` is still returned but is informational and must not be shown as
a release date.

Each movie holds only `id`, `title`, `year`, `monitored`, `hasFile`, `isAvailable`, `status`, `inCinemas`,
`digitalRelease`, `physicalRelease`, `physicalReleaseNote` and `images` (as for the queue, below). Fields missing in
Radarr are `null`. Limits and errors are as for the queue routes, with the message `Radarr calendar unavailable` (a
non-array answer from Radarr gives 502).

## Queues: `GET /api/sonarr/queue`, `GET /api/radarr/queue`

They take no parameters. The server asks for the first page of 100 records (`includeSeries` and `includeEpisode` for
Sonarr, `includeMovie` for Radarr) with a 10-second timeout, a 4 MiB limit, no redirects and strict JSON. The answer
is `{ page, pageSize, totalRecords, records }`; a `totalRecords` larger than `records.length` means the list stops at
100.

Each record holds only: `id`, `title`, `status`, `size`, `sizeleft`, `timeleft`, `estimatedCompletionTime`,
`trackedDownloadStatus`, `trackedDownloadState`, `downloadId`, `quality` (`{ name }` or `null`), and either
`seriesId`, `episodeId`, `series` (`{ id, title, year, images }`) and `episode` (`{ id, seasonNumber, episodeNumber,
title, airDateUtc }`) or `movieId` and `movie` (`{ id, title, year, images }`). Embedded items are `null` when the app
has none. `images` holds at most the first poster and the first fanart as `{ coverType, url, remoteUrl }`. No file
paths, download client, indexer, overview or credentials are returned.

`downloadId` is passed through as a string, or `null` when absent, empty or not a string. It is never trimmed or
case-folded, so an exact comparison with SABnzbd's `nzo_id` is the only matching rule a client should use.

Errors return only `{ "error": "Sonarr queue unavailable" }` or `{ "error": "Radarr queue unavailable" }`: an invalid
page from the app gives 502, a 404 from the app gives 502, other 4xx and 5xx statuses are kept, and anything else
(connection failure, an oversized or malformed answer, a redirect, the app not set up) gives 503.

## Recent imports: `GET /api/radarr/history/recent-imports?page=1`

Bounded data for "recently downloaded" widgets. Only pages 1 to 3 are allowed. Each request to Radarr asks for 20
history records with `eventType=3` (downloadFolderImported), the movies embedded, newest first. Radarr's answer is
capped at 512 KiB, redirects are refused, and only the fields a widget needs are returned. It never fetches the whole
movie library. A client limits the result to 12 distinct movies that are still downloaded; purged history is not
rebuilt from the library. On a server without this route a client gets 404 (or the app's HTML): it should keep its
previous data and report the missing route, not fall back to the whole library.

## Episodes and their stills

`GET /api/sonarr/series/:id/episodes` asks Sonarr with `includeImages=true`, and the calendar with
`includeEpisodeImages=true`. Both answers are passed through: episodes carry their `images` when Sonarr has them.

## Season monitoring

- `PUT /api/sonarr/series/:id/season/:season` with `{ "monitored": true }` or `false` monitors or unmonitors one
  season: its flag, and every episode in it that differs. Capability `seasonMonitor`.
- `PUT /api/sonarr/series/:id/seasons` with `{ "monitored": true }` or `false` does the same for every season except
  season 0 (the specials, which are left as they are). Monitoring also turns the show itself on, because Sonarr grabs
  nothing for an unmonitored show; unmonitoring leaves the show's own setting. Capability `seasonMonitor`.
- The same route with `{ "monitored": true, "fromSeason": 5 }` monitors season 5 and every later season, unmonitors the
  seasons before it, leaves the specials alone, and turns the show on if it was off. `fromSeason` must be a season
  number of 1 or more, sent with `monitored: true` (otherwise 400), and a season the show does not have gives 404. The
  answer is `{ "success": true, "monitored": true, "seasons": [...], "fromSeason": 5 }`. Capability
  `seasonMonitorFrom`.

Each of these makes a fixed, small number of requests to Sonarr (at most five), however many seasons the show has. When only some episodes could
be changed, the answer is an error that says which part was done.

## Webhooks

`POST /api/webhooks/sonarr` and `POST /api/webhooks/radarr` receive Sonarr's and Radarr's webhooks. They stay open
when the password login is on. Each event refreshes the clients that are open (through `/api/events`).

`GET /api/webhooks/last` is what Settings reads. It answers with the seconds since ArrView started and, for each app,
the last `event` and the last `test`, each as `{ "eventType": "Download", "ageSeconds": 125 }` or `null`:

```json
{ "uptimeSeconds": 4321,
  "sonarr": { "event": { "eventType": "Download", "ageSeconds": 125 }, "test": null },
  "radarr": { "event": null, "test": null } }
```

Only event types made of plain letters (up to 40) are kept, whatever is posted. Ages are counted by the server, so a
browser clock that disagrees never shows a wrong time. Nothing is written to disk.

`GET`, `POST` and `DELETE /api/webhook-setup/<service>` (`sonarr` or `radarr`) are the Settings card's status,
**Set up** and **Remove**. Each first asks the app which app it is and stops with the state `wrong-app` when the
address leads to the other one. Set up uses the ArrView address saved in Settings (`webhooks.baseUrl` in
`config.json`) and never edits an existing connection.

## Sign-in

The sign-in routes are used by the web app; `POST /api/auth/token` lets a script make an app key with the password.
Their behaviour (sessions, keys, limits and recovery) is described in the README under
[Password login](../README.md#password-login-optional).
