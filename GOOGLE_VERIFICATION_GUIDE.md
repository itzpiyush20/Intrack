# Google OAuth Verification Guide: Intrack

Since Intrack utilizes the **restricted scope** `https://www.googleapis.com/auth/gmail.readonly` to scan transaction alerts in the user's Gmail inbox when the user asks it to, you must submit the application for Google OAuth App Verification. 

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
   > Intrack is an expense tracker for Indian users. It turns the alerts and receipts their banks, UPI apps and merchants send into expense entries the user reviews and approves.
   >
   > Every scan is user-initiated; nothing runs in the background. We search the last 7 days for finance keywords such as debited, credited, UPI and receipt, so some non-transaction mail is returned and discarded. Subject and body are read in the browser; at most 1500 characters reach our server and Google's Gemini API, which extracts merchant, amount and date in real time. Text is not retained. No narrower scope works: gmail.metadata returns headers only, and the amount and merchant appear solely in the body. Gmail cannot limit a scope by sender or query.
   >
   > We store the extracted transaction only, never bodies, plus, for a rejected message, sender domain, subject and a 200-character extract, deleted after 30 days so a missing one can be traced. We never sell Google data, use it for ads, or train AI models on it.

   (993 characters. The console field caps at 1000 and silently accepts a
   truncated paste, so check the counter after pasting.)

   **This is the text that is actually in the console**, pasted 2026-09-11 and
   verified at 993/1000. Keep the two in sync: they had drifted apart before,
   and the drift was discovered only by opening the console and reading the
   live field, which is not a thing anyone does routinely.

   **Why it is worded this way.** Two earlier versions were wrong in the same
   direction - they described the scan as narrower than it is.

   - A repo-only draft claimed "whitelisted domains like HDFC, ICICI, SBI".
     There is no sender allowlist and there never was.
   - The live console text said "we search the inbox for bank-alert mail".
     That omits merchant receipts, which `RECEIPT_KEYWORDS` covers on purpose
     and which are half the product.
   - Both said the app reads "the subject and start of the body". It reads the
     WHOLE body: `extractEmailBody` in `src/services/emailScanner.ts` is
     explicitly untruncated, because the bulk-marketing gate needs all of it.
     What is truncated is the transfer - `AI_BODY_CHAR_LIMIT` in
     `src/services/aiService.ts` caps Gemini's copy at 1500 characters.

   Understating the scan is tempting and is the wrong instinct. A reviewer
   tests the claim: an email reading "your order total", from any sender,
   enters the pipeline. Stating the real mechanism also states the real data
   minimisation - full body local, 1500 characters onward - which is the
   stronger argument anyway, and the narrower wording was giving it away for
   nothing.

   Note: this justification must stay accurate to the actual data flow. If you change how email content is processed (e.g. add a new third-party AI provider, or start persisting raw content anywhere), update this text — and the Privacy Policy — to match before re-submitting, since reviewers test the app against what you've claimed.

---

## 4. Google OAuth Demonstration Video

Google requires an unlisted YouTube video demonstrating the OAuth flow and the
app actually using the scope. It is a hard requirement for restricted-scope
verification, and it is the last submission item outstanding.

**The step-by-step shot list that used to live here was deleted on 2026-09-11,
deliberately.** It described a single signup flow in which the Gmail consent
screen appears as part of registration. The app has not worked that way since
sign-in was narrowed to basic scopes: `gmail.readonly` is now requested
separately and in context, from the Pending page. Filming to that script would
have produced a video that never shows the restricted scope being granted —
the one thing the video exists to prove — and cost a submission cycle to find
out.

A stale script is worse than none, so there is none. Write the shot list
against the flow as it exists on the day of filming, not against notes of what
it used to be. Start by walking the consent flow yourself and recording what
actually happens, in order.

## 5. Verification Checklist & Razorpay Alignment
* [x] **Privacy Policy URL** is published and fully public.
* [x] **Terms of Service URL** is published and fully public.
* [x] **Refund & Cancellation Policy** is published and fully public.
* [x] **Contact details** include Grievance contact (your support email) and your registered business address.
* [x] **Client ID match**: Ensure that the client ID used in your production build matches the client ID registered on the Google Cloud Console project submitted for verification.
