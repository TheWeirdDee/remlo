// TIP-403 Compliance Registry precompile ABI.
// Precompile address: 0x403c000000000000000000000000000000000000
//
// Post-T2 (TIP-1015), `isAuthorized(policyId, account)` is split into
// `isAuthorizedSender` / `isAuthorizedRecipient` / `isAuthorizedMintRecipient`
// for compound policies. The simple `isAuthorized` form is preserved as a
// shorthand that's equivalent to `isAuthorizedSender(...) && isAuthorizedRecipient(...)`
// for legacy callers.
//
// Reserved policies:
//   0 — always-reject
//   1 — always-allow

export const TIP403RegistryABI = [
  {
    type: 'function',
    name: 'isAuthorized',
    inputs: [
      { name: 'policyId', type: 'uint64', internalType: 'uint64' },
      { name: 'wallet', type: 'address', internalType: 'address' },
    ],
    outputs: [{ name: '', type: 'bool', internalType: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'isAuthorizedSender',
    inputs: [
      { name: 'policyId', type: 'uint64', internalType: 'uint64' },
      { name: 'wallet', type: 'address', internalType: 'address' },
    ],
    outputs: [{ name: '', type: 'bool', internalType: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'isAuthorizedRecipient',
    inputs: [
      { name: 'policyId', type: 'uint64', internalType: 'uint64' },
      { name: 'wallet', type: 'address', internalType: 'address' },
    ],
    outputs: [{ name: '', type: 'bool', internalType: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'isAuthorizedMintRecipient',
    inputs: [
      { name: 'policyId', type: 'uint64', internalType: 'uint64' },
      { name: 'wallet', type: 'address', internalType: 'address' },
    ],
    outputs: [{ name: '', type: 'bool', internalType: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'policyExists',
    inputs: [{ name: 'policyId', type: 'uint64', internalType: 'uint64' }],
    outputs: [{ name: '', type: 'bool', internalType: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'policyData',
    inputs: [{ name: 'policyId', type: 'uint64', internalType: 'uint64' }],
    outputs: [
      { name: 'policyType', type: 'uint8' },
      { name: 'admin', type: 'address' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'modifyPolicyWhitelist',
    inputs: [
      { name: 'policyId', type: 'uint64', internalType: 'uint64' },
      { name: 'addresses', type: 'address[]', internalType: 'address[]' },
      { name: 'addToList', type: 'bool', internalType: 'bool' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'modifyPolicyBlacklist',
    inputs: [
      { name: 'policyId', type: 'uint64', internalType: 'uint64' },
      { name: 'addresses', type: 'address[]', internalType: 'address[]' },
      { name: 'addToList', type: 'bool', internalType: 'bool' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'createPolicy',
    inputs: [
      { name: 'admin', type: 'address', internalType: 'address' },
      { name: 'rules', type: 'bytes', internalType: 'bytes' },
    ],
    outputs: [{ name: 'policyId', type: 'uint64', internalType: 'uint64' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'updatePolicy',
    inputs: [
      { name: 'policyId', type: 'uint64', internalType: 'uint64' },
      { name: 'rules', type: 'bytes', internalType: 'bytes' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'getPolicyAdmin',
    inputs: [{ name: 'policyId', type: 'uint64', internalType: 'uint64' }],
    outputs: [{ name: '', type: 'address', internalType: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'setPolicyAdmin',
    inputs: [
      { name: 'policyId', type: 'uint64', internalType: 'uint64' },
      { name: 'newAdmin', type: 'address', internalType: 'address' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
] as const
