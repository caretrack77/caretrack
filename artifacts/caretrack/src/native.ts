// Android app (Capacitor) integration. In a normal browser every function here is a no-op,
// so the web version keeps working exactly as before.
//
// The app's screens are bundled inside the APK; only API calls go over the network, to the
// CareTrack server the user (or the build) configured. Nothing secret is stored in the app:
// it only knows the public server address and the signed-in user's own session token.
import { Capacitor } from '@capacitor/core';
import { App as CapacitorApp } from '@capacitor/app';
import { Preferences } from '@capacitor/preferences';
import { SplashScreen } from '@capacitor/splash-screen';
import { Directory, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { apiRequest, setAuthTokenGetter, setBaseUrl, setDefaultHeaders, setSessionTokenListener } from '@workspace/api-client-react';

export const isNativeApp = Capacitor.isNativePlatform();

const SERVER_KEY = 'caretrack-server-url';
const TOKEN_KEY = 'caretrack-session-token';
/** Optional server address baked in at build time (CARETRACK_API_URL). It is a public URL, not a secret. */
const BUILT_IN_SERVER = normalizeServerUrl(import.meta.env.VITE_CARETRACK_API_URL || '');

let serverUrl: string | null = null;
let sessionToken: string | null = null;

/** "caretrack.example.com" or "https://caretrack.example.com/api/" -> "https://caretrack.example.com". HTTPS only. */
export function normalizeServerUrl(input: string): string | null {
  let value = input.trim();
  if (!value) return null;
  if (!/^[a-z]+:\/\//i.test(value)) value = `https://${value}`;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || !url.hostname) return null;
    const path = url.pathname.replace(/\/+$/, '').replace(/\/api$/, '');
    return `${url.origin}${path}`;
  } catch {
    return null;
  }
}

/** Loads the saved server address and session before the app first renders. */
export async function initNative(): Promise<void> {
  if (!isNativeApp) return;
  setDefaultHeaders({ 'x-caretrack-client': 'android-app' });
  const [savedServer, savedToken] = await Promise.all([Preferences.get({ key: SERVER_KEY }), Preferences.get({ key: TOKEN_KEY })]);
  serverUrl = normalizeServerUrl(savedServer.value || '') || BUILT_IN_SERVER;
  sessionToken = savedToken.value || null;
  if (serverUrl) setBaseUrl(serverUrl);
  setAuthTokenGetter(() => sessionToken);
  setSessionTokenListener((token) => {
    sessionToken = token;
    void Preferences.set({ key: TOKEN_KEY, value: token });
  });
  // Android back button: go back inside the app; on the first screen, leave it running in the background.
  void CapacitorApp.addListener('backButton', ({ canGoBack }) => {
    if (document.querySelector('[data-mobile-nav-open]')) { window.dispatchEvent(new Event('caretrack-close-nav')); return; }
    if (canGoBack) window.history.back();
    else void CapacitorApp.minimizeApp();
  });
}

export function hideSplash(): void {
  if (isNativeApp) void SplashScreen.hide();
}

export const getServerUrl = () => serverUrl;
export const builtInServerUrl = () => BUILT_IN_SERVER;

/** Checks that the address is a reachable CareTrack server. Returns an error message, or null when it works. */
export async function testServer(url: string): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    const response = await fetch(`${url}/api/healthz`, { signal: controller.signal });
    clearTimeout(timer);
    if (!response.ok) return `The server answered with an error (${response.status}).`;
    const body = await response.json().catch(() => null) as { status?: string } | null;
    return body?.status === 'ok' ? null : 'That address is not a CareTrack server.';
  } catch {
    return navigator.onLine ? 'Could not reach that server. Check the address and that it uses HTTPS.' : 'You are offline. Connect to the internet and try again.';
  }
}

/** Saves a new server address. Signs out, since a session belongs to one server. */
export async function saveServerUrl(url: string): Promise<void> {
  serverUrl = url;
  setBaseUrl(url);
  await Preferences.set({ key: SERVER_KEY, value: url });
  await clearNativeSession();
}

/** Forgets the session token on this device (sign-out). */
export async function clearNativeSession(): Promise<void> {
  sessionToken = null;
  if (isNativeApp) await Preferences.remove({ key: TOKEN_KEY });
}

/**
 * Live updates in the app. EventSource can't send the bearer token, so the stream is read with
 * fetch instead. Calls onEvent for each server event; resolves when the stream ends.
 */
export async function streamServerEvents(onEvent: (type: string, data: string) => void, signal: AbortSignal): Promise<void> {
  const { url, headers } = await apiRequest('/api/events');
  headers.set('accept', 'text/event-stream');
  const response = await fetch(url, { headers, signal });
  if (!response.ok || !response.body) throw new Error(`Event stream failed (${response.status})`);
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return;
    buffer += value.replace(/\r\n/g, '\n');
    let end: number;
    while ((end = buffer.indexOf('\n\n')) >= 0) {
      const block = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      let type = 'message';
      const data: string[] = [];
      for (const line of block.split('\n')) {
        if (line.startsWith('event:')) type = line.slice(6).trim();
        else if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
      }
      if (data.length) onEvent(type, data.join('\n'));
    }
  }
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/**
 * Downloads a protected file (report PDF/CSV, lab result) with the session token and opens
 * Android's share sheet so it can be opened, saved to Files or sent. Throws with a readable message.
 */
export async function openProtectedFile(path: string, fallbackName: string): Promise<void> {
  const { url, headers } = await apiRequest(path);
  let response: Response;
  try {
    response = await fetch(url, { headers });
  } catch {
    throw new Error('You are offline. Files can be downloaded once you are back online.');
  }
  if (!response.ok) throw new Error(response.status === 404 ? 'That file is no longer available.' : 'The file could not be downloaded.');
  const disposition = response.headers.get('content-disposition') || '';
  const name = (/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposition)?.[1] || fallbackName).replace(/[\\/:*?"<>|]+/g, '_');
  const data = await blobToBase64(await response.blob());
  const { uri } = await Filesystem.writeFile({ path: `downloads/${decodeURIComponent(name)}`, data, directory: Directory.Cache, recursive: true });
  await Share.share({ title: name, files: [uri], dialogTitle: 'Open or save file' });
}
