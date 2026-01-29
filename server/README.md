# Server

Go backend for sync and static hosting. Endpoints match `docs/protocol-spec.md`.

## Run

```
./scripts/run-local.sh
```

## Configuration

Required environment variables:

- `OIDC_ISSUER_URL`
- `OIDC_CLIENT_ID`
- `OIDC_REDIRECT_URL`

Optional:

- `SERVER_AUTH_MODE` (`dev` to bypass OIDC and force a fixed user id)
- `SERVER_DEV_USER_ID` (default `dev-user` when `SERVER_AUTH_MODE=dev`)
- `OIDC_CLIENT_SECRET`
- `SERVER_SESSION_KEY` (base64 or >=32 chars; defaults to random per startup)
- `SERVER_COOKIE_SECURE` (default `true`, set to `false` for http dev)
- `SERVER_COOKIE_DOMAIN`

## Build and Lint

```
cd server
make build
make lint
```

## Endpoints

- `GET /auth/login`
- `GET /auth/callback`
- `POST /auth/logout`
- `GET /sync/bootstrap`
- `POST /sync/push`
- `GET /sync/pull`
- `GET /healthz`
