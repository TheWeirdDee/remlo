import type { User } from '@privy-io/react-auth'

type PrivyLinkedAccount = User['linkedAccounts'][number]
type PrivyWalletAccount = PrivyLinkedAccount & {
  type: 'wallet'
  chainType: 'ethereum'
  address: string
  walletClientType?: string | null
  walletClient?: string | null
  connectorType?: string | null
}

function isEthereumWalletAccount(
  account: PrivyLinkedAccount
): account is PrivyWalletAccount {
  return (
    account.type === 'wallet' &&
    'address' in account &&
    typeof account.address === 'string' &&
    account.chainType === 'ethereum'
  )
}

function isPrivyEmbeddedWallet(account: PrivyWalletAccount) {
  return (
    account.walletClientType === 'privy' ||
    account.walletClient === 'privy' ||
    account.connectorType === 'embedded'
  )
}

export function getPrimaryPrivyEmbeddedEthereumWallet(user: Pick<User, 'wallet' | 'linkedAccounts'> | null | undefined) {
  if (!user) return null

  if (
    user.wallet?.chainType === 'ethereum' &&
    user.wallet.address &&
    isPrivyEmbeddedWallet(user.wallet as PrivyWalletAccount)
  ) {
    return user.wallet.address
  }

  const linkedWallet = user.linkedAccounts.find(
    (account): account is PrivyWalletAccount => isEthereumWalletAccount(account) && isPrivyEmbeddedWallet(account)
  )

  return linkedWallet?.address ?? null
}

export function getPrimaryPrivyEthereumWallet(user: Pick<User, 'wallet' | 'linkedAccounts'> | null | undefined) {
  if (!user) return null

  const embeddedWallet = getPrimaryPrivyEmbeddedEthereumWallet(user)
  if (embeddedWallet) return embeddedWallet

  if (user.wallet?.chainType === 'ethereum' && user.wallet.address) {
    return user.wallet.address
  }

  const linkedWallet = user.linkedAccounts.find(isEthereumWalletAccount)

  return linkedWallet?.address ?? null
}
