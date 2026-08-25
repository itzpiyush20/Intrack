import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.intrack.app',
  appName: 'Intrack',
  webDir: 'dist',
  server: {
    androidScheme: 'https'
  },
  backgroundColor: '#09090b'
};

export default config;
