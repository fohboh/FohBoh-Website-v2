# FohBoh.ai — V2 Website (mobile-fixed)

Static HTML, hosted on GitHub Pages with a custom domain (`CNAME` → fohboh.ai).
No build step — commit and push, GitHub Pages serves it as-is.

## What's in this repo

| File | Purpose |
|---|---|
| `CNAME` | Custom domain config for GitHub Pages (`fohboh.ai`) |
| `.nojekyll` | Tells GitHub Pages to skip Jekyll processing |
| `index.html` | Homepage |
| `sentry.html`, `cortex.html`, `mge.html` | Product landing pages |
| `caar-example.html` | Example CAAR (Certified Analysis & Audit Report) |
| `partners.html`, `for-vendors.html` | Partner / vendor pages |
| `pricing.html`, `roi-simulator.html` | Pricing and ROI simulator |
| `contact.html` | Contact / demo request |
| `m04-scr.html` | M04 · SCR module preview |
| `about.html` | About page |
| `resources.html` | Learning Center / resources |
| `privacy.html`, `terms.html` | Legal |
| `security.html`, `sentry-simulator.html` | Redirect stubs (→ terms.html, roi-simulator.html) |
| `fohboh-api-docs-page.html` | API docs — separate design system, already responsive |
| `mobile-fix.css` / `mobile-fix.js` | Shared mobile-responsive fix, linked from every page except the API docs page |
| `assets/` | `og-card.png`, `mge-structural-moat.png`, `m04-caar-scroll.png` |

## Mobile responsive fix (this release)

Every page previously forced a `min-width: 1120px` desktop layout on all devices,
had no responsive breakpoints, and had no mobile nav. `mobile-fix.css` and
`mobile-fix.js` correct this without touching any existing markup, copy, or
desktop styling — see `FohBoh-Mobile-Fix-SessionNotes.docx` (delivered
alongside this repo, not included here) for the full write-up.

## Deploying

Push this repo's contents to the branch GitHub Pages is configured to serve
(check **Settings → Pages** on the repo). The `CNAME` file keeps the custom
domain bound to `fohboh.ai` — don't remove it or GitHub Pages will fall back
to the default `*.github.io` URL.

## Known open items (carried over from prior build)

- Pricing volume-discount inconsistency between `pricing.html` and
  `roi-simulator.html` — not resolved in this release.
- Login URL, case studies, and some Learning Center article slugs are still
  placeholders.
