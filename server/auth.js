import crypto from 'crypto';
import { db } from './db.js';

const COOKIE_NAME = 'pocket_omaha_token';

// Middleware to guard admin endpoints with X-Admin: 1
export function requireAdmin(req, res, next) {
  const xAdmin = req.headers['x-admin'];
  if (xAdmin !== '1' && process.env.NODE_ENV !== 'development-bypass') {
    return res.status(403).json({ error: 'Admin access forbidden. Missing X-Admin header.' });
  }
  next();
}

// Generate random invite code
function generateInviteCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = 'OMAHA-';
  for (let i = 0; i < 4; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
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
    SELECT id, label, code, url, created_at, expires_at, used_at, device_id
    FROM invites
    ORDER BY created_at DESC
  `).all();

  // Plaintext rule: if used_at is set, ensure code and url are null
  const sanitized = invites.map(inv => ({
    id: inv.id,
    label: inv.label,
    code: inv.used_at ? null : inv.code,
    url: inv.used_at ? null : inv.url,
    created_at: inv.created_at,
    expires_at: inv.expires_at,
    used_at: inv.used_at,
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
  
  const host = req.get('host') || 'localhost:3000';
  const protocol = req.protocol === 'https' || req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http';
  const url = `${protocol}://${host}/?invite=${code}`;

  const expiresAt = new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000).toISOString();

  const stmt = db.prepare(`
    INSERT INTO invites (label, code, url, created_at, expires_at)
    VALUES (?, ?, ?, datetime('now'), ?)
  `);

  const result = stmt.run(label.trim(), code, url, expiresAt);

  return res.json({
    id: result.lastInsertRowid,
    code,
    url,
    expires_in_days: ttlDays
  });
}

export function revokeAdminInvite(req, res) {
  const { id } = req.params;
  const result = db.prepare(`
    UPDATE invites
    SET code = NULL, url = NULL, used_at = datetime('now')
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

  if (!code || typeof code !== 'string') {
    return res.status(400).json({ error: 'Invite code is required' });
  }

  const cleanCode = code.trim().toUpperCase();

  const invite = db.prepare(`
    SELECT * FROM invites
    WHERE UPPER(code) = ? AND used_at IS NULL AND datetime(expires_at) > datetime('now')
  `).get(cleanCode);

  if (!invite) {
    return res.status(400).json({ error: 'Invalid or expired invite code' });
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

  // Set cookie
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 365 * 24 * 60 * 60 * 1000
  });

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
  return req.cookies?.[COOKIE_NAME] || null;
}
