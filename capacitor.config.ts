import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.intrack.app',
  appName: 'Intrack',
  webDir: 'dist',
  server: {
    androidScheme: 'https'
  },
  // Native splash / webview background. Must match the light-only app shell
  // (`theme-color` and body are #ffffff); this was #09090b, left over from the
  // removed dark theme, so every cold start flashed black before first paint.
  backgroundColor: '#ffffff'
};

export default config;
