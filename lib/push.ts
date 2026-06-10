function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const buffer = new ArrayBuffer(rawData.length);
  const view = new Uint8Array(buffer);
  for (let i = 0; i < rawData.length; i++) view[i] = rawData.charCodeAt(i);
  return view;
}

async function fetchVapidKey(base: string, token: string): Promise<string> {
  const res = await fetch(`${base}/api/push/vapid-public-key`, {
    credentials: 'include',
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await res.json();
  return data.publicKey;
}

export type PushStatus = 'unsupported' | 'denied' | 'granted' | 'default';

export function getPushPermission(): PushStatus {
  if (typeof window === 'undefined') return 'unsupported';
  if (!('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window)) return 'unsupported';
  return Notification.permission as PushStatus;
}

export async function registerPush(userId: number, apiUrl: string, token: string): Promise<void> {
  if (typeof window === 'undefined') return;
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
  if (Notification.permission !== 'granted') return;

  try {
    const base = apiUrl.trim().replace(/\/$/, '');
    const vapidKey = await fetchVapidKey(base, token);

    const registration = await navigator.serviceWorker.register('/sw.js');
    await navigator.serviceWorker.ready;

    const existing = await registration.pushManager.getSubscription();
    if (existing) await existing.unsubscribe();

    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidKey),
    });

    await fetch(`${base}/api/push/subscribe`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ userId, subscription }),
    });
  } catch (err) {
    console.error('[Push] registerPush error:', err);
  }
}

export async function enablePush(userId: number, apiUrl: string, token: string): Promise<PushStatus> {
  if (typeof window === 'undefined') return 'unsupported';
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return 'unsupported';

  try {
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') return permission as PushStatus;

    const base = apiUrl.trim().replace(/\/$/, '');
    const vapidKey = await fetchVapidKey(base, token);

    const registration = await navigator.serviceWorker.register('/sw.js');
    await navigator.serviceWorker.ready;

    const existing = await registration.pushManager.getSubscription();
    if (existing) await existing.unsubscribe();

    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidKey),
    });

    await fetch(`${base}/api/push/subscribe`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ userId, subscription }),
    });
    return 'granted';
  } catch (err) {
    console.error('[Push] enablePush error:', err);
    return 'denied';
  }
}