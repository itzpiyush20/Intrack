# Intrack — Sign-in and Gmail connection guide

How to get into Intrack and connect your inbox. Written for a real user, not a
developer.

---

## 1. Signing in

Open the app and choose **Sign in** (or **Sign up** if it is your first visit).

### Option A — Email and password
1. Enter your email address and password.
2. Choose **Sign in**.
3. No account yet? Choose **Sign up**, and set a password.
4. Forgotten it? **Forgot password** sends a reset link to your inbox.

### Option B — Continue with Google
1. Choose **Continue with Google**.
2. Pick your Google account in the chooser that opens.
3. You are returned to Intrack, signed in.

Signing in with Google **does not** give Intrack access to your mail. That is a
separate, later step, and you can use the whole app without it.

---

## 2. Connecting Gmail

Intrack asks for your inbox only when you first try to scan it — from the
**Pending** page, or the prompt on your Dashboard.

1. Choose **Connect Gmail Inbox**.
2. Google shows you exactly what is being requested: **read-only access to your
   Gmail messages** (`gmail.readonly`).
3. Choose **Allow**.

Intrack can read mail. It cannot send, reply, delete, label or modify anything —
the permission it holds makes that impossible, not merely disallowed.

You can disconnect at any time from **Settings**. Disconnecting revokes the
permission at Google and deletes anything stored on our side; it is a real
disconnect, not just a sign-out.

---

## 3. What happens to your email

- Scanning only ever looks at messages a financial-keyword search returns —
  bank and card alerts, UPI notifications, receipts, bills.
- To judge whether one of those is a genuine transaction, its subject and the
  start of its body are sent to Google Gemini through Intrack's own server. That
  is the only place your email text goes.
- **Nothing from the email itself is saved.** What is stored is the transaction
  it describes: vendor, amount, date, and the card it was charged to.
- Anything that turns out to be a newsletter or a promotion is discarded.
- Intrack has **no access to your SMS inbox** at all.

---

## 4. Scanning

Every scan is one you start. Intrack never scans on its own, and never runs in
the background.

- Open **Pending** and choose **Scan Bank Alerts**.
- You get **2 scans per 24 hours**, and consecutive scans must be at least
  4 hours apart.
- A scan looks back over the **last 7 days** of mail.

Everything a scan finds waits in **Pending** for you to approve or reject. No
transaction reaches your ledger until you say so.

---

## 5. If something goes wrong

| What you see | What to do |
|---|---|
| A prompt to connect Gmail again | Your Google permission expired. Choose **Connect Gmail Inbox** and allow again. |
| A scan finds nothing | Check the alerts are actually in the connected account, and within the last 7 days. |
| A wrong transaction appears | Reject it in Pending. Intrack learns your corrections per merchant. |
| Scan button disabled | You have used both scans, or the last one was under 4 hours ago. |

Still stuck? Use **Support** inside the app.
