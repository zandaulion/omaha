import crypto from 'crypto';
import { db } from './db.js';

export const COOKIE_NAME = 'pocket_omaha_token';

/**
 * Admin routes are gated on X-Admin: 1, which only the tailnet-only Caddy
 * listener injects — the public listener 404s /api/admin/* and strips the
 * header. There is deliberately no environment-variable escape hatch: the
 * previous `NODE_ENV === 'development-bypass'` check was one stray env var
 * away from an open admin API.
 */
/**
 * Admin access, proved by a shared secret rather than asserted by a header.
 *
 * This used to be `X-Admin: 1` -- a constant any caller could set. It was not
 * reachable from outside, because the public listener strips it and the
 * listener that injects it is bound to the tailnet, but that made the whole
 * admin surface rest on two lines of proxy configuration with nothing behind
 * them. Anything that reached the port directly was admin.
 *
 * Now the proxy passes a secret this process also knows, so being on the right
 * listener is no longer the same thing as being trusted.
 *
 * Fails closed. If ADMIN_TOKEN is missing the answer is no, because the
 * alternative -- treating an unconfigured server as an open one -- is exactly
 * how this kind of gate quietly stops working.
 */
function adminTokenOk(supplied) {
  const expected = (process.env.ADMIN_TOKEN || '').trim();
  if (!expected) return false;
  const given = Buffer.from(String(supplied || ''));
  const want = Buffer.from(expected);
  // timingSafeEqual demands equal lengths, so compare those first. It leaks
  // the length of the secret and nothing else.
  if (given.length !== want.length) return false;
  return crypto.timingSafeEqual(given, want);
}

export function requireAdmin(req, res, next) {
  if (!adminTokenOk(req.headers['x-admin-token'])) {
    return res.status(403).json({ error: 'Admin access is available on the private listener only.' });
  }
  next();
}

// Middleware to require registered device authorization
export function requireDeviceAuth(req, res, next) {
  // A request carrying the admin secret is the console acting on the owner's
  // behalf, so it stands in for a registered device.
  if (adminTokenOk(req.headers['x-admin-token'])) {
    return next();
  }

  const token = extractToken(req);
  if (!token) {
    return res.status(401).json({ error: 'Device not registered. Invite code required.' });
  }

  const device = db.prepare('SELECT id, label, revoked FROM devices WHERE token = ?').get(token);
  if (!device || device.revoked === 1) {
    return res.status(401).json({ error: 'Device registration invalid or revoked.' });
  }

  req.device = device;
  next();
}

/**
 * Invite codes: 12 characters from a 32-symbol alphabet with the ambiguous
 * glyphs (I, O, 0, 1) removed, drawn from the CSPRNG.
 *
 * The previous scheme was `OMAHA-` plus four Math.random() characters — a
 * 1,048,576-code space behind a fixed prefix, with no throttle on the redeem
 * endpoint. That is enumerable in well under an hour.
 */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_GROUPS = 3;
const CODE_GROUP_LEN = 4;

function generateInviteCode() {
  const length = CODE_GROUPS * CODE_GROUP_LEN;
  const bytes = crypto.randomBytes(length * 2);
  let out = '';
  let i = 0;
  while (out.length < length) {
    // Rejection sampling keeps the distribution uniform across the alphabet.
    const b = bytes[i++ % bytes.length];
    if (b >= 256 - (256 % CODE_ALPHABET.length)) continue;
    out += CODE_ALPHABET[b % CODE_ALPHABET.length];
  }
  return out.match(new RegExp(`.{1,${CODE_GROUP_LEN}}`, 'g')).join('-');
}

/** Accepts the code with or without its separators, in any case. */
export function normaliseCode(raw) {
  return String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

// ----------------- REDEEM THROTTLE -----------------
// Sliding one-minute windows, per source address and globally. Without this a
// wide code space still falls to a patient scanner.
const REDEEM_MAX_PER_IP = Number(process.env.REDEEM_MAX_PER_MIN_IP || 5);
const REDEEM_MAX_GLOBAL = Number(process.env.REDEEM_MAX_PER_MIN || 60);
const WINDOW_MS = 60_000;

const attemptsByIp = new Map();
let globalAttempts = [];

function clientIp(req) {
  return (
    req.headers['cf-connecting-ip'] ||
    (req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
    req.socket?.remoteAddress ||
    'unknown'
  );
}

function throttled(req) {
  const now = Date.now();
  const ip = clientIp(req);

  globalAttempts = globalAttempts.filter((t) => now - t < WINDOW_MS);
  const recent = (attemptsByIp.get(ip) || []).filter((t) => now - t < WINDOW_MS);

  if (recent.length >= REDEEM_MAX_PER_IP || globalAttempts.length >= REDEEM_MAX_GLOBAL) {
    attemptsByIp.set(ip, recent);
    return true;
  }

  recent.push(now);
  globalAttempts.push(now);
  attemptsByIp.set(ip, recent);

  // Keep the map from growing without bound on a long-running process.
  if (attemptsByIp.size > 5000) {
    for (const [key, times] of attemptsByIp) {
      if (!times.some((t) => now - t < WINDOW_MS)) attemptsByIp.delete(key);
    }
  }
  return false;
}

// ----------------- ADMIN ENDPOINTS -----------------

export function getAdminDevices(req, res) {
  const devices = db.prepare(`
    SELECT id, label, created_at, last_seen,
           CASE WHEN revoked = 1 THEN 1 ELSE 0 END as revoked,
           CASE WHEN has_push = 1 THEN 1 ELSE 0 END as has_push
    FROM devices
    ORDER BY created_at DESC
  `).all();

  return res.json({
    devices: devices.map(d => ({
      id: d.id,
      label: d.label,
      created_at: d.created_at,
      last_seen: d.last_seen,
      revoked: Boolean(d.revoked),
      has_push: Boolean(d.has_push)
    }))
  });
}

export function updateDeviceRevoke(req, res) {
  const { id } = req.params;
  const { revoked } = req.body || {};
  const isRevoked = revoked === true || revoked === 1 ? 1 : 0;

  const result = db.prepare('UPDATE devices SET revoked = ? WHERE id = ?').run(isRevoked, id);
  if (result.changes === 0) {
    return res.status(404).json({ error: 'Device not found' });
  }
  return res.json({ success: true, revoked: Boolean(isRevoked) });
}

export function updateDeviceLabel(req, res) {
  const { id } = req.params;
  const { label } = req.body || {};
  if (!label || typeof label !== 'string') {
    return res.status(400).json({ error: 'Label is required' });
  }

  const result = db.prepare('UPDATE devices SET label = ? WHERE id = ?').run(label.trim(), id);
  if (result.changes === 0) {
    return res.status(404).json({ error: 'Device not found' });
  }
  return res.json({ success: true, label: label.trim() });
}

export function deleteDevice(req, res) {
  const { id } = req.params;
  const result = db.prepare('DELETE FROM devices WHERE id = ?').run(id);
  if (result.changes === 0) {
    return res.status(404).json({ error: 'Device not found' });
  }
  return res.json({ success: true });
}

export function getAdminInvites(req, res) {
  const invites = db.prepare(`
    SELECT id, label, code, url, created_at, expires_at, used_at,
           COALESCE(revoked, 0) AS revoked, device_id
    FROM invites
    ORDER BY created_at DESC
  `).all();

  const base = (process.env.PUBLIC_BASE_URL || 'https://omaha.zandaulion.com').trim().replace(/\/+$/, '');

  // Plaintext rule: if used_at is set, ensure code and url are null
  const sanitized = invites.map(inv => ({
    id: inv.id,
    label: inv.label,
    code: inv.used_at ? null : inv.code,
    url: inv.used_at ? null : (inv.code ? `${base}/?invite=${inv.code}` : null),
    created_at: inv.created_at,
    expires_at: inv.expires_at,
    used_at: inv.used_at,
    revoked: Boolean(inv.revoked),
    device_id: inv.device_id
  }));

  return res.json({
    invites: sanitized,
    ttl_days: 7
  });
}

export function createAdminInvite(req, res) {
  const { label = 'Guest' } = req.body || {};
  const ttlDays = 7;
  const code = generateInviteCode();
  
  const base = (process.env.PUBLIC_BASE_URL || 'https://omaha.zandaulion.com').trim().replace(/\/+$/, '');
  const url = `${base}/?invite=${code}`;

  const expiresAt = new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000).toISOString();

  const stmt = db.prepare(`
    INSERT INTO invites (label, code, url, created_at, expires_at)
    VALUES (?, ?, ?, datetime('now'), ?)
  `);

  // invites.code carries a UNIQUE index, so a collision surfaces here rather
  // than silently stranding one of the two invites.
  let result;
  let attempt = 0;
  let finalCode = code;
  let finalUrl = url;
  for (;;) {
    try {
      result = stmt.run(label.trim(), finalCode, finalUrl, expiresAt);
      break;
    } catch (err) {
      if (++attempt >= 5 || !/UNIQUE/i.test(err.message)) throw err;
      finalCode = generateInviteCode();
      finalUrl = `${base}/?invite=${finalCode}`;
    }
  }

  return res.json({
    id: result.lastInsertRowid,
    code: finalCode,
    url: finalUrl,
    expires_in_days: ttlDays
  });
}

export function revokeAdminInvite(req, res) {
  const { id } = req.params;
  // Marked revoked rather than used, so the console can tell an invite that
  // was cancelled apart from one a device actually redeemed.
  const result = db.prepare(`
    UPDATE invites
    SET code = NULL, url = NULL, used_at = datetime('now'), revoked = 1
    WHERE id = ? AND used_at IS NULL
  `).run(id);

  if (result.changes === 0) {
    return res.status(404).json({ error: 'Invite not found or already used' });
  }
  return res.json({ success: true });
}

// ----------------- PUBLIC AUTH ENDPOINTS -----------------

export function redeemInvite(req, res) {
  const { code, device_label = 'PWA Client', push_subscription = null } = req.body || {};

  if (throttled(req)) {
    return res
      .status(429)
      .json({ error: 'Too many activation attempts. Wait a minute and try again.' });
  }

  if (!code || typeof code !== 'string') {
    return res.status(400).json({ error: 'Invite code is required' });
  }

  const cleanCode = normaliseCode(code);

  // Compared with separators stripped on both sides, so a code typed as
  // ABCD-EFGH-JKLM or abcdefghjklm both resolve.
  const invite = db.prepare(`
    SELECT * FROM invites
    WHERE REPLACE(UPPER(code), '-', '') = ?
      AND used_at IS NULL
      AND datetime(expires_at) > datetime('now')
  `).get(cleanCode);

  if (!invite) {
    return res.status(400).json({ error: 'That invite code is not valid, or it has already been used.' });
  }

  // Create new registered device
  const token = 'tok_' + crypto.randomBytes(24).toString('hex');
  const hasPush = push_subscription ? 1 : 0;

  const deviceStmt = db.prepare(`
    INSERT INTO devices (label, token, created_at, last_seen, revoked, has_push)
    VALUES (?, ?, datetime('now'), datetime('now'), 0, ?)
  `);
  const deviceResult = deviceStmt.run(device_label, token, hasPush);
  const deviceId = deviceResult.lastInsertRowid;

  // Mark invite as used & nullify plaintext
  db.prepare(`
    UPDATE invites
    SET used_at = datetime('now'), device_id = ?, code = NULL, url = NULL
    WHERE id = ?
  `).run(deviceId, invite.id);

  // Save push subscription if provided
  if (push_subscription && push_subscription.endpoint) {
    try {
      db.prepare(`
        INSERT INTO push_subscriptions (device_id, endpoint, p256dh, auth, created_at, last_active)
        VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))
        ON CONFLICT(endpoint) DO UPDATE SET
          device_id=excluded.device_id,
          p256dh=excluded.p256dh,
          auth=excluded.auth,
          last_active=datetime('now')
      `).run(
        deviceId,
        push_subscription.endpoint,
        push_subscription.keys?.p256dh || '',
        push_subscription.keys?.auth || ''
      );
    } catch (e) {
      console.warn('Failed to save push subscription:', e.message);
    }
  }

  // Secure is set unless the request arrived over plain HTTP on the tailnet
  // listener, where the flag would stop the cookie being stored at all.
  const secure = req.secure || req.headers['x-forwarded-proto'] === 'https';
  res.setHeader(
    'Set-Cookie',
    `${COOKIE_NAME}=${token}; Path=/; Max-Age=31536000; SameSite=Lax; HttpOnly` +
      (secure ? '; Secure' : '')
  );

  return res.json({
    success: true,
    device_id: deviceId,
    token
  });
}

export function checkSession(req, res) {
  const token = extractToken(req);
  if (!token) {
    return res.json({
      authenticated: false,
      revoked: false,
      device: null
    });
  }

  const device = db.prepare('SELECT id, label, revoked, has_push FROM devices WHERE token = ?').get(token);
  if (!device) {
    return res.json({
      authenticated: false,
      revoked: false,
      device: null
    });
  }

  if (device.revoked === 1) {
    return res.json({
      authenticated: true,
      revoked: true,
      device: { id: device.id, label: device.label }
    });
  }

  // Update last seen
  db.prepare("UPDATE devices SET last_seen = datetime('now') WHERE id = ?").run(device.id);

  return res.json({
    authenticated: true,
    revoked: false,
    device: {
      id: device.id,
      label: device.label,
      has_push: Boolean(device.has_push)
    }
  });
}

export function extractToken(req) {
  const authHeader = req.headers['authorization'];
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.substring(7).trim();
  }
  const cookieHeader = req.headers['cookie'];
  if (cookieHeader) {
    const cookies = cookieHeader.split(';').map(c => c.trim());
    for (const cookie of cookies) {
      if (cookie.startsWith(`${COOKIE_NAME}=`)) {
        return decodeURIComponent(cookie.substring(COOKIE_NAME.length + 1));
      }
    }
  }
  return req.cookies?.[COOKIE_NAME] || null;
}
