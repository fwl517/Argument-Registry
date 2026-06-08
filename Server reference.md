# Server reference

Two separate processes need to be running for the site to work. They live on
the same machine but in different services and on different ports.

## The two servers

### PostgreSQL — the database

A standalone system service installed at the OS level. It listens on
**port 5432** and only accepts local connections (the default). The actual
data files sit somewhere like `/var/lib/postgresql/15/main` on Linux — you
never edit those by hand; you talk to PostgreSQL through `psql` or `pg_dump`.

**Lifecycle (Linux / systemd):**

```bash
sudo systemctl start postgresql       # start it
sudo systemctl stop postgresql        # stop it
sudo systemctl restart postgresql     # restart it
sudo systemctl status postgresql      # is it alive?
sudo systemctl enable postgresql      # start on boot (set once)
```

**Talking to it** (using the connection string from `.env`):

```bash
source .env && psql "$DATABASE_URL"                       # interactive shell
psql "$DATABASE_URL" -c "SELECT count(*) FROM entries;"   # one-shot query
psql "$DATABASE_URL" -f db/schema.sql                     # run a SQL file
pg_dump "$DATABASE_URL" > backup.sql                      # raw backup
```

Inside `psql`: `\dt` lists tables, `\d entries` describes a table, `\q` quits.

### Node.js webserver — the app we wrote

This is the code in this repo. The entry file is `server/index.js`. It runs
as a normal user process (not a system service), listens on **port 3000**,
serves the static frontend from `public/`, and handles `/api/*` requests.

It connects to PostgreSQL using the `DATABASE_URL` from `.env`. The connection
pool lives in `server/db.js`.

**Lifecycle** (from the project folder):

```bash
npm install                 # install dependencies (one-time / after updates)
npm start                   # production-style run, no auto-reload
npm run dev                 # dev mode, restarts on file changes (node --watch)
```

The server keeps running until you `Ctrl+C` it or close the terminal. It
needs PostgreSQL to be running already, otherwise every API call will 500.

**Maintenance commands** (one-shot scripts — don't start the webserver):

```bash
npm run migrate                            # apply db/schema.sql to the DB
npm run seed-root                          # create the initial Root account
npm run import -- /path/to/export.zip      # restore from an /api/export zip
```

These all talk to PostgreSQL directly via the same `DATABASE_URL`.

## How the two wire together

```
┌────────────────┐  HTTP/HTTPS (port 3000)   ┌─────────┐
│  Browser       │ ────────────────────────► │  Node   │
│  (any device)  │ ◄──────────────────────── │  app    │
└────────────────┘                            └────┬────┘
                                                   │  TCP (port 5432)
                                                   │  DATABASE_URL from .env
                                                   ▼
                                             ┌──────────┐
                                             │ Postgres │
                                             └──────────┘
```

- The browser only talks to Node. It never reaches PostgreSQL directly.
- Node talks to PostgreSQL using the credentials in `.env`.
- `GET /api/health` will tell you which side is broken — it returns
  `{ "status": "ok", "db": "connected" }` when both are alive.

## Typical startup sequence after a reboot

1. PostgreSQL starts automatically (because `systemctl enable postgresql`
   was set during installation).
2. Open a terminal in the project folder and run `npm run dev` (or
   `npm start` for production).
3. Hit `http://localhost:3000/api/health` to confirm both services are up.

## Shutdown / restart cheat sheet

| Want to…                                | Run                                                  |
|----------------------------------------|------------------------------------------------------|
| Just restart the webserver (common)    | `Ctrl+C` in its terminal, then `npm run dev` again   |
| Restart PostgreSQL                      | `sudo systemctl restart postgresql`                  |
| Stop everything                         | `Ctrl+C` the Node app, then `sudo systemctl stop postgresql` |
| Check what's listening on port 3000     | `lsof -i:3000`                                       |
| Check PostgreSQL is up                  | `sudo systemctl status postgresql` or `pg_isready`   |
| Tail PostgreSQL logs (Linux default)    | `sudo journalctl -u postgresql -f`                   |

## How `npm` knows what to run

`npm` is the generic Node package manager — it doesn't know about
`server/index.js` on its own. The mapping lives in this project's
`package.json` under `scripts`:

```json
"scripts": {
  "start":     "node server/index.js",
  "dev":       "node --watch server/index.js",
  "migrate":   "psql \"$DATABASE_URL\" -f db/schema.sql",
  "seed-root": "node scripts/seed-root.js",
  "import":    "node scripts/import.js"
}
```

When you run `npm start`, npm looks at the local `package.json`, finds
`scripts.start`, and executes its value as a shell command — literally
`node server/index.js` in our case. Same for the others.

**Special vs. ordinary script names:** a handful of names — `start`, `test`,
`stop`, `restart` — can be invoked without the `run` keyword. Everything
else needs `run`:

```bash
npm start          # works (special name)
npm run start      # also works
npm run dev        # required — "dev" isn't special
npm dev            # doesn't work
```

`npm run` with no name listed lists every defined script and its command —
handy for remembering what's available.
