# Children's risk assessment

**Service:** Cudic (cudic.vercel.app) — in-browser HTML5 game studio, UGC game hosting, real-time chat.
**Assessment date:** 14 November 2026. **Next review:** 14 February 2027, and after any change to signup, DMs, recommendations or advertising.
**Author:** operator. **Status:** current.

Written record for the Online Safety Act children's safety duties and the ICO Children's Code. It records what children can currently do on Cudic and what protects them, without claiming protection that is not built.

## 1. Are children on the service?

Yes. Accounts are open to anyone 13 or over, and to under-13s where a parent or guardian has agreed to the terms on their behalf and supervises use (§2). Signup asks which of the two applies and stores the answer as `age_group` in the account's metadata. That is a **declaration, not age assurance**: no date of birth is collected, nothing verifies the answer, and the flag does not yet change any default setting. This assessment therefore assumes children aged 13–17 are present in numbers and that some younger children will sign up regardless.

**This is the largest gap on the platform.** If Ofcom's guidance or enforcement requires highly effective age assurance for a service of this kind, signup must add it before that becomes a live obligation. It is recorded here rather than glossed over.

## 2. What children can encounter

| Risk | How it arises | Current mitigation |
| --- | --- | --- |
| Contact by adults | DMs and community servers let strangers message a child | Report control on messages and profiles; blocking exists in chat; terms prohibit harassment and grooming-adjacent conduct only indirectly |
| User-generated sexual or violent content | Games, thumbnails, chat | Player sandbox contains code; report queue with 48-hour action target; publishing requires a confirmed email |
| Bullying and hate speech | Chat, comments, server names | Reports, moderation log, account restrictions and termination |
| Commercial profiling | Ad slots (Adsterra live, AdSense unverified) and analytics | Analytics and advertising scripts load only after consent; failure to consent means no GTM and no AdSense; Adsterra is the only always-on ad source and its categories are controlled in the Adsterra dashboard |
| Data minimisation | Signup asks for display name, email, password | No date of birth, no address, no phone number, no geolocation API used anywhere in the product |
| Public-by-default profiles | Profile pages and gallery listings are public | No private personal data is required to use the service; email addresses are never rendered on profiles |
| Overuse / compulsive play | Games and chat are always available | No streaks, no loot boxes, no paid currency (coins are earned, not purchased with money) |

## 3. Children's Code alignment

1. **Best interests of the child** — the product has no monetised gambling, no cash purchases and no behavioural advertising without consent. This is by design, not an accident of scale.
2. **Data protection impact assessment** — this document plus the illegal-content assessment are the DPIA record for a small controller; neither claims a formal DPIA has been signed off.
3. **Age-appropriate application** — signup asks 13+, or under 13 with a guardian's agreement, and records the answer, but it is declared and does not yet alter settings. See §1.
4. **Transparency** — privacy policy names lawful bases, retention and every processor; the contact address is published.
5. **Detrimental use of data** — no profiling for advertising beyond what the ad networks do with their own cookies, and that requires consent.
6. **Policies and community standards** — terms §3 and §5 set conduct rules; §6 sets the reporting route.
7. **Default settings** — highest-privacy defaults are **not yet implemented**: profiles do not have a "hide from search" switch and DMs from strangers are not off by default for accounts that declare an age under 18.
8. **Data sharing** — processors are listed; no data is sold.
9. **Geolocation** — not collected, not offered.
10. **Parental controls** — none built; parents can use device-level controls.

## 4. Gaps and planned action

| Gap | Action | Owner | Target |
| --- | --- | --- | --- |
| No age assurance | Signup records a declared `age_group` (13+ / under 13 with permission); verifying it, and treating a declared minor as restricted, are still to do | operator | restricted defaults next release; verification only if Ofcom requires it |
| No restricted-DM default | For declared under-18 accounts, default DMs to "people I follow" and require a follow-back before a stranger can message | operator | next release |
| No profile search switch | Add "hide my profile from search and the people directory" in settings, default off for adults, on for under-18 declarations | operator | next release |
| No chat keyword filter | Add a blocklist on the chat socket path before messages broadcast | operator | Q1 2027 |
| No parental reporting route | Publish a short "for parents" paragraph in the accessibility/privacy pages pointing at the same report address | operator | next release |

## 5. Residual risk

Residual risk for children is judged **high**, because there is no age assurance and no under-18 privacy defaults yet. The compensating factors are that the service hosts no paid content, no cash transactions, no geolocation and no gambling; that advertising and analytics are consent-gated; and that every surface carries a report route into a human moderation queue with a 48-hour action target. The operator accepts this as an interim position and treats §4 as the remediation plan.

## 6. Evidence kept

- this assessment in git, dated, with the review date;
- consent gating in `public/consent.js` and the absence of pre-consent ad/analytics tags;
- the ads-category decision recorded in TODO.md (Adsterra categories until AdSense is verified);
- the report and moderation tables with timestamps.
