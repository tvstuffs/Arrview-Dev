# Developing ArrView

How to run ArrView from source, test it, build the image, and how releases are published. For using ArrView, see the
[README](../README.md); for the server's routes, [API.md](API.md).

## Requirements

- [Node.js](https://nodejs.org/) 20 and npm. The image and CI use Node 20.
- OpenSSL, for the browser tests (they make a temporary localhost certificate).
- Docker, to build the image.

## Run from source

```bash
npm ci

# Development: the React app with hot reload on http://localhost:5173, the server on http://localhost:7777
npm run dev

# Or the production build, served by the server alone on http://localhost:7777
npm run build
npm start
```

`PORT` sets the server's port (`PORT=8888 npm start`). Outside Docker the data folder is the folder that holds
`server.js` unless `CONFIG_DIR` is set; `config.json`, `auth.json` and `data/` are git-ignored. In development, Vite
passes `/api` requests to the server on port 7777.

## Project structure

```
server.js                  The Express server: the API proxy, settings, sign-in, webhooks, Bonjour
index.html, vite.config.js The web app's entry and build
src/
  main.jsx, App.jsx        Start-up, sign-in and first-run gates, the layout switch
  sections.js              The pages (Downloads, Shows, Upcoming, Movies, Search, Settings) and what each needs
  media.js, downloads.js   Library and download helpers shared by both layouts
  components/              The Classic layout, Settings, sheets and shared controls
  components/modern/       The Modern layout: ModernShell, the pages, the header and the side rail
  hooks/                   Preferences (usePreference) and shared hooks
  sw.js                    The service worker (HTTPS and localhost only)
public/                    Icons, the manifest, the Inter font
tests/                     Node contract tests (*.test.js), web component tests (web/), browser tests (e2e/)
docs/                      This guide, the API reference and the README screenshots
```

## Tests

```bash
npm test                   # the server's contract tests (node --test) and the web component tests (Vitest)
npx playwright install chromium
npm run test:e2e           # a production build and the browser tests
```

The browser tests run against an isolated HTTPS fixture on loopback, with fake Sonarr, Radarr, SABnzbd and NZBHydra
answers; they never touch a real library. They cover the pages at widths from 305 to 1280 pixels and the foldable and
short-screen sizes, the Home Screen app's offline behaviour, sign-in and the password forms, webhooks and the add
flows. CI runs all three suites on every push to `main` and on pull requests, and publishing waits for them.

Every change comes with tests that fail before it and pass after it, and a CHANGELOG entry with the checks behind it
and a test plan for a person.

## Build the image

```bash
docker build -t arrview .
mkdir -p ./data
docker run -d --name arrview --network host -v "$PWD/data:/data" arrview
```

The build compiles the web app in one stage and copies `dist/` and `server.js` into a slim Node 20 image that declares
`/data` as a volume and checks `/api/health` every 30 seconds.

## Version label

`APP_VERSION` in `server.js` is the version shown in Settings and returned by `/api/health` and
`/api/arrview/identify`. It is display text: clients detect features through `capabilities`, and the tests read the
label from `server.js` rather than repeating it.

## Home Screen icons

The SVG in `public/` is the source. `npm run icons` regenerates the 192 and 512 pixel, maskable 512 and Apple 180
pixel PNGs; keep the generated files in git.

## Repositories, channels and releases

Development happens in [tvstuffs/Arrview-Dev](https://github.com/tvstuffs/Arrview-Dev); releases are published from
[tvstuffs/ArrView](https://github.com/tvstuffs/ArrView). Both use the same workflow, which publishes
`ghcr.io/tvstuffs/arrview` for `linux/amd64` and `linux/arm64` after the tests pass:

| Source | Published tags |
| --- | --- |
| `Arrview-Dev` `main` push, or a manual run on a branch | `dev`, `dev-sha-<full-commit>` |
| `ArrView` `main` push, or a manual run on `main` | `latest`, `release-sha-<full-commit>` |
| `ArrView` `v*` tag | that tag (for example `v2.0`) and `release-sha-<full-commit>`; does not move `latest` |

A push that changes only documentation (`*.md` files and `docs/`) runs the tests but builds no image. Forks never
publish. Pin an image digest if you need the exact bytes: rebuilding the same commit can pick up newer base layers.

**Publishing setup.** In the `arrview` package's settings on GitHub, under **Manage Actions access**, both
repositories need **Write** access. The workflows use their built-in `GITHUB_TOKEN`. The package must be public for
anonymous pulls.

**Promoting a release.** The release repository gets one commit whose tree is exactly the tested Dev commit's tree
(not a merge of Dev's history): fetch Dev's `main`, `git read-tree -u --reset FETCH_HEAD`, check that `git write-tree`
equals the Dev commit's tree, then commit and push `main`, and tag it `v<version>`.

## Release checklist

1. Record the current `latest` digest. Push to Dev and confirm `dev` and its `dev-sha-*` tag moved while `latest` did
   not.
2. Run `docker buildx imagetools inspect ghcr.io/tvstuffs/arrview:dev` and check the `linux/amd64` and
   `linux/arm64` manifests (extra attestation manifests are normal).
3. On an arm64 and an amd64 host, pull and recreate a test install. Check start-up, the pages, the identify answer and
   the connected apps. Save settings, recreate the container and check they are still there.
4. Use the iPhone app through the test server, then check Connect Directly still works. Use a physical device for
   discovery on the local network: the iOS Simulator does not implement local network privacy.
5. Promote to the release repository and check that only `latest` and its `release-sha-*` tag moved, not `dev`. A
   `v*` tag publishes that version without moving either channel.
6. Switch the test install back to `latest`, pull and recreate, and check it starts with its existing settings.

## Screenshots

The README's screenshots in `docs/screenshots/` were taken in Edge from a demo library: real Sonarr and Radarr
metadata for well-known shows and movies, with the download state (files, queue, history) staged. They are
1600 pixels wide for desktop and 600 for phones, saved as JPEG.
