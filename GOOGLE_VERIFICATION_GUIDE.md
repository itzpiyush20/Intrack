# Google OAuth Verification Guide: Intrack

Since Intrack utilizes the **restricted scope** `https://www.googleapis.com/auth/gmail.readonly` to automatically scan transaction alerts in the user's Gmail inbox, you must submit the application for Google OAuth App Verification. 

Without verification, users will see a red "unverified app" warning, and a hard limit of 100 logins will block your launch.

Follow these strict configurations to avoid Google App Verification rejection:

---

## 1. Domain Ownership Verification
Before Google audits the app, you must verify ownership of the domain where the app is hosted (e.g., `www.intrack.co.in` or your custom domain).
1. Go to the [Google Search Console](https://search.google.com/search-console).
2. Add your domain as a property.
3. Verify ownership via the recommended method (e.g., adding a TXT DNS record on your domain registrar or placing an HTML file inside the `/public` folder).

---

## 2. Google Cloud Console Settings Alignment
In the [Google Cloud Console](https://console.cloud.google.com/), go to **APIs & Services → OAuth consent screen**:

* **App Name**: Must be set exactly to `Intrack`. This must match the name in your landing page and dashboard headers.
* **User Support Email**: Set to your support email address.
* **App Logo**: Upload a high-resolution logo (optional, but highly recommended for trust).
* **Application Home Page Link**: `https://www.intrack.co.in` (or your custom domain).
* **Application Privacy Policy Link**: `https://www.intrack.co.in/privacy` (Must match the routes).
* **Application Terms of Service Link**: `https://www.intrack.co.in/terms` (Must match the routes).
* **Authorized Domains**: Add `www.intrack.co.in` (or your custom domain).

---

## 3. Scopes & Written Justification
When adding scopes to the OAuth Consent Screen:
1. Select the `.../auth/gmail.readonly` scope.
2. Provide the following written justification to Google's compliance reviewers when requested:
   > "Intrack is a personal finance tool that automates expense tracking. Every scan is started by the user from within the app; nothing runs in the background.
   >
   > We use gmail.readonly to run one Gmail search per scan: messages from the last 7 days matching finance keywords such as debited, credited, UPI, NEFT, receipt, invoice, refund or order. Spam and Trash are never searched. Matching messages are filtered in the browser, and only those that still look like a transaction are sent to a server-side proxy we control and on to Google Gemini, which extracts amount, merchant, date and category.
   >
   > Email content is never stored, logged or retained after parsing; only the extracted fields are saved. For a message we reject, we keep the sender domain, subject and a 200-character extract for 30 days so the user can see why it was skipped. Every transaction needs the user's approval before it is recorded. We do not sell user data, show ads, or share profiling data."

   (963 characters — the console field caps at 1000.)

   **Why this text and not something narrower.** An earlier version of this
   justification claimed the scan was limited to "whitelisted domains like
   HDFC, ICICI, SBI". No sender allowlist exists in the code and none ever
   did. `scanRealGmailInbox` builds a KEYWORD query — see `EMAIL_KEYWORDS` in
   `src/services/emailScanner.ts` — matching roughly 45 terms across the whole
   mailbox from any sender, Spam and Trash excluded. Several of those terms
   (`order`, `total`, `trip`, `subscription`, `card`) are ordinary English, so
   the query legitimately reaches mail that has nothing to do with a bank.

   That breadth is defensible: non-financial mail is rejected by the gates
   before it costs an AI call, nothing but extracted fields is retained, and
   the user approves every transaction. What is NOT defensible is describing
   it as an allowlist, because a reviewer tests the claim — an email reading
   "your order total" from any address enters the pipeline — and because a
   rejected message leaves a 30-day diagnostics record (domain, subject,
   200-character extract) that the allowlist story would have implied could
   only ever concern a bank. Describe the real mechanism. It survives testing;
   the narrower sentence does not.

   Note: this justification must stay accurate to the actual data flow. If you change how email content is processed (e.g. add a new third-party AI provider, or start persisting raw content anywhere), update this text — and the Privacy Policy — to match before re-submitting, since reviewers test the app against what you've claimed.

---

## 4. Google OAuth Demonstration Video (Crucial)
Google reviewers **mandatorily require** a YouTube video demonstrating how the app uses Google OAuth scopes. Keep the video unlisted and paste the link in your verification submission.

Your video must show the following steps clearly:
1. **The Consent Flow Start**: Show the user clicking "Continue with Google" on the Intrack signup screen.
2. **The URL Client ID Check**: Pause or zoom in on the Google login window showing the URL. Reviewers must be able to see your Google Cloud project's `client_id` parameter clearly in the URL bar of the Google login popup.
3. **The Warning Screen**: (If currently unverified) Show clicking "Advanced → Go to Intrack (unsafe)".
4. **The Gmail Scope Checkbox**: Show the Google OAuth permissions check window where the user ticks the box authorizing Intrack to **"Read emails from your Gmail account"**.
5. **The Functionality**: Show the browser dashboard successfully scanning banking emails, parsing the transaction alerts client-side, and displaying them as transaction rows on the expenses sheet.

---

## 5. Verification Checklist & Razorpay Alignment
* [x] **Privacy Policy URL** is published and fully public.
* [x] **Terms of Service URL** is published and fully public.
* [x] **Refund & Cancellation Policy** is published and fully public.
* [x] **Contact details** include Grievance contact (your support email) and your registered business address.
* [x] **Client ID match**: Ensure that the client ID used in your production build matches the client ID registered on the Google Cloud Console project submitted for verification.
