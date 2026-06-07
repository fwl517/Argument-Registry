# Political Society Argument & Source Database Engine

A self-hosted catalogue for a political society's arguments, evidence and source
material. Members record entries (studies, articles, statistics, policy papers),
tag them by stance and party/source, attach a link or upload a file, and connect
entries into a **clash map** of how arguments counter, rebut, evidence or update
one another. A public view exposes non-private entries; everything else is
members-only. While this app is specifically designed for political societies, it will work well for all argument or source tracking purposes.

The stack is deliberately lightweight: a Node/Express + PostgreSQL API and a
**vanilla** HTML/CSS/JavaScript frontend with **no build step and no frameworks**.

---

## Contents

- [Architecture](#architecture)
- [Prerequisites](#prerequisites)
- [Setup](#setup)
- [Environment variables](#environment-variables)
- [Running](#running)
- [Project structure](#project-structure)
- [API overview](#api-overview)
- [Roles & permissions](#roles--permissions)
- [Security model](#security-model)
- [A note on this build](#a-note-on-this-build)

---

## Architecture

**Backend** — Express 4 on Node 20+, PostgreSQL 15+ via `pg`. Passwords are
hashed with Argon2id. File uploads are handled by Multer and stored on disk
*outside* the web root, served back only through an authenticated, access-checked
route. Sessions are opaque IDs held in a database table and referenced by an
`HttpOnly`, `Secure`, `SameSite=Strict` cookie.

**Frontend** — Static HTML pages under `public/`, styled with two hand-written
CSS files and driven by ES-module JavaScript. There is no bundler; the browser
loads the modules directly. Party/source colours are **not** hardcoded — they are
fetched from the API and applied at runtime, keeping the `sources` table the
single source of truth.

**Anonymisation** is enforced on the server. The raw `uploader_id` never leaves
the API; entries marked anonymous are returned as "Anonymous Member".

---

## Prerequisites

- **Node.js 20 or newer**
- **PostgreSQL 15 or newer** (the schema uses `gen_random_uuid()` from the
  built-in `pgcrypto`/`pg_catalog`, deferred constraint triggers and enum types)
- A POSIX-like shell for the setup commands below

---

## Setup

```bash
# 1. Install dependencies
npm install

# 2. Create the database and an application role (example)
createdb political_society
#   …or with psql:
#   CREATE DATABASE political_society;
#   CREATE USER psdb_app WITH PASSWORD '…';
#   GRANT ALL PRIVILEGES ON DATABASE political_society TO psdb_app;

# 3. Configure the environment
cp .env.example .env
#   Edit .env — set DATABASE_URL and FILE_STORE_PATH at minimum.

# 4. Create the schema (tables, enums, triggers, seed sources)
npm run migrate
#   (this runs: psql "$DATABASE_URL" -f db/schema.sql)
#   Ensure DATABASE_URL is exported in your shell, or run psql directly.

# 5. Make the file-store directory and ensure the app can write to it
mkdir -p "$(grep '^FILE_STORE_PATH' .env | cut -d= -f2-)"

# 6. Seed the single Root account (prints a one-time temporary password)
npm run seed-root
#   Optionally pass a username:  node scripts/seed-root.js chair

# 7. Start the server
npm start
```

Then open `http://localhost:3000/` for the public view, or `/login.html` to sign
in. The Root account's temporary password is shown **once** by step 6 — sign in
with it and you will be required to set a new password immediately.

The schema seeds 13 UK party/source presets (with badge colours) and these
cannot be deleted. Additional sources can be added from the entry form.

---

## Environment variables

| Variable          | Required | Description                                                                 |
|-------------------|----------|-----------------------------------------------------------------------------|
| `DATABASE_URL`    | yes      | PostgreSQL connection string.                                               |
| `FILE_STORE_PATH` | yes      | Absolute path for uploaded files. **Must be outside the web root.**         |
| `PORT`            | no       | HTTP port (default `3000`).                                                 |
| `NODE_ENV`        | no       | `production` forces Secure cookies and suppresses verbose errors.           |
| `COOKIE_SECURE`   | no       | In non-production only, set `false` to allow cookies over plain-HTTP local. |

---

## Running

```bash
npm start      # production-style start
npm run dev    # auto-restart on file changes (node --watch)
```

`GET /api/health` returns `{ "status": "ok", "db": "connected" }` when the server
and database are reachable.

---

## Project structure

```
political-society-db/
├── db/
│   └── schema.sql              Full DDL: enums, tables, triggers, procedures, preset seed
├── scripts/
│   └── seed-root.js            One-time Root account creation
├── server/
│   ├── index.js                App entry: security headers, middleware, routes, static
│   ├── config.js               Env loading + central configuration
│   ├── db.js                   pg Pool + query/transaction helpers
│   ├── middleware/
│   │   ├── auth.js             Session loading, RBAC guards, force-reset gate
│   │   ├── errorHandler.js     asyncHandler, HttpError, JSON error responses
│   │   └── upload.js           Multer config (PDF/TXT, 50 MB, UUID filenames)
│   ├── routes/
│   │   ├── auth.js             session / login / logout / change-password
│   │   ├── users.js            user CRUD, force-reset, transfer-crown
│   │   ├── sources.js          list / create party-source records
│   │   ├── entries.js          list+filter, detail+clash map, create/edit/delete, relations
│   │   ├── keywords.js         list / upsert keyword tags
│   │   ├── relations.js        delete a relation
│   │   ├── files.js            upload + access-checked inline file serving
│   │   └── health.js           liveness + DB ping
│   └── utils/
│       ├── password.js         Argon2id hashing + temp-password generation
│       ├── colour.js           hex validation + automatic badge text colour
│       ├── serialise.js        entry serialiser (enforces the anonymisation rule)
│       └── session.js          session creation + cookie helpers
└── public/
    ├── index.html              Public listing
    ├── login.html              Sign in
    ├── dashboard.html          Members' listing
    ├── entry.html              Detail + clash map
    ├── upload.html             New entry
    ├── edit.html               Edit entry
    ├── reset-password.html     Forced password change
    ├── admin.html              Member management
    ├── css/  base.css, components.css
    └── js/   api, utils, auth, modal, search, entries, entry,
              relations, upload, admin, listing, login, reset-password
```

---

## API overview

All endpoints are under `/api`. Errors use the shape
`{ "error": "<CODE>", ... }` (e.g. `VALIDATION` includes a `fields` map).

| Method & path                         | Auth          | Purpose                                  |
|---------------------------------------|---------------|------------------------------------------|
| `GET  /auth/session`                  | any           | Current user (full or reset) or `null`.  |
| `POST /auth/login`                    | none          | Sign in (rate-limited).                  |
| `POST /auth/logout`                   | session       | End the session.                         |
| `POST /auth/change-password`          | session/reset | Change password / complete forced reset. |
| `GET  /entries`                       | optional      | List with filters + pagination.          |
| `GET  /entries/:id`                   | optional      | Detail + 8-category clash map.           |
| `POST /entries`                       | Write+        | Create (multipart).                      |
| `PATCH /entries/:id`                  | Write own/Admin+ | Edit.                                 |
| `DELETE /entries/:id`                 | Admin+        | Delete.                                  |
| `POST /entries/:id/relations`         | Write+        | Add a directional link.                  |
| `DELETE /relations/:id`               | Admin+        | Remove a link.                           |
| `GET  /sources`                       | public        | Party/source list (presets first).       |
| `POST /sources`                       | Write+        | Add a non-preset source.                 |
| `GET  /keywords` · `POST /keywords`   | public / Write+ | List / upsert tags.                    |
| `GET  /users` · `POST /users`         | Admin+        | List / create members.                   |
| `PATCH /users/:id` · `DELETE /users/:id` | Admin+     | Edit / remove members.                   |
| `POST /users/:id/force-reset`         | Admin+        | Issue a new temporary password.          |
| `POST /users/transfer-crown`          | Root          | Hand the Root role to another member.    |
| `POST /files` · `GET /files/:filename`| Write+ / access-checked | Upload / view a stored file.   |
| `GET  /export`                        | optional      | Zip of all visible data (public or member scope). |
| `GET  /export/backup`                 | Root          | Complete database backup (zip).          |
| `GET  /health`                        | public        | Liveness + DB check.                     |

---

## Roles & permissions

Permission ladder: **Read → Write → Admin → Root**.

- **Read** — browse members-only entries.
- **Write** — also create entries/sources/keywords/relations and edit *their own* entries.
- **Admin** — also manage Read/Write members, edit/delete any entry, and remove relations.
- **Root** — the single superuser. Can manage Admins and transfer the Root role.
  There is always exactly one Root; the role moves via **Transfer Crown**, never by
  direct promotion. Admins may only assign Read/Write; only Root may grant Admin.

A separate **society role** (President, General Secretary, Treasurer,
Extended-Committee, Member, Alumni) is descriptive metadata and is independent of
the permission level.

---

## Security model

- **Passwords**: Argon2id (m=64 MiB, t=3, p=4) with a per-hash salt.
- **Sessions**: opaque DB-backed IDs in an `HttpOnly` + `Secure` +
  `SameSite=Strict` cookie (8 h). A forced reset issues a *restricted* 30-minute
  pre-session that only the change-password endpoint accepts.
- **Login anti-enumeration**: unknown user, inactive account and wrong password
  all return an identical `401`.
- **File access**: stored outside the web root with UUID filenames, served only
  through `/api/files/:filename` with a path-traversal guard and the same
  public/private visibility rule as the owning entry; sent `Content-Disposition: inline`.
- **Anonymisation** and the **public/private boundary** are enforced server-side;
  the frontend never receives data it should not show.
- **Headers**: a strict Content-Security-Policy (`default-src 'self'`, no inline
  scripts or styles, `object-src 'none'`, `frame-ancestors 'none'`), `nosniff`,
  `X-Frame-Options: DENY`, and HSTS in production.
- **SQL** is fully parameterised; **login is rate-limited** (10/IP/minute).
- The frontend stores **no** session data in `localStorage`/`sessionStorage`;
  role-gated UI is a convenience only — the API is the sole authority.

Because the CSP forbids external and inline scripts/styles, the UI uses **local
system font stacks** rather than web fonts, and applies all dynamic styling
(e.g. party badge colours) through the CSSOM from JavaScript.

---

## Export & import

Three download modes:

- **Public** (`GET /api/export`, unauthenticated) — every non-private entry,
  along with the sources and keywords they reference and the relations between
  them. Anonymised entries get `uploader: null`; otherwise the uploader is a
  display string (`{ username, role }`). No `uploader_id`, no password hashes,
  no users-table data.
- **Member** (`GET /api/export`, signed in) — same shape, plus private entries
  and files. Anonymisation still applied.
- **Backup** (`GET /api/export/backup`, Root only) — every table verbatim
  (`users` with password hashes, `sources`, `keywords`, `entries`,
  `entry_keywords`, `argument_relations`), plus all stored files. `sessions`
  is excluded so a restore doesn't leave pre-backup logins valid. The result
  is round-trippable into a fresh database via the import script.

Every export is a zip containing `manifest.json` (scope + counts),
`data.json`, and a `files/` directory keyed by basename.

To import:

```bash
npm run import -- /path/to/political-society-public-2026-06-07.zip
```

Public/member imports are additive: sources upsert by name, keywords upsert by
tag, entries always insert as new rows (the foreign export's UUIDs are remapped),
and uploader info lands as a display-only `foreign_uploader_name` /
`foreign_uploader_role` on each entry — no rows are added to the `users` table.

Backup imports require an empty target database (run `npm run migrate` against
a fresh DB but do **not** run `npm run seed-root`) and preserve every UUID,
sequence, and password hash.

## Credits

Built by **Ben Green** — [GitHub](https://github.com/fwl517/Argument-Registry).
Licensed under CC0