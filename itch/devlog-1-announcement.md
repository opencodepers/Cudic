# Announcement post (devlog). After the project page is created on itch.io,
# paste this as a new post: itch.io → your game → Devlog → New post.
# Title: "Cudic is open: build games in your browser, publish them in one tab"

---

**Cudic is live.** It's a browser studio for making games — and making them
*publishable*: every game goes to a gallery with real pages, comments, remix
forks, and players who can open multiplayer rooms right in the game.

You can tell from this first screenshot what kind of tool it wants to be:
not a toy with big friendly buttons, but a workbench. File explorer, tabs,
live preview on the right, command palette when you want speed.

## Where Cudic came from

Here's the honest version, because we think it's more interesting than the
polished one: **the code was written by AI coding agents.** The ideas, the
design calls, and the relentless "no, that feels cheap, do it again" came
from us — but every file in this thing (the workbench, the backend, the
multiplayer rooms, the save system, the moderation tools) was produced by an
agent working in our team harness: we gave it plans and bug reports, it
shipped code, we broke it and sent it back.

We're shouting this out because "I have the idea but I can't type fast
enough" used to be a wall between people and their projects. It isn't
anymore. Cudic itself is proof that a one-human team plus agents can ship a
platform with cloud saves, versioning, and real-time multiplayer — and we
built it *for* people in that same situation.

## What's in version one

- **Studio** — a VS Code-style workbench. HTML/CSS/JS by hand, or import
  files, folders, even Scratch `.sb3` projects.
- **Publish** — permanent pages, likes, star ratings, comments.
- **Remix** — fork any published game; credit carries up the chain forever.
- **Cloud saves** — progress follows your account across devices.
- **Multiplayer** — live rooms over Cudic's own connection, guests welcome.
- **Snapshots** — staged, git-like versioning with a checklist instead of
  commands.
- **Weekly build theme** — a new challenge every Monday; mods spotlight the
  good ones on the homepage.

## Try it free

Everything is free; coins (for cosmetic theme packs) are earned, never sold.

**👉 [cudic.vercel.app](https://cudic.vercel.app/)**

If you build something, we'd genuinely love to see it. The early gallery is
small and unforgiving in the best way: your game is the most recent thing on
it.

## What's next

- Faster time-to-first-game (template-first "new project")
- Better creator stats
- More multiplayer primitives (state sync rooms)

*Genre of honesty note:* itch.io is where we'll post devlogs about how the
agent-written platform is evolving — including what bugs we found in our own
AI code, because there were *many*, and they were usually our fault for
asking for things to be done quietly.
