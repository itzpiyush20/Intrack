# Intrack Mobile App Packaging Guide (Capacitor)

Intrack is configured with **Capacitor** by Ionic, allowing you to package the React/Vite/TypeScript web application into a native Android application (APK) and an iOS application (IPA/Xcode).

---

## 📋 Prerequisites

Before building the mobile apps, make sure you have the following installed on your machine:

### For Android (Windows, macOS, Linux)
1. **Java Development Kit (JDK)**: JDK 17 is recommended.
2. **Android Studio**: Installed with Android SDK, SDK Command-line Tools, and an Android Virtual Device (Emulator) or a physical Android device with USB debugging enabled.

### For iOS (macOS Only)
1. **Xcode**: Downloaded from the Mac App Store.
2. **Xcode Command Line Tools**: Installed via `xcode-select --install`.
3. **Cocoapods**: Optional, but Capacitor v6 uses Swift Package Manager (SPM) by default which simplifies this.

---

## 🛠️ Developer Workflow

The web code and the native mobile projects are decoupled. Web updates will **never** automatically push to the mobile apps unless you explicitly build the web code and sync the projects.

### Step 1: Build the Web App
Compile the latest React/TypeScript/Tailwind frontend:
```bash
npm run build
```
This outputs the compiled production assets into the `dist/` directory.

### Step 2: Sync Web Assets to Native Platforms
Copy the compiled assets and Capacitor configuration into the native Android and iOS wrappers:
```bash
npx cap sync
```
*Note: This is the manual step you command when you want your web version updates to be deployed to the mobile app version.*

---

## 🤖 Generating Android APK

1. **Open the project in Android Studio**:
   ```bash
   npx cap open android
   ```
   *This launches Android Studio and loads the `android/` directory automatically.*

2. **Wait for Gradle Sync**:
   Let Android Studio download any missing Gradle packages and finish syncing the project (status is shown in the bottom bar of Android Studio).

3. **Build the Unsigned APK (for testing)**:
   - In Android Studio, go to the top menu: **Build > Build Bundle(s) / APK(s) > Build APK(s)**.
   - Once completed, a notification bubble will appear in the bottom-right corner saying "APK(s) generated successfully".
   - Click the **locate** link in that notification to open the folder containing `app-debug.apk`. You can rename this to `intrack.apk` and transfer it to any Android device to install.

4. **Build the Release/Signed APK (for distribution/Play Store)**:
   - Go to **Build > Generate Signed Bundle / APK...**
   - Select **APK** and click Next.
   - Choose or create a new Key Store Path, enter passwords, key alias, and click Next.
   - Select **release** build variant, choose the destination folder, and click Finish.

---

## 🍏 Building for iOS (macOS only)

1. **Open the project in Xcode**:
   ```bash
   npx cap open ios
   ```
   *This launches Xcode and loads the workspace inside the `ios/` directory.*

2. **Configure Signing**:
   - In the left sidebar of Xcode, select the root **App** project.
   - Go to the **Signing & Capabilities** tab.
   - Check **Automatically manage signing**.
   - Select your developer **Team** (create a free Apple Developer personal account if you don't have one).
   - Bundle Identifier is preset to `com.intrack.app`.

3. **Run on Simulator or Physical Device**:
   - Select your target device (e.g. an iPhone Simulator or your plugged-in iPhone) from the top device selector.
   - Click the **Play** button (or press `Cmd + R`) to compile and run the app.

4. **Archive/Export (for App Store or Ad-Hoc distribution)**:
   - In the top menu, select **Product > Scheme > App**.
   - Select **Product > Destination > Any iOS Device (arm64)**.
   - Select **Product > Archive**. Once completed, the Xcode Organizer window opens.
   - Click **Distribute App** to export an IPA file or submit it to TestFlight / App Store Connect.

---

## 🔄 Live Reload (For Mobile Debugging)

To run the app on your mobile device/emulator and see changes in real-time as you write code, you can use Live Reload:

1. Find your computer's local IP address (e.g. `192.168.1.50`).
2. Run Vite's dev server exposed to the network:
   ```bash
   npm run dev -- --host
   ```
3. Temporary modify `capacitor.config.ts` to point to the local server:
   ```typescript
   server: {
     url: 'http://192.168.1.50:5173', // Replace with your IP and Vite port
     cleartext: true
   }
   ```
4. Run `npx cap copy` to apply the server config change.
5. Launch Android Studio or Xcode to run the app. It will load directly from your development server.
