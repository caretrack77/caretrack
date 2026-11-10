import { createRoot } from 'react-dom/client';
import { navigate } from 'wouter/use-browser-location';

import App from './App';
import { ErrorBoundary } from '@/components/error-boundary';
import { getServerUrl, hideSplash, initNative, isNativeApp } from './native';
import { setupNativeNotifications } from './native-notifications';

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
initNative()
  .catch((error) => console.error('Native start-up failed', error))
  .finally(() => {
    setupNativeNotifications((path) => navigate(path));
    render();
    registerServiceWorker();
  });

// Offline support: cache pages and data so the app still opens without internet.
// In the Android app the API is on another origin, so the worker is told which one to cache.
function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  const api = isNativeApp ? getServerUrl() : null;
  const register = () => navigator.serviceWorker.register(api ? `/sw.js?api=${encodeURIComponent(new URL(api).origin)}` : '/sw.js').catch(() => {});
  if (document.readyState === 'complete') register();
  else window.addEventListener('load', register);
}
