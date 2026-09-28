# Configuration and operations

## Prerequisites

PWA/server development requires Node.js 22 and npm. Node 22 is required because the server uses `node:sqlite`. Container deployment uses Podman/systemd Quadlet in the checked-in example, though any OCI runtime can run the image.

Android builds require JDK 17, Android SDK 37, and the checked-in Gradle wrapper. The application supports Android 8.0/API 26 and later and targets API 37.

Firebase/AI builds additionally require a Firebase project, an Android Firebase configuration, Firebase CLI, a Gemini API key, and Play Console/Google Cloud setup for paid credits. See [AI relay deployment](17_AI_RELAY_DEPLOYMENT.md).

## Local PWA/server

```bash
npm install
npm start
```

The default listener is `0.0.0.0:3000`; open `http://localhost:3000`. Development auto-reload uses:

```bash
npm run dev
```

The application initializes the database and starter watchlists automatically. With no invite cookie, protected screens show activation. Create invites through the admin API/private console after configuring an admin secret.

## Server environment

The server loads `.env` in the process working directory. Container deployment loads `%h/.config/omaha/omaha.env` through Quadlet.

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3000` | Express listen port |
| `DATA_DIR` | repository `data/` | Directory containing `omaha.db` and WAL files |
| `ADMIN_TOKEN` | none | Required shared secret for admin routes; missing means admin is denied |
| `PUBLIC_BASE_URL` | `https://omaha.zandaulion.com` | Base used to construct invite URLs |
| `REDEEM_MAX_PER_MIN_IP` | `5` | Per-source activation attempts per sliding minute |
| `REDEEM_MAX_PER_MIN` | `60` | Global activation attempts per sliding minute |
| `ALERTS_ENABLED` | enabled | Set to `0` to disable the in-process scheduled worker |
| `VAPID_PUBLIC_KEY` | generated/persisted | Optional fixed Web Push public key |
| `VAPID_PRIVATE_KEY` | generated/persisted | Optional fixed Web Push private key |
| `VAPID_SUBJECT` | `mailto:admin@pocketomaha.app` | Web Push contact URI |
| `GEMINI_API_KEY` | none | Preferred Gemini credential for PWA AI and deployed Functions secret |
| `GOOGLE_API_KEY` | none | PWA fallback name for the Gemini key |
| `GEMINI_MODEL` | `gemini-3.7-flash` | Gemini model name |

Example, with placeholder values:

```dotenv
DATA_DIR=/srv/pocket-omaha
PORT=3000
ADMIN_TOKEN=replace-with-a-long-random-secret
PUBLIC_BASE_URL=https://omaha.example.com
VAPID_SUBJECT=mailto:admin@example.com
GEMINI_API_KEY=replace-me
```

Do not commit `.env`, admin secrets, VAPID private keys, Gemini keys, or a production database.

## Container deployment

`deploy/Containerfile` builds a Node 22 Alpine image, installs production dependencies, copies `core/`, `server/`, and `web/`, and runs as UID/GID 10005 with no root privileges. `/data` is the persistent volume.

```bash
podman build -t localhost/omaha-server:latest -f deploy/Containerfile .
mkdir -p "$HOME/.config/containers/systemd" "$HOME/.config/omaha"
cp deploy/quadlet/omaha-server.container "$HOME/.config/containers/systemd/"
# create $HOME/.config/omaha/omaha.env securely
systemctl --user daemon-reload
systemctl --user enable --now omaha-server.service
```

The example publishes only `127.0.0.1:8095`, drops all Linux capabilities, enables `NoNewPrivileges`, and restarts on failure. Put a TLS reverse proxy in front. Preserve the named volume across image updates.

Back up the SQLite database with a SQLite-aware method while WAL mode is active. Copying only `omaha.db` during a write can omit WAL content; use SQLite backup tooling or stop/quiesce the service first.

## Static PWA deployment

`deploy.sh` copies only `web/` to `DEST` (default `/var/www/omaha`) with `rsync --delete`. It hashes the web tree and substitutes the build hash for `__BUILD_VERSION__`, giving the service worker a deterministic cache name.

```bash
DEST=/var/www/omaha ./deploy.sh
```

This does not deploy the Express API. Use it only when the reverse proxy separately routes `/api` to the server and serves the static directory, or when updating a split deployment. The container serves its own copied `web/` directory and stamps its service worker at runtime through `server/serve-sw.js`.

## Reverse proxy requirements

- Use HTTPS on the public origin so Web Push and service workers work reliably.
- Route the PWA and API under one origin; the server disables cross-origin access.
- Preserve `X-Forwarded-Proto` so secure-cookie selection is correct.
- Do not expose `/api/admin/*` publicly.
- Strip caller-supplied admin headers on the public listener.
- On a private listener, inject `X-Admin-Token` from protected configuration.
- Preserve the real source address in a trusted header if activation throttling should operate per client.

## Administration

The authoritative server contract is `X-Admin-Token: <ADMIN_TOKEN>`. Example:

```bash
curl -fsS \
  -H "X-Admin-Token: $ADMIN_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"label":"Test phone"}' \
  http://127.0.0.1:8095/api/admin/invites
```

`admin.sh` offers `invite`, `invites`, `unvite`, `devices`, `revoke`, `unrevoke`, `forget`, `name`, and `health`. Its current checked-in transport sends the legacy `X-Admin: 1` marker. It works only with the private reverse-proxy configuration that recognizes that marker and injects the real `X-Admin-Token`; it does not authenticate directly to the current Express process. For direct localhost administration, use the token header as above or update the local wrapper without committing the secret.

Manual job endpoints can run a sweep or digest after deployment. They can send real notifications and write history, so use them as operational actions rather than health probes.

## Android configuration

Place the Firebase Android configuration at `android/app/google-services.json`. The package/application ID is `com.zandaulion.omaha`.

Release signing is mandatory in the Gradle configuration. Copy the example and use the existing Play upload key:

```bash
cp android/keystore.properties.example android/keystore.properties
```

The file supplies `storeFile`, `storePassword`, `keyAlias`, and `keyPassword` and is ignored by Git. The build deliberately fails instead of falling back to the debug key. Keep the upload keystore and passwords outside the repository and backed up securely.

Build commands:

```bash
cd android
./gradlew :app:assembleDebug
./gradlew :app:bundleRelease
```

Outputs are normally under:

- `android/app/build/outputs/apk/debug/app-debug.apk`
- `android/app/build/outputs/bundle/release/app-release.aab`

Install a debug APK on a connected device:

```bash
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
```

Use `adb uninstall com.zandaulion.omaha` first only when a clean local database/signing reset is intended. Uninstalling deletes unexported local theses and watchlists.

Before Play upload, increment `versionCode`, set the intended `versionName`, build the signed AAB, run verification, and update `play-store/` descriptions/release notes/screenshots when user-visible behavior changes.

## Firebase callable deployment

The `functions/` package targets Node 22. Set the Gemini secret and build the self-contained callable bundle:

```bash
firebase functions:secrets:set GEMINI_API_KEY
npm run bundle:functions
cd functions
npm install
npm test
npm run deploy
```

`functions/src/` is the source. `functions/lib/index.js` is generated because Firebase uploads the functions directory rather than the monorepo imports. Do not edit the bundle directly.

Configure Google sign-in SHA fingerprints and OAuth clients, deploy the deny-all Firestore rules, create the Play one-time product `omaha_credits_10`, and grant the Functions runtime service account the Play order permissions described in [AI relay deployment](17_AI_RELAY_DEPLOYMENT.md).

## Generated assets

Run generators after their source changes:

```bash
npm run bundle:core       # core/dist/*.bundle.js for QuickJS
npm run bundle:functions  # functions/lib/index.js
npm run tokens            # web/tokens.css and Android Tokens.kt
npm run glossary          # web/Android glossary outputs
python3 tools/render-brand-icons.py
```

The icon script updates repository-native brand outputs. Review every generated asset before release, especially adaptive/maskable icon safe areas.

## Health and troubleshooting

- `GET /api/health` confirms only process availability.
- A 401 on protected PWA calls means the cookie/token is missing, unknown, or revoked.
- A 403 on admin calls usually means `ADMIN_TOKEN` is absent or the proxy did not inject it.
- A 503 with `kind: rate_limited` means wait; do not loop through more tickers.
- A PWA stuck on old code can visit `/bust`, then reopen the app.
- If Android shows a crash trace screen, copy the trace; the next launch proceeds normally.
- If alerts do not display, check OS permission/channel settings, then the app's category toggles and recent alert history.
- If AI generation is unavailable, distinguish sign-in, zero credits, Firebase configuration, Gemini secret, and Play product setup; cached notes-free analysis can still work without sign-in.
