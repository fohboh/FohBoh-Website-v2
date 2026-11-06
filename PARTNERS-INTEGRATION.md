# Partners integration review

Replaces the existing partners.html with the approved category and inquiry experience. Keeps the existing website navigation and complete footer. Adds Company > Partners to all 24 pages that already carry that Company footer. Standalone tools and redirects without that footer are unchanged. No homepage content is replaced.

## Formspree activation blocker
Intended recipient: partners@fohboh.ai. Sending remains disabled with FORM_CONFIG.live=false. Do not reuse the pilot LOI endpoint. Authenticated Formspree access is needed to create/verify a partner-specific endpoint, configure that recipient, and verify that prospect autoresponses and other visitor email workflows are disabled. Do not put a recipient in a client-supplied hidden field and assume it configures routing.

After verification, configure the endpoint, enable live mode, replace the review button/status copy with approved submission copy, and test in staging with authorization. No form has been submitted during this change.

The page uses plain HTML and native controls instead of the asynchronous x-dc rendering wrapper so the required-field validation and event listeners initialize reliably. The navigation markup, brand assets, full footer and shared mobile navigation script are preserved. The page-specific CSS is loaded only on partners.html.
