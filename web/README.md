# Clover web panel

A read-only admin panel for the Clover bot. Telegram stays where everything happens; this is for looking back: results, the bankroll curve, bets and research.

- **Next.js 16** (App Router). Pages read Firestore on the server; the browser never talks to Firestore.
- **Behind the bot:** the panel runs next to the bot in one container; see Deploying.
- **Sign-in:** Google via Auth.js, limited to the addresses in `src/settings.ts` (`allowedEmails`). Every panel page checks the session before reading data.
- **Data:** the bot's production collections (`bets`, `kv`, …). Capital and paper/live mode come from the settings the bot publishes to `kv/settings` on every start.

## Secrets

Environment variables are secrets only:

| Secret | Where to get it |
|---|---|
| `AUTH_SECRET` | Any long random string: `openssl rand -base64 32` |
| `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET` | The OAuth client created below |

For deployment they go in GitHub secrets, next to the bot's. For local runs, put them in `web/.env.local`.

## Google OAuth client (one time)

In the Google Cloud console for `fl-clover`, open **Google Auth Platform**:

1. **Branding:** set an app name (e.g. "Clover") and your support email.
2. **Audience:** choose *External*, keep it in *Testing*, and add **ibikidsfc56@gmail.com** as a test user. Testing mode already limits sign-in to test users, as a second lock on top of `allowedEmails`.
3. **Clients → Create client:** choose *Web application*, then add these **Authorized redirect URIs**:
   - `https://clover-uhkg4fo2na-od.a.run.app/api/auth/callback/google`
   - `http://localhost:3000/api/auth/callback/google` (for local runs)
4. Copy the client ID and secret into `AUTH_GOOGLE_ID` and `AUTH_GOOGLE_SECRET`.

## Running locally

```bash
bun install
bun run dev
```

Firestore access uses your gcloud login (`gcloud auth application-default login`), and it reads **production** data, since the panel only reads.

## Deploying

The panel ships in the **same container and Cloud Run service as the bot** (`clover`), so it lives at the bot's address: https://clover-uhkg4fo2na-od.a.run.app. The root `Dockerfile` builds both, and `start.sh` runs the bot on the public port with the panel on `127.0.0.1:3000`. The bot answers `/telegram`, `/jobs/*` and `/health` and passes everything else to the panel (`src/lib/panel-proxy.ts`).

`.github/workflows/deploy-cloudrun.yml` deploys on any push to `main` touching the bot or `web/`. Deploying the panel restarts the bot too: a scan in progress is interrupted, and the bot tells you so on Telegram.

Locally, run the bot (`bun run dev` in the repo root) and the panel (`bun run dev` in `web/`) side by side. Open the panel directly at http://localhost:3000, or through the bot's port the same way production does.
