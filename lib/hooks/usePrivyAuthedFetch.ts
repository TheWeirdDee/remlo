'use client'

import * as React from 'react'
import { usePrivy } from '@privy-io/react-auth'

export function usePrivyAuthedFetch() {
  const { authenticated, getAccessToken } = usePrivy()

  return React.useCallback(
    async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const headers = new Headers(init.headers)

      if (authenticated) {
        // getAccessToken() can transiently return null while Privy refreshes
        // the access token. If we send the request without a Bearer header
        // the server 401s — which React Query then retries. Avoid the noise
        // by retrying the token fetch a few times before giving up.
        let token: string | null = null
        for (let attempt = 0; attempt < 5; attempt++) {
          token = await getAccessToken()
          if (token) break
          await new Promise((r) => setTimeout(r, 50 * (attempt + 1)))
        }
        if (token) {
          headers.set('Authorization', `Bearer ${token}`)
        }
      }

      return fetch(input, {
        ...init,
        headers,
      })
    },
    [authenticated, getAccessToken]
  )
}

export function usePrivyAuthedJson() {
  const authedFetch = usePrivyAuthedFetch()

  return React.useCallback(
    async function fetchJson<T>(input: RequestInfo | URL, init: RequestInit = {}): Promise<T> {
      const res = await authedFetch(input, init)

      if (!res.ok) {
        let message = `${res.status} ${res.statusText}`

        try {
          const body = (await res.json()) as { error?: string }
          if (body.error) {
            message = body.error
          }
        } catch {
          // Ignore JSON parse failures and keep the status-based message.
        }

        throw new Error(message)
      }

      return res.json() as Promise<T>
    },
    [authedFetch]
  )
}
