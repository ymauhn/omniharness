No PLAN.md in this workspace, so the round prints here. Bar is stated, so nothing to ask.

## Detour round — members area on a backendless static portal

**Main path:** one `index.html` with a sign-in form that validates nothing and reveals the manuals on click.
**Bar:** identity real (not client-side pretend) · manuals unreadable without it · zero backend for the maintainer.

The main path fails two of the three before any detour: anything GitHub Pages serves is already public, so the manuals are readable by `view-source` whether or not the form is clicked, and a form that stores nothing is the client-side pretend the criterion names. The three detours below each attack a different one of those facts.

---

### Detour 1 — the padlocked footlocker *(physical object)*

- **Reframe:** stop guarding the room, guard the box. The page is a public shelf; the manual is a locked case that happens to sit on it, and the lock travels with the file.
- **Changes:** manuals ship as AES-GCM ciphertext blobs in the repo; `scripts/site_build.py` grows an encrypt step; the page decrypts in-browser with a member passphrase via WebCrypto (PBKDF2 → AES-GCM, no dependency). The sign-in form stops being theatre and becomes the key prompt. No identity step at all.
- **Viability test:** encrypt one manual, publish, then logged out: `curl` the page and the blob and grep for a sentence of the manual — expect nothing. Then ask the owner: "member #7 pastes the passphrase in a group chat — what do you do Monday?" If the answer is "re-encrypt and re-send the new passphrase to all 40", the detour is dead for a live membership; it also never satisfies *identity* (one group secret, nobody is anybody).
- **Cost:** ~2h of build work, zero tokens at runtime, **no gate entries** (WebCrypto is native, no install, no key, no service). Depends on nothing not already here. Fails the identity half of the bar by construction.

### Detour 2 — the private handbook repo *(screen/document tradition)*

- **Reframe:** the internal version-controlled handbook, read in the host's own signed-in UI. The portal is the lobby directory, not the archive — restricted pages never reach Pages.
- **Changes:** manuals move to a second, private repo (or a `/private` repo alongside); members are collaborators or an org team; the public page holds only links plus a "request access" mailto. The sign-in form is deleted — GitHub's login is the login. Auth, sessions, revocation and audit are all somebody else's running code.
- **Viability test:** put one manual in a private repo, add a throwaway second account as collaborator. Logged out, open the file URL and the `raw.githubusercontent` URL → expect 404 on both. Logged in as the collaborator → readable. Then ask three actual members to confirm they have or will make a GitHub account; two refusals kills it.
- **Cost:** ~1h, zero tokens. **Gate: none beyond the owner's existing `gh` account** — private repos and unlimited collaborators are free; no install, no new credential, no service to pay. Price paid is aesthetic: members read on github.com, not inside the portal's design language.

### Detour 3 — the mailed issue *(ritual/procedure)*

- **Reframe:** membership as a subscription. The manual is an issue that arrives; the confirmed mailbox is the credential, the way a journal or a union circular has always worked.
- **Changes:** the page keeps only a double-opt-in join form (hosted list service); manuals are sent per release and never hosted; archive set to private. Revocation = removal from the list. No gate, no decrypt, no login.
- **Viability test:** create a two-address list, send one issue, then check the service's archive URL while logged out → must 404, not render. Unsubscribe one address and send again → must not deliver. If the archive can't be made private, or the manuals need in-place corrections and cross-links (a mailed copy can't be revised after delivery), it's dead.
- **Cost:** ~1h, zero tokens. **Gate: one third-party account signup** (list service, free tier, an API key only if the send is automated) — one new entry in the HITL list. Identity is a verified email, weaker than an account but real. Past copies stay readable forever on members' disks; that's either fine or fatal depending on what "restricted" means here.

---

**Verdict: adopt Detour 2.** Fit: the only one of the three that satisfies all three clauses at once — identity is a real third-party account with per-person revocation, the manuals are genuinely unfetchable without it (403/404 at the origin, not hidden in a payload), and the maintainer runs nothing. Cost: the lowest of the three, and the only one with zero new gate entries. Detour 1 is the cheapest to build but cannot produce an identity, so it can't clear the bar; Detour 3 clears it but buys a permanent third-party dependency and gives up revoking what's already delivered. The main path does not stand.

Second round on this decision needs a new `/detour`.