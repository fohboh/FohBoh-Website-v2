# FohBoh Data Room — Setup and Operating Guide

**Version:** 1.0 · **Last updated:** October 12, 2026 · **Classification:** FohBoh internal · **Owner:** Michael Atkinson

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

## 2. One-time setup (about 30 minutes; Arthur can do steps 1–2)

1. **Create the storage in AWS.** In the FohBoh AWS account, deploy `ops/dataroom/bucket.yaml` (CloudFormation, stack name
   `fohboh-dataroom`). It creates the private bucket `fohboh-dataroom-private` and an app user `DataRoomApp` that can reach
   only that bucket.
2. **Create one access key** for `DataRoomApp` (IAM console › Users › DataRoomApp › Security credentials › Create access
   key › "Application running outside AWS"). Keep the two values for step 3; don't email them.
3. **Add six environment variables** to the fohboh.ai project in Vercel (Settings › Environment Variables, Production and
   Preview):

   | Name | Value |
   |---|---|
   | `DATAROOM_S3_BUCKET` | `fohboh-dataroom-private` |
   | `DATAROOM_S3_REGION` | the region the stack was deployed in (for example `us-east-1`) |
   | `DATAROOM_AWS_ACCESS_KEY_ID` | from step 2 |
   | `DATAROOM_AWS_SECRET_ACCESS_KEY` | from step 2 |
   | `DATAROOM_SECRET` | a long random value, at least 32 characters (signs sessions; changing it signs everyone out) |
   | `DATAROOM_SETUP_TOKEN` | any long value you choose and keep; used once in step 5 |

4. **Publish** the website (the data room branch merged to main). Vercel installs the two AWS libraries and deploys the
   data room's server functions alongside the static site.
5. **Create your administrator login:** open **fohboh.ai/dataroom/setup.html**, enter the setup token, your name, email and
   an administrator password (12+ characters; use a password manager). The page works only once.

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
- **Access log:** Access log tab, newest first; Export log (CSV) for the full year.

## 4. What it does not do yet

- The design's "Ask a question" assistant is not built; the button emails hello@fohboh.com.
- Documents are not watermarked per viewer, and a person can save what they view; the NDA governs that.
- Two-step sign-in for the administrator is not built; use a strong, unique password.

## 5. For engineers

Code: `api/dataroom/[op].js` (one Vercel function), `api/_lib/dataroom/` (rules, hashing, storage), pages in `dataroom/`.
Tests: `npm test` (security rules on a local folder store). Local preview without AWS:
`DATAROOM_STORE_DIR=/tmp/dr DATAROOM_SECRET=<32+ chars> DATAROOM_SETUP_TOKEN=local npm run dataroom:dev`, then
http://localhost:4173/dataroom/.

## Changes

- **v1.0 (October 12, 2026):** first edition.
