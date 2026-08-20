import webpush from 'web-push';
import { db } from './db.js';

let vapidKeys = {
  publicKey: process.env.VAPID_PUBLIC_KEY || '',
  privateKey: process.env.VAPID_PRIVATE_KEY || ''
};

// Initialize VAPID keys from DB or generate new pair
export function initVapid() {
  if (!vapidKeys.publicKey || !vapidKeys.privateKey) {
    const pub = db.prepare("SELECT value FROM app_settings WHERE key = 'vapid_public_key'").get();
    const priv = db.prepare("SELECT value FROM app_settings WHERE key = 'vapid_private_key'").get();

    if (pub?.value && priv?.value) {
      vapidKeys.publicKey = pub.value;
      vapidKeys.privateKey = priv.value;
    } else {
      const generated = webpush.generateVAPIDKeys();
      vapidKeys = generated;
      db.prepare("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('vapid_public_key', ?)").run(vapidKeys.publicKey);
      db.prepare("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('vapid_private_key', ?)").run(vapidKeys.privateKey);
    }
  }

  const subject = process.env.VAPID_SUBJECT || 'mailto:admin@pocketomaha.app';
  try {
    webpush.setVapidDetails(subject, vapidKeys.publicKey, vapidKeys.privateKey);
  } catch (err) {
    console.warn('VAPID setup warning:', err.message);
  }
}

export function getVapidPublicKey(req, res) {
  return res.json({ publicKey: vapidKeys.publicKey });
}

export function saveSubscription(req, res) {
  const { subscription, device_id } = req.body || {};
  const deviceId = req.device?.id || device_id;
  if (!subscription || !subscription.endpoint) {
    return res.status(400).json({ error: 'Valid push subscription object required' });
  }

  const endpoint = subscription.endpoint;
  const p256dh = subscription.keys?.p256dh || '';
  const auth = subscription.keys?.auth || '';

  try {
    db.prepare(`
      INSERT INTO push_subscriptions (device_id, endpoint, p256dh, auth, created_at, last_active)
      VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))
      ON CONFLICT(endpoint) DO UPDATE SET
        device_id=COALESCE(excluded.device_id, push_subscriptions.device_id),
        p256dh=excluded.p256dh,
        auth=excluded.auth,
        last_active=datetime('now')
    `).run(deviceId || null, endpoint, p256dh, auth);

    if (deviceId) {
      db.prepare('UPDATE devices SET has_push = 1 WHERE id = ?').run(deviceId);
    }

    return res.json({ success: true });
  } catch (err) {
    console.error('Error saving push subscription:', err);
    return res.status(500).json({ error: 'Failed to save subscription' });
  }
}

export async function sendPushNotification(subscription, payload) {
  const pushSubscription = {
    endpoint: subscription.endpoint,
    keys: {
      p256dh: subscription.p256dh,
      auth: subscription.auth
    }
  };

  const payloadString = JSON.stringify(payload);

  try {
    await webpush.sendNotification(pushSubscription, payloadString);
    return { success: true };
  } catch (err) {
    if (err.statusCode === 404 || err.statusCode === 410) {
      // Clean up invalid subscription
      db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').run(subscription.endpoint);
    }
    return { success: false, error: err.message };
  }
}

/**
 * Deliver to one device's endpoints only.
 *
 * A test notification must not broadcast: the household has several registered
 * devices, and tapping "send a test" on one phone should not set off the
 * others. Returns enough detail for the caller to tell "sent" apart from
 * "this device never subscribed", which are different problems with different
 * fixes.
 */
export async function sendToDevice(deviceId, payload) {
  const subs = db
    .prepare('SELECT * FROM push_subscriptions WHERE device_id = ?')
    .all(deviceId);

  if (!subs.length) return { subscriptions: 0, delivered: 0, failed: 0, errors: [] };

  const results = await Promise.all(subs.map((sub) => sendPushNotification(sub, payload)));
  const failures = results.filter((r) => !r.success);

  return {
    subscriptions: subs.length,
    delivered: results.length - failures.length,
    failed: failures.length,
    errors: failures.map((f) => f.error).filter(Boolean)
  };
}

export async function broadcastPush(payload) {
  const subscriptions = db.prepare('SELECT * FROM push_subscriptions').all();
  const results = await Promise.allSettled(
    subscriptions.map(sub => sendPushNotification(sub, payload))
  );
  return results;
}
