# FohBoh Data Room — Setup and Operating Guide

**Version:** 1.0 · **Last updated:** October 12, 2026 · **Classification:** FohBoh internal · **Owner:** Michael Atkinson (sets up and runs it)

The data room lives at **fohboh.ai/dataroom/**. Investors sign in with their name, email address and a password you issue;
the three restricted folders (09 Financials & Cap Table, 10 Intellectual Property, 11 Legal & Material Contracts) also need
a six-digit PIN you issue per person and per folder. Every sign-in, PIN attempt and document opened is recorded in the
access log, which only you can read.

## 1. How it is protected

| Control | How |
|---|---|
| Passwords and PINs | Checked on the server. Stored only as one-way scrypt hashes; shown to you once, when issued. Never in the page, the code or this chat. |
| Lockout | Five wrong passwords (or five wrong PINs for a folder) lock that account or folder for 30 minutes; every attempt is logged. |
| Sessions | A signed, HttpOnly, Secure, SameSite=Strict cookie. Visitors: 8 hours. Administrator: 4 hours. Withdrawing access signs the person out at once. |
| Name and NDA | The name typed must match the name you entered for that person; the NDA acknowledgment box must be ticked. |
| Documents | Stored in a private Amazon S3 bucket (public access blocked, encrypted, versioned, HTTPS only). Each "View" is a link that expires in 60 seconds, issued only after the server checks access and writes the log entry. |
| Access log | One write-once record per event: time, name, email, event, folder and document, IP address and browser. Exportable as CSV. |
| Pages | Not indexed by search engines, cannot be framed by other sites, never cached. |

## 2. One-time setup (about 30 minutes, all in a web browser)

You do these yourself; no developer is needed. Have your password manager open to keep the values you create.

**Step 1 · Create the private storage in AWS (10 minutes)**
1. Sign in to the FohBoh AWS console and pick the region you use for MGE (top right; for example US East (N. Virginia)).
2. Open **CloudFormation** › **Create stack** › **With new resources**.
3. Choose **Upload a template file**, select `bucket.yaml` (sent to you with this guide; it is also in the website code
   under `ops/dataroom/`), then **Next**.
4. Stack name: `fohboh-dataroom`. Leave the bucket name as `fohboh-dataroom-private`. **Next**, **Next**, tick
   "I acknowledge that AWS CloudFormation might create IAM resources with custom names", **Submit**.
5. Wait for **CREATE_COMPLETE** (about a minute). It made a private, encrypted bucket and a user called `DataRoomApp` that
   can reach only that bucket.

**Step 2 · Create the key the website uses (5 minutes)**
1. Open **IAM** › **Users** › **DataRoomApp** › **Security credentials** › **Create access key**.
2. Choose **Application running outside AWS** › **Next** › **Create access key**.
3. Save the **Access key** and the **Secret access key** in your password manager. The secret is shown only once. Don't
   email or paste it anywhere else.

**Step 3 · Add six settings in Vercel (10 minutes)**
Sign in to the Vercel account that holds the fohboh.ai project, open the project › **Settings** › **Environment
Variables**, and add each of these for **Production** and **Preview**:

| Name | Value |
|---|---|
| `DATAROOM_S3_BUCKET` | `fohboh-dataroom-private` |
| `DATAROOM_S3_REGION` | the region from step 1 (for example `us-east-1`) |
| `DATAROOM_AWS_ACCESS_KEY_ID` | the access key from step 2 |
| `DATAROOM_AWS_SECRET_ACCESS_KEY` | the secret access key from step 2 |
| `DATAROOM_SECRET` | a long random value, at least 32 characters (let your password manager generate 40); it signs sessions, and changing it signs everyone out |
| `DATAROOM_SETUP_TOKEN` | another long value you generate and keep; you use it once in step 5 |

**Optional · Certified by MGE (DR-095).** To show real MGE certifications with their Trust Scores, add two more
variables: `DATAROOM_MGE_URL` (MGE's address, for example `https://api-staging.fohboh.ai/mge/v1`) and
`DATAROOM_MGE_READ_KEY` (a read key issued in the Admin Console for FohBoh's own demonstration client; sandbox keys show
records as "Sandbox test run"). Then, on the administrator page, Certified by MGE › enter a record's vault id. The data
room reads the record from MGE and adds it only if MGE's public verification confirms the seal. Investors see the real
Trust Score, outcome and fingerprint, and can check the seal themselves.

**Step 4 · Publish.** Tell Claude to publish the data room. The website then includes the data room's server code, and
Vercel installs it automatically on the next deploy.

**Step 5 · Create your administrator login (2 minutes).** Open **fohboh.ai/dataroom/setup.html**, enter the setup token,
your name, your email and an administrator password (12+ characters, from your password manager). The page works only once;
after that, sign in at fohboh.ai/dataroom/admin.html.

## 3. Day to day

- **Administrator page:** fohboh.ai/dataroom/admin.html.
- **Issue access:** Access › enter the investor's full legal name and email exactly as on the signed NDA, the NDA date, an
  optional end date, and tick the restricted folders they may open. Leave password and PIN boxes blank to generate them, or
  type your own (password 10+ characters, PIN six digits). Copy what is shown; it is not shown again.
- **Send credentials separately:** the sign-in link and password by email; each PIN by text message or phone.
- **Change or reset:** Edit a person to add or remove folders, issue a new password, or issue a new PIN for a folder.
- **Withdraw:** Withdraw signs them out at once and blocks sign-in. Edit › "Reactivate" restores access.
- **Documents:** Documents › choose the folder, title and file (up to 100 MB). Remove deletes it from the data room (S3
  keeps prior versions).
- **Certified by MGE:** Certified by MGE tab › vault id, a plain title and an optional note. Never real client data in a
  record you show here; use FohBoh's own sandbox or demonstration certifications.
- **Access log:** Access log tab, newest first; Export log (CSV) for the full year.

## 4. What it does not do yet

- The design's "Ask a question" assistant is not built; the button emails hello@fohboh.com. Trust Scores appear only on
  records MGE certified (Certified by MGE), never on documents or answers (DR-095).
- Documents are not watermarked per viewer, and a person can save what they view; the NDA governs that.
- Two-step sign-in for the administrator is not built; use a strong, unique password.

## 5. For engineers

Code: `api/dataroom/[op].js` (one Vercel function), `api/_lib/dataroom/` (rules, hashing, storage), pages in `dataroom/`.
Tests: `npm test` (security rules on a local folder store). Local preview without AWS:
`DATAROOM_STORE_DIR=/tmp/dr DATAROOM_SECRET=<32+ chars> DATAROOM_SETUP_TOKEN=local npm run dataroom:dev`, then
http://localhost:4173/dataroom/.

## Changes

- **v1.0 (October 12, 2026):** first edition.
