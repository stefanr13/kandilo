import { Capacitor } from '@capacitor/core';
import {
  APP_URL_OPENED_EVENT,
  applyExternalAppUrlToHistory,
  type AppLocationSnapshot,
} from './navigation';

let nativeAppInitialized = false;

export function isNativePlatform(): boolean {
  return Capacitor.isNativePlatform();
}

export async function openExternalUrl(url: string): Promise<void> {
  if (!isNativePlatform()) {
    window.location.assign(url);
    return;
  }

  const { Browser } = await import('@capacitor/browser');
  await Browser.open({
    url,
    presentationStyle: 'fullscreen',
    toolbarColor: '#800000',
  });
}

function dispatchNativeUrlEvent(snapshot: AppLocationSnapshot): void {
  window.dispatchEvent(new CustomEvent<AppLocationSnapshot>(APP_URL_OPENED_EVENT, { detail: snapshot }));
}

async function initializeNativeUrlHandling(): Promise<void> {
  const [{ App }, { Browser }] = await Promise.all([
    import('@capacitor/app'),
    import('@capacitor/browser'),
  ]);

  const handleNativeUrl = async (url?: string | null) => {
    if (!url) {
      return;
    }

    const snapshot = applyExternalAppUrlToHistory(url, window.history);
    if (!snapshot) {
      return;
    }

    dispatchNativeUrlEvent(snapshot);

    try {
      await Browser.close();
    } catch {
      // Browser.close is a no-op on Android and may fail when no browser is open.
    }
  };

  const launchUrl = await App.getLaunchUrl();
  await handleNativeUrl(launchUrl?.url);

  await App.addListener('appUrlOpen', ({ url }) => {
    void handleNativeUrl(url);
  });
}

export async function initializeNativeApp(): Promise<void> {
  if (nativeAppInitialized) {
    return;
  }
  nativeAppInitialized = true;

  if (!isNativePlatform()) {
    return;
  }

  document.documentElement.classList.add('capacitor-native');

  const [{ SplashScreen }, { StatusBar, Style }] = await Promise.all([
    import('@capacitor/splash-screen'),
    import('@capacitor/status-bar'),
  ]);

  try {
    await initializeNativeUrlHandling();
  } catch (error) {
    console.warn('Native URL handler initialization failed:', error);
  }

  try {
    await StatusBar.setStyle({ style: Style.Dark });
    await StatusBar.setBackgroundColor({ color: '#ffffff' });
  } catch (error) {
    console.warn('Status bar initialization failed:', error);
  }

  try {
    await SplashScreen.hide();
  } catch (error) {
    console.warn('Splash screen hide failed:', error);
  }
}
