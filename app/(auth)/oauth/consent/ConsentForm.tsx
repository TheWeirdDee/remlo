'use client'

import * as React from 'react'
import { usePrivy } from '@privy-io/react-auth'

interface ConsentFormProps {
  requestToken: string
  clientName: string
}

interface ConsentResponse {
  redirect_to?: string
  error?: string
  error_description?: string
}

/**
 * Client-side approve/deny form for OAuth consent. Uses Privy to obtain
 * a fresh access token, then POSTs to /api/oauth/consent. The server
 * re-verifies the request token, generates an authorization code,
 * persists it, and returns the redirect URI the user-agent should
 * navigate to.
 *
 * Approving requires an authenticated Privy session. If the user isn't
 * logged in, the form invokes Privy's login modal (email / sms / wallet
 * methods, matching the rest of the app).
 */
export function ConsentForm({ requestToken, clientName }: ConsentFormProps): React.JSX.Element {
  const { ready, authenticated, login, getAccessToken, user } = usePrivy()
  const [submitting, setSubmitting] = React.useState<'approve' | 'deny' | null>(null)
  const [error, setError] = React.useState<string | null>(null)

  const handleApprove = React.useCallback(async () => {
    if (!authenticated) {
      login({ loginMethods: ['email', 'sms', 'wallet'] })
      return
    }
    setError(null)
    setSubmitting('approve')
    try {
      const token = await getAccessToken()
      if (!token) {
        setError('Could not obtain access token. Please sign in again.')
        return
      }
      const res = await fetch('/api/oauth/consent', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ req: requestToken, decision: 'approve' }),
      })
      const body = (await res.json()) as ConsentResponse
      if (!res.ok || !body.redirect_to) {
        setError(body.error_description || body.error || 'Authorization failed.')
        return
      }
      window.location.href = body.redirect_to
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authorization failed.')
    } finally {
      setSubmitting(null)
    }
  }, [authenticated, getAccessToken, login, requestToken])

  const handleDeny = React.useCallback(async () => {
    setError(null)
    setSubmitting('deny')
    try {
      const res = await fetch('/api/oauth/consent', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ req: requestToken, decision: 'deny' }),
      })
      const body = (await res.json()) as ConsentResponse
      if (body.redirect_to) {
        window.location.href = body.redirect_to
      } else {
        setError(body.error_description || 'Could not redirect back to client.')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to deny authorization.')
    } finally {
      setSubmitting(null)
    }
  }, [requestToken])

  return (
    <div>
      {error ? (
        <div className="mb-4 px-3 py-2 text-sm bg-red-50 border border-red-200 text-red-800 rounded-lg">
          {error}
        </div>
      ) : null}

      {ready && authenticated && user?.email?.address ? (
        <div className="text-xs text-neutral-500 mb-3 text-center">
          Signing in as <span className="font-medium text-neutral-700">{user.email.address}</span>
        </div>
      ) : null}

      <div className="flex gap-3">
        <button
          type="button"
          onClick={handleDeny}
          disabled={submitting !== null}
          className="flex-1 px-4 py-2.5 text-sm font-medium text-neutral-700 bg-white border border-neutral-300 rounded-lg hover:bg-neutral-50 disabled:opacity-50"
        >
          {submitting === 'deny' ? 'Denying…' : 'Deny'}
        </button>
        <button
          type="button"
          onClick={handleApprove}
          disabled={!ready || submitting !== null}
          className="flex-1 px-4 py-2.5 text-sm font-medium text-white bg-neutral-900 rounded-lg hover:bg-neutral-800 disabled:opacity-50"
        >
          {submitting === 'approve'
            ? 'Approving…'
            : !ready
              ? 'Loading…'
              : !authenticated
                ? 'Sign in to approve'
                : `Approve ${clientName}`}
        </button>
      </div>
    </div>
  )
}
