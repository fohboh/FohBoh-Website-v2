# Partners integration review

Replaces partners.html with the approved category/inquiry page. Retains the site navigation and full footer, and adds Company > Partners to all 24 pages that already have that Company footer. Other page content is unchanged.

## Formspree configuration
The user supplied https://formspree.io/f/mvkknpng. It is now enabled in partners.js (FORM_CONFIG.live=true). Intended recipient: partners@fohboh.ai. The pilot LOI endpoint is not used.

Recipient routing, inbox delivery and prospect autoresponder settings have NOT been verified. These are controlled in the Formspree dashboard, not by this page. Confirm that this form routes to partners@fohboh.ai and that prospect autoresponses and other visitor-email workflows are off. No real form submission or email test was performed.

Required fields: name, title, company, email and at least one partnership category. Phone and message are optional. All selected category checkboxes are associated with the form and sent as repeated categories fields. Submission is protected against repeated clicks while pending. HTTP errors keep entered data; network/uncertain errors advise contacting the team before resubmitting to avoid duplicates. Only a successful Formspree HTTP response clears the form, and the success notice does not claim inbox delivery.

## Apply
Extract the supplied changed-files ZIP into the FohBoh-Website-v2 repository root, replacing matches. Commit and push your review branch. No GitHub change, merge or live deployment was made as part of this endpoint update.

The page uses plain HTML and native controls rather than the asynchronous x-dc wrapper, preserving navigation markup, branding, full footer and shared mobile-navigation script. Page-specific CSS is only loaded on partners.html.
