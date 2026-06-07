# Political Society Database — Complete Guide

A plain-English manual for installing, using and maintaining the Political
Society Argument & Source Database, written for someone who has never set up a
piece of software before. No prior knowledge is assumed.

This guide is meant to let the system be run and looked after **without the
original creator present**. Keep it somewhere safe alongside the project files.

---

## Contents

1. [What this system actually is](#1-what-this-system-actually-is)
2. [The big picture before you start](#2-the-big-picture-before-you-start)
3. [Part A — Installing the system, step by step](#part-a--installing-the-system-step-by-step)
4. [Part B — Where everything is stored](#part-b--where-everything-is-stored)
5. [Part C — Backing up and restoring (read this)](#part-c--backing-up-and-restoring-read-this)
6. [Part D — Inviting other societies (groups)](#part-d--inviting-other-societies-groups)
7. [Part E — Customisation](#part-e--customisation)
8. [Part F — Keeping it running and fixing problems](#part-f--keeping-it-running-and-fixing-problems)
9. [Glossary](#glossary)

---

## 1. What this system actually is

It is a private website your society runs on its own computer. Members log in
and record "entries" — studies, articles, statistics, policy papers and so on.
Each entry is tagged by stance and by party/source, can have a web link or an
attached PDF/TXT/PNG/etc. file, and can be connected to other entries to build a "clash
map" showing how arguments counter, rebut, evidence or update one another.

There is a **public view** that shows only the entries marked public, and a
**members-only view** (after logging in) that shows everything.

The website is not hosted by an outside company. It runs on a computer you
control, which means somebody in the society has to install it once and keep
that computer running. This guide covers exactly that.

---

## 2. The big picture before you start

The system is made of three things that must all be present on the same
computer:

1. **Node.js** — the engine that runs the website's program. You install this.
2. **PostgreSQL** — the database that stores all the members, entries and tags.
   You install this separately. (The uploaded PDF/TXT/PNG/etc. files are *not* kept in
   the database; they sit in a folder on disk — see [Part B](#part-b--where-everything-is-stored).)
3. **The project files** — the actual code for this system, which you already
   have (the folder containing the README).

You install Node.js and PostgreSQL once, then point the project files at the
database and start it. After that, day-to-day use is just opening a web browser.

**Where should it run?** You have two realistic options:

- **A spare always-on computer or a rented server.** Best choice. The website is
  only available while this computer is switched on and the program is running,
  so for a society that wants the database reachable at any time, a machine that
  stays on is ideal.
- **Your own laptop, just to try it out.** Fine for testing, but the site
  disappears whenever the laptop sleeps or shuts down, and only people on the
  same network can reach it. Use this to learn, not as the society's permanent
  home.

This guide assumes you are working directly on the computer that will run the
system.

---

## Part A — Installing the system, step by step

You will type commands into a **terminal** (also called a "command line" or
"shell"). This is a text window where you type instructions and press Enter.

- **Windows:** press the Start button, type `PowerShell`, and open it.
- **macOS:** open the `Terminal` app (in Applications → Utilities, or search
  with Spotlight).
- **Linux:** open your `Terminal` application.

When the guide says "run" a command, it means type it and press Enter. Lines
starting with `#` are comments explaining what's happening — you don't type
those.

### Step 1 — Install Node.js (version 20 or newer)

Go to the official Node.js website at `https://nodejs.org` and download the
**LTS** version (the recommended one). Run the installer and accept the
defaults.

To confirm it worked, open a fresh terminal and run:

```bash
node --version
```

You should see a number like `v20.x.x` or higher. If you see `v18` or lower, or
an error, install the newer version before continuing.

### Step 2 — Install PostgreSQL (version 15 or newer)

PostgreSQL is the database. Install it from `https://www.postgresql.org/download/`
and pick your operating system.

- **Windows / macOS:** download the installer and run it. During setup it asks
  you to choose a password for the main database user (called `postgres`).
  **Write this password down and keep it safe** — you will need it. Leave the
  port at the default `5432`.
- **macOS (alternative):** if you use Homebrew, `brew install postgresql@15`
  then `brew services start postgresql@15`.
- **Linux (Debian/Ubuntu):** `sudo apt update && sudo apt install postgresql`,
  then it usually starts on its own.

Confirm it is running:

```bash
psql --version
```

You should see `psql (PostgreSQL) 15.x` or higher. `psql` is the tool you use to
talk to the database from the terminal.

> If `psql` is "not recognised" on Windows, the installer's `bin` folder isn't
> on your system PATH. The simplest fix is to use the "SQL Shell (psql)"
> shortcut the installer created in the Start menu, or search online for "add
> PostgreSQL bin to PATH Windows" for your version.

### Step 3 — Get the project files in place

Put the project folder (the one containing `README.md`, the `server` folder, the
`public` folder, and so on) somewhere sensible, for example your home directory.
Then, in the terminal, move *into* that folder. "Move into" is done with the
`cd` ("change directory") command:

```bash
cd path/to/political-society-db
```

For example on Windows it might be `cd C:\Users\YourName\political-society-db`,
and on macOS/Linux something like `cd ~/political-society-db`. From here on, run
every command from inside this folder. You can confirm you're in the right place
by running `ls` (macOS/Linux) or `dir` (Windows) and checking you can see
`README.md` and a `package.json` file.

### Step 4 — Install the system's building blocks

This downloads the extra pieces of software the program depends on (Express,
the PostgreSQL driver, and so on). Run:

```bash
npm install
```

This needs an internet connection and may take a minute. When it finishes you
will have a new `node_modules` folder. You only do this once (and again after
any update to the project).

### Step 5 — Create the database and a database user

The program needs a database to store everything in, and a username/password to
connect with. We'll create both.

Open the PostgreSQL shell. On Windows use the "SQL Shell (psql)" Start-menu
shortcut and press Enter through the prompts (it'll ask for the `postgres`
password from Step 2). On macOS/Linux run:

```bash
psql -U postgres
```

Then, at the `postgres=#` prompt, type these lines one at a time (choose your
own strong password in place of `CHOOSE_A_PASSWORD`, and keep it safe):

```sql
CREATE DATABASE political_society;
CREATE USER psdb_app WITH PASSWORD 'CHOOSE_A_PASSWORD';
GRANT ALL PRIVILEGES ON DATABASE political_society TO psdb_app;
\c political_society
GRANT ALL ON SCHEMA public TO psdb_app;
\q
```

The last line, `\q`, quits the shell. You now have:

- a database called **political_society**
- a user called **psdb_app** with the password you chose

### Step 6 — Configure the system (the `.env` file)

The system reads its settings from a file called `.env` (pronounced "dot env").
There's an example provided. Copy it to create your real one:

```bash
# macOS / Linux
cp .env.example .env

# Windows PowerShell
Copy-Item .env.example .env
```

Now open `.env` in a plain text editor (Notepad, TextEdit in plain-text mode, or
VS Code) and set the values. Here's what each line means:

| Setting | What to put | Notes |
|---|---|---|
| `DATABASE_URL` | `postgresql://psdb_app:CHOOSE_A_PASSWORD@localhost:5432/political_society` | The connection string. Use the username, password, and database name from Step 5. `localhost:5432` means "the PostgreSQL on this same computer". |
| `FILE_STORE_PATH` | An absolute folder path, e.g. `/home/yourname/ps-files` (mac/Linux) or `C:\ps-files` (Windows) | Where uploaded files are saved. **Must be outside the project folder.** |
| `PORT` | `3000` | The "door number" the website uses. Leave at 3000 unless it clashes with something. |
| `NODE_ENV` | leave blank for now, or `production` once live | `production` tightens security and hides detailed error messages. |
| `COOKIE_SECURE` | `false` *only* while testing on a plain local machine | On a real site served over HTTPS, leave this unset. |

Save and close the file. **`DATABASE_URL` and `FILE_STORE_PATH` are the two you
must set; the rest can stay at defaults.**

A real `.env` file holds your database password, so never share it, never put it
in a public place, and never upload it anywhere.

### Step 7 — Build the database structure

The database exists but is empty. This command creates all the tables, the 13
preset UK party/source presets, and the two seeded groups (the **home group**
that will be your own society, and an **Independent** catch-all group for
unaffiliated members):

```bash
npm run migrate
```

If that gives an error about `DATABASE_URL` not being found, your terminal
hasn't been told the connection string. The reliable alternative is to run the
schema file directly, pasting in the same connection string you put in `.env`:

```bash
# macOS / Linux
psql "postgresql://psdb_app:CHOOSE_A_PASSWORD@localhost:5432/political_society" -f db/schema.sql

# Windows: use the SQL Shell, connect to political_society, then:
\i db/schema.sql
```

### Step 8 — Create the uploads folder

Make the folder you named in `FILE_STORE_PATH` so the program has somewhere to
save files:

```bash
# macOS / Linux (matches the path in your .env)
mkdir -p /home/yourname/ps-files

# Windows
mkdir C:\ps-files
```

Make sure the path here is exactly the same as `FILE_STORE_PATH` in `.env`.

### Step 9 — Create the Root (head administrator) account

The "Root" account is the single all-powerful account that runs everything else.
Create it:

```bash
npm run seed-root
```

This prints a **one-time temporary password** in the terminal. **Copy it
immediately and keep it safe** — it is shown only once. You can optionally name
the account, e.g. `node scripts/seed-root.js chair` to call it "chair".

The Root account is automatically placed in the home group seeded by Step 7.
Once you sign in for the first time, you can rename the home group to your
actual society name and pick a pill colour — find the **Manage groups** panel
on the admin page (Root-only).

### Step 10 — Start the website

```bash
npm start
```

You should see a message that the server is running. Leave this terminal window
open — closing it stops the website.

### Step 11 — Open it in a browser

In a web browser on the same computer, go to:

```
http://localhost:3000/
```

That's the public view. To sign in, go to:

```
http://localhost:3000/login.html
```

Log in with the Root username (default is shown by Step 9, or whatever you
named it) and the temporary password from Step 9. You will be **forced to set a
new password immediately**. Choose a strong one and keep it safe. The system is
now ready.

### Step 12 (optional) — Letting others reach it / keeping it always on

While you're learning, `http://localhost:3000` only works on the computer
running it. To let other society members reach it you need either:

- **Same network:** others can use `http://THIS-COMPUTERS-IP:3000` (find the IP
  with `ipconfig` on Windows or `ifconfig`/`ip addr` on mac/Linux). Simple, but
  only works on your local network.
- **Proper hosting:** put it on an always-on server with a real web address and
  HTTPS. This is more involved (a "reverse proxy" such as Nginx or Caddy in
  front, and `NODE_ENV=production`) and is worth getting a technically-minded
  person to help with once. The security model in the README assumes HTTPS in
  production, so don't expose it to the open internet over plain `http`.

To stop the program crashing-and-staying-down or vanishing when you log out of
the server, use a small "process manager" like **PM2**:

```bash
npm install -g pm2
pm2 start npm --name political-society -- start
pm2 save
pm2 startup   # follow the printed instruction to make it survive reboots
```

After that, `pm2 restart political-society` restarts it and `pm2 logs` shows
what it's doing.

---

## Part B — Where everything is stored

This matters enormously for backups, so understand it clearly. **There are two
separate stores.**

**1. The database (members, entries, tags, the clash-map links, sources).**
This lives inside PostgreSQL's own data directory, created when you installed
PostgreSQL — *not* inside the project folder. Typical locations:

- **Linux:** `/var/lib/postgresql/15/main`
- **macOS (Homebrew):** `/opt/homebrew/var/postgresql@15` (Apple Silicon) or
  `/usr/local/var/postgres` (Intel)
- **Windows:** the `data` folder inside the PostgreSQL install, e.g.
  `C:\Program Files\PostgreSQL\15\data`

You normally never touch these files by hand. You back the database up with a
proper command (see Part C), not by copying this folder.

**2. The uploaded files (the PDFs,TXTs,etc. members attach to entries).**
These live in the folder you set as `FILE_STORE_PATH` (e.g. `/home/yourname/
ps-files` or `C:\ps-files`). The database only stores a *reference* to each file;
the file itself is in this folder.

So: a complete backup means backing up **both** the database **and** the
`FILE_STORE_PATH` folder. One without the other is incomplete — you'd have entry
records pointing at files that aren't there, or files nobody can find.

---

## Part C — Backing up and restoring (read this)

If only one section survives this document, let it be this one. Without backups,
a disk failure loses the society's entire archive.

### The easy way: download a backup from the admin page

The system has a built-in backup feature, and it's the recommended one for
day-to-day use. Sign in as **Root**, go to `/admin.html`, and click **Download
backup (zip)**. You get a single `.zip` file containing **everything**:

- every entry, public and private, with all its links, keywords and clash-map
  connections;
- every uploaded file;
- every member account, including password hashes (so people stay signed in
  with their existing passwords after a restore).

Save this `.zip` somewhere safe — ideally on a different machine or an external
drive — and treat it as **secret**, because it contains all the password hashes
and any private entries.

Do this on a schedule. Weekly is the floor for an active society. If somebody
on the committee is comfortable scripting it, `curl` plus a saved cookie can
automate the download; otherwise put a recurring reminder in the calendar of
whoever holds the Root account.

> The backup deliberately leaves out **active login sessions**, so a restore
> never re-activates somebody's old browser session.

### Keep the `.env` too

Keep a private copy of your `.env` somewhere secure (it holds the database
password and settings). Don't store it anywhere public. The backup `.zip`
does *not* include `.env`, because `.env` is unique to each machine.

### Restoring from a downloaded backup

This is how to bring the system up on a fresh machine using a `.zip` you
produced with the Download backup button.

1. Install Node.js and PostgreSQL as in Part A (Steps 1–2).
2. Get the project files in place (Step 3) and run `npm install` (Step 4).
3. Recreate the database and user (Step 5) and your `.env` (Step 6).
4. Create the empty database structure:
   ```bash
   npm run migrate
   ```
   **Do not run `npm run seed-root`** — the backup already contains the Root
   account and the import will fail if a Root already exists.
5. Make sure the `FILE_STORE_PATH` folder exists (Step 8). The import will
   write the uploaded files into it.
6. Run the import, pointing it at your backup file:
   ```bash
   npm run import -- /path/to/political-society-backup-2026-06-07.zip
   ```
   You'll see it report how many users, sources, entries and relations were
   restored.
7. Start the server (`npm start`) and sign in with the same usernames and
   passwords as before. The system is back exactly as it was at the moment of
   backup.

Test this occasionally on a spare machine. A backup you've never restored is
a backup you don't actually know works.

### Manual alternative: pg_dump (advanced)

If you prefer the standard PostgreSQL backup tool, or want to keep a second
independent backup format, you can also use `pg_dump`. This takes a bit more
care because the uploaded files live in a separate folder from the database.

```bash
# 1. The database
pg_dump "postgresql://psdb_app:CHOOSE_A_PASSWORD@localhost:5432/political_society" > backup-2026-06-07.sql

# 2. The uploaded files (macOS / Linux)
cp -r /home/yourname/ps-files /path/to/safe-backup/ps-files-2026-06-07
```

To restore from a `pg_dump`:

1. Install Node.js and PostgreSQL as in Part A.
2. Recreate the database and user (Step 5) and your `.env` (Step 6).
3. Restore the database from your dump (into an empty database — don't run
   `npm run migrate` first):
   ```bash
   psql "postgresql://psdb_app:PASSWORD@localhost:5432/political_society" < backup-2026-06-07.sql
   ```
4. Copy your backed-up files back into the `FILE_STORE_PATH` folder.
5. `npm install`, then `npm start`.

The advantage of `pg_dump` is that it captures the database exactly as
PostgreSQL stores it. The drawback is that you have to remember the uploaded
files separately — forgetting them produces a "restored" system where every
attachment is broken.

---

## Part D — Inviting other societies (groups)

The database supports **multi-society collaboration**. Out of the box you get
a single home group (your society) and a catch-all **Independent** group. To
add a partner society:

1. Sign in as Root and go to `/admin.html`.
2. In the **Manage groups** panel, fill in the partner's name, choose a pill
   colour, and optionally set a **member quota** (a maximum number of active
   accounts that group is allowed). Leave the quota blank for unlimited.
3. Once the group is created, hand its first admin account over to the partner
   by creating a new user with permission **Admin** and the new group selected.
   That partner Admin can then create their own Read/Write members within
   their group, up to the quota.

The partner Admins **cannot** see your home members or anyone else's group;
they can only manage their own roster and their own entries. Only **home-group
Admins** (your society's Admins) can see across every group, promote anyone to
Admin, or move members between groups.

### Archiving and deleting partner groups

When a partnership ends:

- **Archive** the group from the same panel. Archiving freezes the group — no
  new accounts, no edits — while letting existing members still sign in to
  view their historic entries. This is reversible: Root can unarchive at any
  time.
- **Delete** the group if you want to wipe the affiliation entirely. The
  system refuses deletion while the group still has members, so reassign or
  remove them first (Root can move members to the Independent group, or
  delete them outright). The home group itself can never be deleted or
  archived.

A partner backup file (`Download backup` zip, Part C) restored onto a fresh
system carries the full group structure across, including partner Admins and
their accounts.

## Part E — Customisation

To change the basic design elements of the system (such as the logo, colour scheme and society name) some files have to be edited slightly.

### Changing the logo

Simply replace the file `favicon.png` in the `/public/` folder with your desired logo image.
> Note that the file name ***must*** be *exactly* `favicon.png` and the image type must be a `.png`

### Changing the Society Name

Within the `/public/` folder there are a number of `.html` files *(If you cant see any files ending in `.html`, make sure your file explorer's settings are set to 'show file extensions')*. In every one of these files, search and replace *(press `ctrl + h`)*, replacing "society name" with "YOUR SOCIETIES NAME" *(without the quotes)*.

### Changing the Colour Scheme

Inside the `/public/css/` folder there are two files: `base.css` and `components.css`. Simple colour changes can be made by editing `base.css`.

Within this file there are a number of variables which represent different colours, these variables are used throught the design so you only have to change the values here.

The start of the file should look something like this:
```
:root {
  /* — Palette —————————————————————————————————————————————— */
  --parchment:      #F7F4EE;
  --parchment-deep: #EFEAE0;
  --surface:        #FFFDF9;
  --surface-2:      #FBF8F2;

  --ink:            #0B1B3D;  /* deep navy — primary */
  --ink-soft:       #33406A;
  --ink-line:       #2A3656;

  --brass:          #B08D57;  /* accent */
  --brass-deep:     #8A6D3F;
  --brass-soft:     #C8AC7E;

  --text:           #20242E;
  --text-muted:     #5A6472;
  --text-faint:     #8A92A0;

  --border:         #E2DCCF;
  --border-strong:  #D2C9B6;
  --hairline:       rgba(30, 42, 74, 0.12);
  
  ...
}
```

These colours are written as **hexcodes**, you can find websites that will let you pick a colour and show you it's hexcode online. Find a colour you like and copy it's hexcode into the variable you want to change.

The main variable you would most likely want to change are the ones shown above.
- The 'parchment' variables are the main background colours.
- The 'ink' variables are the secondary colours used for heading backgrounds and some title text colours.
- The 'brass' variables are the accent colours, used for outlining and highlighting.

> You're not just limited to changing these variables, you can change any variables you like to make the design fit your society. If you have more in depth knowledge of html/css you can even change more detailed aspects of the design in `components.css`.

---

## Part F — Keeping it running and fixing problems

### Is it alive?

Visit `http://localhost:3000/api/health` (or your address + `/api/health`). A
healthy system replies `{"status":"ok","db":"connected"}`. If you get an error
or no reply, the server or the database is down.

### Common problems

- **The website won't load at all.** The server program probably isn't running.
  Go to the terminal/PM2 and start it (`npm start`, or `pm2 restart
  political-society`).
- **Health check says the database isn't connected.** PostgreSQL may be stopped,
  or `DATABASE_URL` in `.env` is wrong. Start PostgreSQL and re-check the
  connection string (username, password, `localhost:5432`, database name).
- **`npm run migrate` complains about `DATABASE_URL`.** Use the direct `psql ...
  -f db/schema.sql` approach from Step 7 instead.
- **Uploads fail.** The `FILE_STORE_PATH` folder may not exist or the program
  can't write to it. Recreate it (Step 8) and check its permissions. Remember
  uploads must be under 50 MB.
- **"psql is not recognised" (Windows).** Use the "SQL Shell (psql)" shortcut,
  or add PostgreSQL's `bin` folder to your PATH.
- **Locked out as a normal member.** Ask an Admin to "force a password reset".
- **Locked out as the only Root.** This is the hard one — there's no one above
  Root. This is why the Root password and recovery details must be kept with the
  committee. In the worst case a technical person can reset it directly in the
  database, which is involved and risky; avoid ever getting here by keeping the
  credentials safe.

### Updating to a newer version of the project

When the creator (or a successor) provides updated project files:

1. **Back up first** (Part C) — both database and files.
2. Replace the project files, keeping your existing `.env` and the separate
   `FILE_STORE_PATH` folder.
3. Run `npm install` again (dependencies may have changed).
4. If the update includes database changes, apply them as instructed with the
   update; otherwise leave the database as is.
5. Restart the server and check the health endpoint.

### A few security habits

- Run it over **HTTPS** in any real deployment, with `NODE_ENV=production`.
- Never share or expose the `.env` file.
- Keep Node.js and PostgreSQL updated for security fixes.
- Don't put the `FILE_STORE_PATH` folder inside the public website folder.
- Keep the number of Admin accounts small.

---

## Glossary

- **Terminal / shell / command line** — the text window where you type commands.
- **Node.js** — the engine that runs the website's program.
- **PostgreSQL** — the database storing members, entries and tags.
- **Database** — the structured store of all the society's records.
- **`.env` file** — the settings file holding the database connection and paths.
- **`DATABASE_URL`** — the connection string telling the program where the
  database is and how to log into it.
- **`FILE_STORE_PATH`** — the folder on disk where uploaded PDF/TXT/PNG/etc. files live.
- **Schema** — the structure of the database (its tables); created by the
  migrate step.
- **Root** — the single most powerful account; the role moves via Transfer
  Crown.
- **Permission level** — what an account is allowed to do (Read/Write/Admin/Root).
- **Society role** — a descriptive label (President, Treasurer, etc.), separate
  from permissions.
- **Clash map** — the network of directional links between entries.
- **Anonymous entry** — an entry whose author's *name* is hidden as "Anonymous Member". The contributing group is still shown.
- **Group / affiliation** — which society a user belongs to. The home group (your own society) plus any partner groups Root has invited.
- **Home group** — the singular founding-society group. Its Admins reach every account in every group.
- **Member quota** — the maximum number of active accounts a group is allowed. Set by Root per group; unlimited if left blank.
- **Archived group** — a partner group frozen by Root: no new accounts and no edits, but existing members can still sign in.
- **Backup** — a saved copy of the database and files you can restore from.
- **Process manager (PM2)** — a tool that keeps the program running and restarts
  it automatically.
