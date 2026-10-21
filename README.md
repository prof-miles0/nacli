# Nacli

Web dashboard for [Dragonite](https://github.com/UnownHash/Dragonite-Public),
[RotomNG](https://github.com/UnownHash/RotomNG) and Golbat stacks, styled after
the Dragonite admin. One page for every stack: its state, its devices on a map,
its areas, accounts, proxies, modes and scheduler, with its own login and
historical charts.

## Getting started

```bash
cp config.example.toml config.toml   # edit users and instances
npm install
npm run build
npm start                            # http://localhost:7080
```

Development with hot reload (frontend on :5173, API on :7080):

```bash
npm run dev
```

## Docker

Every push to `main` publishes an image to GitHub Container Registry
(`linux/amd64` and `linux/arm64`), built by `.github/workflows/docker.yml`:

```bash
docker run -d --name nacli -p 7080:7080 \
  -v $PWD/config.toml:/app/config/config.toml:ro \
  ghcr.io/prof-miles0/nacli:latest
```

Or with Docker Compose:

```yaml
services:
  nacli:
    image: ghcr.io/prof-miles0/nacli:latest
    restart: unless-stopped
    ports:
      - "7080:7080"
    volumes:
      - ./config.toml:/app/config/config.toml:ro
```

Tags: `latest` (main), `sha-<commit>`, and `1.2.3` / `1.2` for a `v1.2.3` git tag.
Keep `listen = "0.0.0.0:7080"` in `config.toml` (the default) so the container is
reachable, and set a fixed `session_secret` so sessions survive restarts.

To build it yourself: `docker build -t nacli .`

## config.toml

- `[server]`: port, title, session duration and polling interval.
- `[victoriametrics]` (optional): source for the charts, up to 30 days.
  Without this section, the dashboard keeps `history_retention` (24 h) in memory:
  for RotomNG, from what it already polls; for each Dragonite with a `url`, by
  reading its `/metrics` every 30 s (about 8 MB per instance). Dragonite charts
  use the same PromQL queries in both cases (`server/promql.ts` evaluates them
  in memory). Golbat requires VictoriaMetrics.
- `[golbat]` (optional, requires `[victoriametrics]`): enables the Golbat section
  (Metrics and a block on the Dashboard). `selector` filters its series, e.g.
  `instance="golbat"`. The charts come from its Grafana dashboard and are
  defined in `server/golbat.ts`.
- `[golbat]` with `url` and `api_secret`: the Dashboard shows a map at the top with
  the last location of each device (Golbat's `/api/devices/all`, with the
  `X-Golbat-Secret` header), matched to its Rotom device and its Dragonite area
  and worker. Does not require VictoriaMetrics.
- `[map]`: background for that map (MapLibre GL). `style_url` for vector tiles
  or `tiles_url` for raster; `carto_key` is appended as `api_key` to CARTO
  URLs, and `tiles_attribution` is the attribution shown. The browser
  downloads tiles directly from CARTO.
- `[[users]]`: one block per user (`username` / `password`).
- `[[stack]]`: one block per deployment, with its `name` and two subtables:
  - `[stack.rotom]`: `url` (root of the `http_listener`, **without** `/api`),
    `api_secret` (its `http_listener.secret`), `vm_instance` (its `instance` in
    VictoriaMetrics, required) and, optionally, `headers` and `basic_auth`. `url = "demo://something"` generates sample data.
  - `[stack.dragonite]` (optional, requires `[victoriametrics]`): `vm_instance`
    (its `instance` in VictoriaMetrics) and the `url` of its API. Enables the
    Dragonite section: Metrics (charts from `server/dragonite.ts`) and, with `url`, Areas
    (`v2/areas` + `status`, with workers linked to their Rotom device)
    and Accounts (`accounts/stats`, `accounts/level-stats`, `v2/accounts`, without
    exposing passwords or tokens). The dashboard checks that the controllers of
    that Dragonite reach the Rotom in the same stack: their user agent names it
    ("Dragonite - <name>").

Changes to `config.toml` are applied automatically on save (or with `kill -HUP`).

## How it works

- The backend (`server/`, Node + Hono) polls each instance every `poll_interval`
  (`/api/status`, `/api/config` and, every 3 polls, `/api/metrics`) and stores the
  latest state. Charts are requested from VictoriaMetrics (`query_range`)
  when configured; otherwise an in-memory history is used.
- The browser never talks to RotomNG directly: instance secrets stay on the
  server. Actions (restart device, disconnect controller, jobs…) go through
  `/api/rotom/<id>/…`, restricted to an allowlist of routes.
- Session: `HttpOnly` cookie signed with `session_secret`; requests that
  modify anything also require the `X-Nacli` header. Login is limited to 10
  failed attempts per 5 minutes per IP.

## Tabs

- **Dashboard**: map with each device's last location (and the geofences of the
  enabled areas, in each stack's colour; click one to see its controllers'
  trails), accounts, Dragonite and Rotom overviews.
- **Status**: per Dragonite, whether Kōji and Golbat are connected, its global
  rate limit and why it dropped, and whether Dragonite and RotomNG are up to
  date; plus its controls (pause/reset the rate limit, reload proxies, accounts
  or Dragonite).
- **Dragonite**: Accounts (create, import, and a warning for accounts in more
  than one stack), Areas (create, edit, enable, copy or move between stacks),
  Unbound Modes (Level, Invasion and Scout), Proxies (every stack together),
  Scheduler (schedules, groups and run ledger) and Metrics.
- **Rotom**: Instances, Devices, Workers, Jobs and Metrics.
- **Golbat**: Metrics.

Sections only appear for what `config.toml` configures.
