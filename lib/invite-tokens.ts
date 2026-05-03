/**
 * Secure invite + KYC tokens.
 *
 * Previously `employees.id` was used as both — any leak of that UUID let an
 * attacker enumerate invites, front-run the claim, and open a victim's KYC
 * flow. Now we mint a random 32-byte token, store only its sha256, and
 * deliver the plaintext token through the employer's invite-email channel.
 */
import crypto from 'crypto'

const INVITE_TTL_MS = 14 * 24 * 3600 * 1000

export function generateInviteToken(): { token: string; hash: string; expiresAt: Date } {
  const token = crypto.randomBytes(32).toString('base64url')
  const hash = crypto.createHash('sha256').update(token).digest('hex')
  const expiresAt = new Date(Date.now() + INVITE_TTL_MS)
  return { token, hash, expiresAt }
}

export function generateKycToken(): { token: string; hash: string } {
  const token = crypto.randomBytes(32).toString('base64url')
  const hash = crypto.createHash('sha256').update(token).digest('hex')
  return { token, hash }
}

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex')
}

/**
 * Hash an IP address (or any identifier) with a per-process salt. Used for
 * rate-limit keys — we want to correlate attempts by source without storing
 * raw IPs.
 */
const IP_SALT = process.env.INVITE_IP_SALT ?? 'remlo-default-invite-salt'
export function hashIp(ip: string): string {
  return crypto.createHmac('sha256', IP_SALT).update(ip).digest('hex')
}
