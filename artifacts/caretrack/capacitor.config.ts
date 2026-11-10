import type { CapacitorConfig } from '@capacitor/cli';

// CareTrack Android app. The built web app (dist/public) is bundled into the APK and served
// from https://localhost inside the app; API calls go to the configured CareTrack server.
// No secrets belong here: this file is compiled into the APK.
const config: CapacitorConfig = {
  appId: 'com.caretrack.app',
  appName: 'CareTrack',
  webDir: 'dist/public',
  android: {
    // Only HTTPS servers: never load plain-HTTP content into the app.
    allowMixedContent: false,
    // Web debugging (chrome://inspect) only in debug builds.
    webContentsDebuggingEnabled: false,
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 3000,
      launchAutoHide: true,
      backgroundColor: '#174353',
      showSpinner: false,
      androidScaleType: 'CENTER_CROP',
    },
    LocalNotifications: {
      smallIcon: 'ic_stat_caretrack',
      iconColor: '#17647a',
    },
    SystemBars: {
      // Keep the app below the status bar and above the navigation bar on every phone.
      insetsHandling: 'native',
    },
  },
};

export default config;
