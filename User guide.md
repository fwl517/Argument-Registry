## Part A — Using the system (end-user guide)

This section is for ordinary members. It's based on the features the system
provides; the exact wording of buttons may vary slightly.

### Understanding roles

There are *three* separate things, and people mix them up:

- **Permission level** — what you're *allowed to do*: **Read → Write → Admin →
  Root**, each one able to do everything the one before can, plus more.
  - **Read:** browse members-only entries.
  - **Write:** also create entries, sources, keywords and links, and edit *your
    own* entries.
  - **Admin:** also manage Read/Write members **of your own group**, edit or
    delete entries belonging to your group, and remove links.
  - **Root:** the single head administrator — manages every group, every
    account, and can hand the Root role to someone else.
- **Society role** — a *label* describing your position (President, General
  Secretary, Treasurer, Extended-Committee, Member, Alumni). This is just
  descriptive and has nothing to do with what you can technically do.
- **Group / affiliation** — which society you belong to. The home society (the
  one that runs the system) and any partner societies that have been invited
  on. Your group is shown as a coloured pill next to your name. Your group
  determines what an Admin can reach: **partner-society Admins can only
  manage their own group's members**, while **home-society Admins can reach
  every account in every group**.

So someone can be "Treasurer" (society role) with "Write" permissions in the
"Liberal Democrats Society" group — three independent attributes.

### Logging in and your first password

Go to `/login.html` and enter the username and temporary password an admin gave
you. The first time, you'll be required to set your own password before you can
do anything else. Choose something strong and don't reuse it elsewhere.

For security, the login screen gives the same "unauthorised" message whether the
username is wrong, the password is wrong, or the account is disabled — so a
failed login won't tell you which part was wrong. Double-check both.

### Managing your own account

Click your name in the top-right of any page to reach `/account.html` — a
small settings page where you can:

- **Change your username.** This is the display name shown alongside your
  contributions. It must still be unique across the whole platform; if the
  name you pick is already taken, the system will tell you.
- **Change your password.** Enter your current password, then a new one
  (12 characters minimum), then confirm. Saving signs you out of every
  *other* browser or device you're logged in on — the current one stays
  active.

Your permission level (Read/Write/Admin/Root), society role
(President/Treasurer/etc.) and group affiliation are all set by an
administrator — you can see them on the page header but can't change them
yourself. If you need any of those updated, ask an Admin.

### Browsing entries

- The **public page** (`/`) shows only entries marked public.
- After logging in, the **dashboard** shows all entries, public and private.

Each entry shows its stance and a coloured badge for its party/source. Those
badge colours come from the system's source list, so they're consistent
everywhere.

### Searching and filtering

The listing pages let you filter and search (by source, stance, keyword and so
on) and page through results. Use this to find existing material before adding
something new, to avoid duplicates.

### Creating a new entry

You need **Write** permission or higher. Go to the upload/new-entry page
(`/upload.html`). You'll typically provide:

- A title and the content/summary of the argument or source.
- Its **stance** (its position on its *own* topic — Pro / Con / Neutral) and the
  **party/source** it comes from.
- Its **society alignment** — where it sits relative to *our* society: **Aligned**
  (agrees with us), **Opposed** (against us), or **Neutral**. This is separate from
  stance, and it's what lets you spot topics where the opposing material outweighs
  ours and we still need to upload counter-arguments.
- Either a **web link** or an **attached file** (PDF/TXT/PNG/etc., up to 50 MB).
- **Keywords/tags** to make it findable.
- Whether it's **public or private**, and whether it's **anonymous**.

If you mark an entry **anonymous**, your *identity* is hidden from everyone —
it shows as "Anonymous Member". Your **group affiliation** is still shown
("Anonymous Member · Liberal Democrats Society"), because the value of the
shared database comes from knowing which society contributed which material.
The identity-hiding is enforced by the server, so your name truly doesn't
reach other people's browsers, not even hidden in the page.

### Adding a source that isn't in the list

The system comes with 13 preset UK party/source options that can't be deleted.
If you need a source that isn't listed, you can add a new one from the entry
form (Write permission needed). New sources get their own badge colour.

### The clash map (linking entries together)

The point of the system is connecting arguments. On an entry's detail page
(`/entry.html`) you can create a **directional link** from this entry to another
— saying, for example, that this entry *rebuts* or *evidences* or *updates*
another. These links build up into the clash map, an eight-category picture of
how the arguments relate. Write permission lets you add links; removing a link
needs Admin.

### The clash-map graph (visual network)

The catalogue has a graph view that shows the clash map as a network of
circles and arrows rather than a list of cards. There are two surfaces:

- On every entry page, the right column shows a **mini graph** of just the
  entries connected to the one you're looking at (one or more hops away).
  The entry you're on is the larger ringed circle in the middle. Other nodes
  are clickable — selecting one navigates to that entry. Hovering a node
  dims everything that isn't directly connected to it, making dense clusters
  easier to read.
- The full **Clash map** page (`/graph.html`, linked from the nav) shows the
  wider network. Drag empty space to **pan**, scroll to **zoom**, and drag
  any node to reposition it. Click a node to open that entry.

Colours follow the rest of the site:

- **Node fill** is the entry's **society alignment** — green for Aligned, red
  for Opposed, grey for Neutral. A cluster of red nodes around one topic is a
  signal that the opposing material outweighs ours and we may need to upload
  counter-arguments.
- **Arrow colour** is the relation type — red for Rebuts, orange for
  Counters, green for Evidence For, grey for Updates.

When two entries are linked in both directions (e.g. A rebuts B and B also
counters A), the arrows curve to opposite sides so each one stays visible.

For performance and readability the full graph is **capped** (around 150
nodes at a time). If your catalogue has more, the system shows you a random
*selection of complete connected clusters* — never half-clusters. Use
**Re-roll random sample** at the top to load a different selection.
Visibility rules apply throughout: anonymous visitors never see a private
entry's title appear in either graph view.

### Editing and deleting

- You can **edit your own** entries (Write permission). Admins can edit anyone's.
- **Deleting** an entry requires **Admin**. This is deliberate — it stops
  material being lost casually.

### Viewing attached files

Click through to view an attached PDF/TXT/PNG/etc.. The file opens in your browser. The
system checks you're allowed to see it (the same public/private rule as the
entry it belongs to), so private files stay private.

### Downloading the data

Both the public listing and the members' dashboard have a **Download** button
just under the page title. It produces a single `.zip` containing every entry
you can see (public-only for visitors, all entries for signed-in members),
the sources and keywords they reference, the clash-map links between them,
and all the uploaded files.

Two things to know about what the download includes:

- **Anonymous entries stay anonymous.** If you upload something anonymously,
  your name is removed from the downloaded copy too — not just hidden in the
  webpage. Anyone receiving the file sees the entry attributed to "anonymous".
- **Other uploaders show as display names only.** The download contains the
  uploader's username and society role for attribution, but no underlying
  account information. Someone importing the file into another instance gets
  the names as labels — they don't become real accounts on that system, and
  nobody can log in as them.

This is useful for sharing the society's archive with a sister society, for
keeping your own copy of public material, or for transferring everything to a
new instance of the system. To bring a downloaded file into a different
instance, see the Installation guide for the `npm run import` command.

---

## Part B — Running the society (admin guide)

This is for **Admin** and **Root** accounts.

### Member management

Go to the admin page (`/admin.html`). Here you can:

- **Create members** — add a person, set their permission level and society
  role. They get a temporary password to change on first login.
- **Edit / remove members.**
- **Force a password reset** — issue a fresh temporary password if someone is
  locked out or forgot theirs. The temporary password works only for a short
  window and only to set a new password.

**Who can grant what:** Admins can create and manage **Read** and **Write**
members only. **Granting Admin can only be done by Root.**

### Groups (partner-society collaboration)

The database supports multiple societies sharing one catalogue. Every account
belongs to a **group** — either the home society (whoever runs the system),
the **Independent** catch-all group, or a partner-society group that Root has
created.

What this means in practice for Admins:

- **Partner-society Admins** can manage only their own group's members and
  the entries those members contributed. They can see only their own
  group's roster on the admin page; the wider directory isn't visible to
  them.
- **Home-society Admins** see every account and every entry, regardless of
  group. They're the gatekeepers for promoting anyone to Admin (partner
  Admins themselves can only create Read/Write members within their group).
- **Group affiliations are stable.** A user's group can only be changed by
  **Root** — there is no admin flow to move people around, deliberately, so
  partner Admins can't "kidnap" members into their own group.

Read/Write members don't see the directory at all. The group pill on every
entry tells you which society contributed it; that's the only group-level
context regular members get.

### Managing groups (Root only)

The admin page shows a **Manage groups** panel to Root. From here you can:

- **Create a new group** with a name, a pill colour, and an optional member
  quota (leave it blank for unlimited). Quotas count only **active**
  members, so a deactivated departed member doesn't take up a slot.
- **Edit** a group's name, colour, or quota. The home group can be renamed
  and recoloured but never archived or deleted.
- **Archive** a partner group when the partnership ends. Archived groups
  freeze: no new accounts can be created in them and no edits accepted,
  but existing members can still sign in to view their history. Archive is
  reversible — Root can unarchive at any time.
- **Delete** an empty group. The system refuses if any members remain, so
  Root must reassign or remove them first.

### The Root account and "Transfer Crown"

There is always exactly **one** Root, and Root always sits in the **home
group**. You don't promote someone to Root — instead the current Root uses
**Transfer Crown** to hand the role over to another member of the home group.

If the intended successor is currently in a partner group, Root has to move
them into the home group first (via the inline group dropdown on the edit-user
row) before the transfer button accepts them.

This matters at committee handover: before the outgoing person leaves, they
should **transfer the crown** to the incoming head, and the society should
record who currently holds it. If the sole Root account is lost and the
password is gone, regaining control is painful — so guard it and keep its
recovery details with the committee, not one individual.

### Full system backup (Root only)

Root has a **Download backup (zip)** button on the admin page. Unlike the
public/member download, this contains *everything* — every member account
including the stored password hashes, every entry whether public or private,
the full clash map, and every uploaded file. The resulting file is a complete
copy of the system and can be used to restore it onto a fresh machine.

Treat the backup `.zip` as **secret**. Anyone holding it has the same
information the database holds. Store it somewhere only the committee can
reach (an encrypted drive, an admin-only shared folder, etc.).

Make a backup on a sensible schedule — weekly at least for an active society,
and always immediately before any major change (committee handover, server
move, software update). One backup you can find is worth ten you can't.

Step-by-step restore instructions are in the Installation and maintenance
guide, Part C.

### A sensible handover checklist

When committee changes:

1. Current Root transfers the crown to the new head.
2. Update Admin accounts: add the new committee, demote the leavers from admin.
3. Take a fresh **system backup** (above) and store it with the committee
   records, separately from the running server.
4. Confirm backups are running and someone new understands the `Installation and maintainence guide.md`.
5. Pass on: the `.env` file (securely), where the `FILE_STORE_PATH` folder is,
   and how to start/stop the server (`Installation and maintainence guide.md` Part A, Steps 10 and 12).

