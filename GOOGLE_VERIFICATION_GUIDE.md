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
   > "Intrack is a personal finance tool designed to automate expense tracking. We access the user's Gmail read-only inbox strictly to locate bank transaction alert emails (from whitelisted domains like HDFC, ICICI, SBI).
   >
   > Transaction emails are parsed using a combination of client-side pattern matching and Google's own Gemini AI (called via a server-side proxy we control) for higher extraction accuracy. Email subject/body text is transmitted to our server and forwarded to Gemini solely to extract structured transaction fields (amount, merchant, date, category) in real time — it is never stored, logged, or retained after parsing completes, and only the extracted transaction fields are saved to our database. We do not sell user financial data, show advertisements, or share profiling data with any third parties."

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
