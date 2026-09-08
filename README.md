# FohBoh.ai — V2 Website (mobile-responsive, final)

Static HTML, built for GitHub Pages with a custom domain (`CNAME` → fohboh.ai),
but not tied to any specific host — this is a plain static site, so it will
run on any static host (GitHub Pages, Netlify, Vercel static export, S3, etc.).

## Deploying
Upload every file in this folder to your host's root — including the dotfile
`.nojekyll` and the extensionless `CNAME`. `index.html` must sit at the root,
not inside a subfolder, or the site won't be found at your domain.

## What's fixed here
Every page previously forced a `min-width: 1120px` desktop-only layout,
had zero responsive breakpoints, and had no mobile nav. `mobile-fix.css` and
`mobile-fix.js` (linked from every page except `fohboh-api-docs-page.html`,
which already had its own responsive CSS) fix that:
- Nav collapses to a hamburger below 900px
- All content grids stack to one column on phones
- The homepage's platform-diagram mockup (a desktop-only zoom/rotate trick)
  is neutralized and stacks properly
- A sitewide fixed 64px horizontal gutter is reduced on mobile
- The homepage's second cross-fading graphic (architectural blueprint image)
  has been removed per request — the diagram now displays statically

## Files
All 15 content pages, `fohboh-api-docs-page.html` (untouched, already
responsive), two redirect stubs (`security.html`, `sentry-simulator.html`),
`mobile-fix.css`/`mobile-fix.js`, `assets/`, `CNAME`, `.nojekyll`.
