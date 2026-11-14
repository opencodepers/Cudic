# Illegal content risk assessment

**Service:** Cudic (cudic.vercel.app) — in-browser HTML5 game studio, UGC game hosting, real-time chat.
**Operator:** single-operator UK service (England & Wales).
**Assessment date:** 14 November 2026. **Next review:** 14 February 2027, and after any material change to publishing, chat or moderation.
**Author:** operator. **Status:** current.

This is the written record required of a user-to-user service under the UK Online Safety Act 2023, s.9. It is deliberately short, specific and dated: an honest record of a small service is a stronger defence than a generic template.

## 1. Scope

Users can publish: games (HTML/JS/CSS/assets), theme packs, music, 3D models, comments, chat messages, direct messages, profiles, and community server names/descriptions/rules. All of it is user-generated and none of it is pre-reviewed before publication.

## 2. How illegal content could reach other users

| Vector | What could be posted | Who sees it |
| --- | --- | --- |
| Game content | CSAM imagery drawn/embedded in a canvas, extreme violence or gore art, terrorism glorification, fraudulent "login" or crypto-drainer pages disguised as games | anyone opening the game |
| Game code | Redirect or phishing pages, cryptojacking, attempts to read the player's session, drive-by downloads | anyone opening the game |
| Game metadata | Titles/descriptions/thumbnails containing illegal or sexualised imagery of minors | gallery, search, share cards |
| Chat and DMs | CSAM links or files, grooming, threats, hate speech, drug or weapon sales, fraud | participants, server members |
| Profiles and servers | Sexualised images of minors, hate symbols, scam links | anyone visiting |
| Theme packs, music, models | Infringing or illegal assets; hidden payloads in SVG/glTF | users who apply them |

## 3. Likelihood and impact

- **CSAM / sexualised imagery of minors** — low volume on a small creative platform, severe harm. Rated **high** severity, **low–medium** likelihood.
- **Fraud and phishing inside games** — plausible: a game that imitates a login screen is cheap to make. **Medium** risk.
- **Terrorist or extreme-violence content** — low likelihood, high severity, **medium** overall.
- **Hate speech and harassment in chat** — most likely to occur, **high** likelihood, **medium–high** severity.
- **Cryptojacking / malicious code** — **medium** likelihood, **medium** severity.

## 4. Measures in place (as at the assessment date)

1. **Reports reach a human queue.** A Report control exists on games, messages, packs and profiles; it POSTs to `/api/reports` and lands in a moderation queue (`/api/reports/queue`) with statuses for dismissal, removal, unpublish and account action. Rate-limited to 20 reports/hour per account so the queue cannot be flooded.
2. **Moderation log.** Every moderation action is written to the database with a timestamp, and the terms state that every action is logged.
3. **Removal target.** Clear copyright or illegal-content reports are actioned within 48 hours; the commitment is published in the terms (§17) with a working contact address.
4. **Player isolation.** Games run in an iframe with `sandbox="allow-scripts allow-pointer-lock"` and no `allow-same-origin`, so game code cannot read the host page's session token or storage, cannot navigate the top window, and cannot claim the site's origin.
5. **Accepts nothing in advance.** Publishing is not pre-moderated; the service relies on notice-and-action plus spot checks of the public gallery.
6. **Prohibited-content list.** Acceptable-use terms name CSAM, hate, threats, harassment, doxxing, malware, phishing and fraud explicitly, with termination as the sanction.
7. **No private uploads channel to children.** There is no file-sharing DM path for arbitrary binaries; chat is text plus media links.

## 5. Gaps and planned action

| Gap | Why it matters | Action | Owner | Target |
| --- | --- | --- | --- | --- |
| No keyword/URL detection in chat | CSAM links propagate fastest in DMs | Add a link and term blocklist in the chat socket path | operator | Q1 2027 |
| No hash-matching for known CSAM images | The standard baseline for image hosts | Integrate a hash-matching feed once image upload volume justifies it | operator | when images are hosted directly |
| No dedicated 24/7 escalation inbox | Reports depend on the operator being awake | Email already published; add an out-of-hours auto-acknowledgement stating the 48-hour target | operator | Q1 2027 |
| Takedown timestamps not surfaced to reporters | Evidence for Ofcom would be stronger | Show status in `/api/reports/mine` (already returns status) and record action timestamps | operator | done via existing status field; expose dates |

## 6. Residual risk statement

Residual risk is judged **medium**. The service is small, publish-to-gallery only, and its player is sandboxed, so the realistic worst cases are a hosted game containing illegal imagery or a chat link to illegal material. Both are reachable through the Report control and removable within the published 48-hour target, with account termination available. The operator accepts this residual risk and reviews it quarterly.

## 7. Evidence kept

- this assessment, dated and versioned in git;
- the moderation action log and reports table (timestamps);
- the terms of service sections on acceptable use, reports, and user content (§3, §6, §17);
- commit history for the Report flow, sandbox attributes and takedown address.
