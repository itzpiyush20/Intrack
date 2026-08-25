# Intrack User Login Guide

Welcome to **Intrack**, your smart, private, and local financial guardian. This document provides step-by-step instructions for logging into the application and navigating Google Sign-In warnings (since the app runs in local/test mode).

---

## 1. General User Login Process

You can log into Intrack using either your email/password credentials or via Google OAuth.

### Option A: Email & Password
1. Navigate to the Intrack login page.
2. Enter your registered email address and password.
3. Click **Sign In**.
4. If you don't have an account, click **Sign Up** to create one.

### Option B: Google OAuth (One-Click Login)
1. On the login page, click the **Continue with Google** button.
2. A secure Google Account chooser window will open.
3. Select your Google account to log in.

---

## 2. Navigating Google Sign-In Warnings

Because Intrack operates with strict local privacy constraints and is currently in testing/verification status, Google may display a warning page stating: **"Google has not verified this app"** or **"This app isn't verified"**.

> [!IMPORTANT]
> Intrack is designed with **100% Client-Side Privacy**. All email scanning and parsing happens directly in your browser using local resources. Intrack requests **Read-Only** access to your email messages and **does not** store, modify, or transmit your raw emails anywhere outside your browser.

To bypass this warning and proceed:
1. When the warning screen appears, locate and click the **"Advanced"** link (usually located in the bottom-left corner of the message box).
2. A detailed explanation will expand.
3. Scroll down and click on the link that says **"Go to Intrack (unsafe)"** (Note: Google designates unverified local apps as "unsafe" purely because they haven't completed the formal review process).
4. Review the requested permissions (Read-Only access to metadata and messages for parsing transactions) and click **"Allow"** / **"Continue"**.
5. You will be successfully logged into your Intrack dashboard!
