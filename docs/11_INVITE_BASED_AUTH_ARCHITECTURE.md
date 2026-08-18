# PWA Invite Console Integration & Device Administration Architecture

This document specifies the exact API contracts, device lifecycle, and infrastructure security required to integrate **Pocket Omaha** with the central [pwa-invite-console](https://github.com/marinmda/pwa-invite-console.git).

---

## 1. System Topology & Architecture

`pwa-invite-console` is a unified administration PWA for managing invites and devices across multiple self-hosted web apps. Pocket Omaha exposes standard `/api/admin/*` endpoints that the console consumes.

```
                   PRIVATE TAILNET (Admin Only)
            https://<node>.<tailnet>.ts.net/invites/
                               │
                               ▼
 ┌─────────────────────────────────────────────────────────────┐
 │                    pwa-invite-console                       │
 │  (Lists devices, creates invites, copies WhatsApp messages) │
 └─────────────────────────────┬───────────────────────────────┘
                               │ (Reverse proxy injects `X-Admin: 1`)
                               ▼
 ┌─────────────────────────────────────────────────────────────┐
 │                    POCKET OMAHA BACKEND                     │
 │                                                             │
 │  [Admin Routes - Private]        [Public Auth Routes]       │
 │  • GET  /api/admin/devices       • POST /api/auth/redeem    │
 │  • POST /api/admin/invites       • GET  /api/auth/session   │
 │  • POST /api/admin/devices/revoke• POST /api/push/subscribe │
 └─────────────────────────────▲───────────────────────────────┘
                               │
                               │ (Public Web / PWA Session)
                               ▼
 ┌─────────────────────────────────────────────────────────────┐
 │                   POCKET OMAHA CLIENT PWA                   │
 │             (Wife's iPhone / Android Home Screen)           │
 └─────────────────────────────────────────────────────────────┘
```

---

## 2. Configuration Entry for `apps.json`

Add Pocket Omaha into `pwa-invite-console`'s `apps.json`:

```json
{
  "id": "omaha",
  "name": "Pocket Omaha",
  "api": "/omaha",
  "message": "Salut! Îți trimit acces la Pocket Omaha — monitorizare sănătate financiară și moat-uri pentru acțiuni.\n\n1) Deschide linkul:\n{link}\n\n2) Adaugă pagina pe ecranul principal:\n• iPhone (Safari): butonul de partajare → „Add to Home Screen”\n• Android (Chrome): butonul „Instalează” sau ⋮ → „Adaugă la ecranul principal”\n\n3) Deschide aplicația de pe ecranul principal și apasă „Activează”.\n\nCodul este valabil {days} zile și înregistrează un singur telefon."
}
```

---

## 3. Required Server API Contracts (The 7 Admin Endpoints)

Pocket Omaha backend must implement the following endpoints under its route prefix (`/omaha/api/admin/*` or `/api/admin/*`):

| Method | Endpoint | Request Body | Response Payload | Description |
|---|---|---|---|---|
| `GET` | `/api/admin/devices` | *None* | `{"devices": [{"id": 1, "label": "Ana — iPhone 15", "created_at": "2024-08-18T10:00:00Z", "last_seen": "2024-08-18T21:00:00Z", "revoked": false, "has_push": true}]}` | Lists all registered devices |
| `POST` | `/api/admin/devices/{id}/revoke` | `{"revoked": true}` | `{"success": true}` | Revokes/restores device access |
| `POST` | `/api/admin/devices/{id}/label` | `{"label": "New Name"}` | `{"success": true}` | Renames a device |
| `DELETE`| `/api/admin/devices/{id}` | *None* | `{"success": true}` | Permanently deletes device |
| `GET` | `/api/admin/invites` | *None* | `{"invites": [{"id": 1, "label": "Wife", "created_at": "...", "expires_at": "...", "used_at": null, "device_id": null, "code": "OMAHA-7F9A", "url": "https://pocketomaha.app/?invite=OMAHA-7F9A"}], "ttl_days": 7}` | Lists active/used invites |
| `POST` | `/api/admin/invites` | `{"label": "Wife"}` | `{"id": 2, "code": "OMAHA-8K2C", "url": "https://pocketomaha.app/?invite=OMAHA-8K2C", "expires_in_days": 7}` | Creates a new invite code |
| `POST` | `/api/admin/invites/{id}/revoke` | *None* | `{"success": true}` | Cancels an unused invite |

> **Security Rule on Plaintext**: Once an invite is used (`used_at` is set), the backend wipes the plaintext `code` and `url` (sets them to `null`). The console automatically hides copy buttons for redeemed invites.

---

## 4. Public Client Authentication Flow (`/api/auth/*`)

### 1. `POST /api/auth/redeem` (Redeeming Code & Binding Device)
* **Trigger**: User opens magic link or pastes code in PWA and taps "Activate".
* **Request**:
  ```json
  {
    "code": "OMAHA-7F9A",
    "device_label": "Wife's iPhone",
    "push_subscription": { "endpoint": "...", "keys": { "p256dh": "...", "auth": "..." } }
  }
  ```
* **Processing Rules**:
  1. Verify `code` exists, is not expired, and `used_at` is NULL (or was used $< 1\text{ hour}$ ago on the same device).
  2. Create a row in `devices` table with `revoked = false` and `has_push = (push_subscription != null)`.
  3. Mark invite as used (`used_at = NOW()`, `device_id = device.id`, `code = NULL`).
  4. Issue a long-lived device session token (HTTP-only cookie or Bearer token).
* **Response**:
  ```json
  {
    "success": true,
    "device_id": 1,
    "token": "sec_token_xyz"
  }
  ```

### 2. `GET /api/auth/session` (Verification on App Launch)
* **Header**: `Authorization: Bearer <token>` (or cookie).
* **Response**:
  ```json
  {
    "authenticated": true,
    "revoked": false,
    "device": { "id": 1, "label": "Ana — iPhone" }
  }
  ```
* If `revoked == true`, client PWA displays the lock screen and removes local cached credentials.

---

## 5. Security & Reverse Proxy (Caddy / Tailscale)

* **No Passwords on Console**: `pwa-invite-console` carries zero stored passwords.
* **Header Injection**: The private listener (accessible only via Tailscale HTTPS) injects `X-Admin: 1` before passing requests to the backend:

```caddyfile
# Caddyfile on Tailnet Private Listener
handle /omaha/api/admin/* {
    uri strip_prefix /omaha
    reverse_proxy 127.0.0.1:3000 {
        header_up X-Admin 1
    }
}

# Public Listener (Public Web)
handle /api/admin/* {
    respond "Not Found" 404
}
```

* Pocket Omaha checks: If route starts with `/api/admin/*`, require `req.headers['x-admin'] === '1'`.
