import { createRoot } from 'react-dom/client';
import { navigate } from 'wouter/use-browser-location';

import App from './App';
import { ErrorBoundary } from '@/components/error-boundary';
import { hideSplash, initNative } from './native';
import { setupNativeNotifications } from './native-notifications';
import { initOffline } from './offline';

import './index.css';

function render() {
  createRoot(document.getElementById('root')!, {
    // Keeps caught errors off reportError(), which would raise the dev overlay.
    onCaughtError: (error, errorInfo) => {
      console.error(error, errorInfo.componentStack);
    },
  }).render(
    <ErrorBoundary>
      <App />
    </ErrorBoundary>,
  );
  hideSplash();
}

// Android app: load the saved server address and session first (in a browser this resolves at once).
// Then offline mode (saved data and changes waiting to sync), so the first screen can use it.
initNative()
  .catch((error) => console.error('Native start-up failed', error))
  .then(() => initOffline())
  .catch((error) => console.error('Offline mode start-up failed', error))
  .finally(() => {
    setupNativeNotifications((path) => navigate(path));
    render();
    registerServiceWorker();
  });

// The service worker keeps the app's screens (HTML, scripts, styles) so the website also opens
// without internet. Data is saved separately per user by offline.ts. In the Android app the
// screens are already inside the APK; the worker is only used there for wellness tips.
function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  const register = () => navigator.serviceWorker.register('/sw.js').catch(() => {});
  if (document.readyState === 'complete') register();
  else window.addEventListener('load', register);
}
