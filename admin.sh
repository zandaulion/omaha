#!/usr/bin/env bash
# Invites and devices for Pocket Omaha.
# Talks to the tailnet-only listener with X-Admin: 1 or localhost directly.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
[[ -f "$ROOT/.admin.env" ]] && { set -a; . "$ROOT/.admin.env"; set +a; }
API="${API:-${ADMIN_API:-http://127.0.0.1:8095}}"

j() { python3 -m json.tool 2>/dev/null || cat; }
get() { curl -fsS --max-time 15 -H 'X-Admin: 1' "$API$1"; }
post() { curl -fsS --max-time 15 -H 'X-Admin: 1' -X POST "$API$1" -H 'Content-Type: application/json' -d "${2:-{}}"; }
delete() { curl -fsS --max-time 15 -H 'X-Admin: 1' -X DELETE "$API$1"; }

usage() {
  cat <<'USAGE'
Pocket Omaha — Administration CLI

usage: ./admin.sh <command>

  invite [label]     create a new invite code
  invites            list all invites
  unvite <id>        revoke an unused invite
  devices            list all registered devices
  revoke <id>        revoke device access
  unrevoke <id>      restore device access
  forget <id>        delete a device
  name <id> <label>  rename a device label
  health             test backend server health

USAGE
}

case "${1:-}" in
  invite)   post /api/admin/invites "{\"label\":\"${2:-Guest}\"}" | j ;;
  invites)  get /api/admin/invites | j ;;
  unvite)   post "/api/admin/invites/${2:?id}/revoke" | j ;;
  devices)  get /api/admin/devices | j ;;
  revoke)   post "/api/admin/devices/${2:?id}/revoke" '{"revoked":true}' | j ;;
  unrevoke) post "/api/admin/devices/${2:?id}/revoke" '{"revoked":false}' | j ;;
  forget)   delete "/api/admin/devices/${2:?id}" | j ;;
  name)     post "/api/admin/devices/${2:?id}/label" "{\"label\":\"${3:?label}\"}" | j ;;
  health)   curl -fsS "$API/api/health" | j ;;
  *) usage; exit 1 ;;
esac
