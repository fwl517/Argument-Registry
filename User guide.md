## Part A — Using the system (end-user guide)

This section is for ordinary members. It's based on the features the system
provides; the exact wording of buttons may vary slightly.

### Understanding roles

There are two *separate* kinds of role, and people mix them up:

- **Permission level** — what you're *allowed to do*: **Read → Write → Admin →
  Root**, each one able to do everything the one before can, plus more.
  - **Read:** browse members-only entries.
  - **Write:** also create entries, sources, keywords and links, and edit *your
    own* entries.
  - **Admin:** also manage Read/Write members, edit or delete *any* entry, and
    remove links.
  - **Root:** the single head administrator — manages Admins and can hand the
    Root role to someone else.
- **Society role** — a *label* describing your position (President, General
  Secretary, Treasurer, Extended-Committee, Member, Alumni). This is just
  descriptive and has nothing to do with what you can technically do.

So someone can be "Treasurer" (society role) with "Write" permissions, for
instance.

### Logging in and your first password

Go to `/login.html` and enter the username and temporary password an admin gave
you. The first time, you'll be required to set your own password before you can
do anything else. Choose something strong and don't reuse it elsewhere.

For security, the login screen gives the same "unauthorised" message whether the
username is wrong, the password is wrong, or the account is disabled — so a
failed login won't tell you which part was wrong. Double-check both.

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
- Its **stance** and the **party/source** it comes from.
- Either a **web link** or an **attached file** (PDF/TXT/PNG/etc., up to 50 MB).
- **Keywords/tags** to make it findable.
- Whether it's **public or private**, and whether it's **anonymous**.

If you mark an entry **anonymous**, your identity is hidden from everyone — it
shows as "Anonymous Member". This is enforced by the server, so your name truly
doesn't reach other people's browsers, not even hidden in the page.

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

### Editing and deleting

- You can **edit your own** entries (Write permission). Admins can edit anyone's.
- **Deleting** an entry requires **Admin**. This is deliberate — it stops
  material being lost casually.

### Viewing attached files

Click through to view an attached PDF/TXT/PNG/etc.. The file opens in your browser. The
system checks you're allowed to see it (the same public/private rule as the
entry it belongs to), so private files stay private.

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

### The Root account and "Transfer Crown"

There is always exactly **one** Root. You don't promote someone to Root —
instead the current Root uses **Transfer Crown** to hand the role over to
another member. This matters at committee handover: before the outgoing person
leaves, they should **transfer the crown** to the incoming head, and the society
should record who currently holds it. If the sole Root account is lost and the
password is gone, regaining control is painful — so guard it and keep its
recovery details with the committee, not one individual.

### A sensible handover checklist

When committee changes:

1. Current Root transfers the crown to the new head.
2. Update Admin accounts: add the new committee, demote the leavers from admin.
3. Confirm backups are running and someone new understands the `Installation and maintainence guide.md`.
4. Pass on: the `.env` file (securely), where the `FILE_STORE_PATH` folder is,
   and how to start/stop the server (`Installation and maintainence guide.md` Part A, Steps 10 and 12).

