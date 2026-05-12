import type { PrivyClientConfig } from '@privy-io/react-auth'
import { getTempoChain } from '@/lib/tempo/network'

export const tempoChain = getTempoChain()

export const privyConfig: PrivyClientConfig = {
  defaultChain: tempoChain,
  supportedChains: [tempoChain],
  loginMethods: ['email', 'sms'],
  ...(process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID
    ? { walletConnectCloudProjectId: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID }
    : {}),
  appearance: {
    theme: 'dark',
    accentColor: '#059669',
    landingHeader: 'Choose how to continue',
    loginMessage: 'Use email or SMS to access your embedded Remlo wallets.',
  },
  embeddedWallets: {
    createOnLogin: 'all-users',
    requireUserPasswordOnCreate: false,
  },
}
