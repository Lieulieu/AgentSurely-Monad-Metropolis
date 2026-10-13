/** Canonical ERC-8004 deployments (github.com/erc-8004/erc-8004-contracts). */
export const CANONICAL_8004: Record<number, { identity: string; reputation: string; validation?: string }> = {
  // Monad testnet
  10143: {
    identity: "0x8004A818BFB912233c491871b3d84c89A494BD9e",
    reputation: "0x8004B663056A597Dffe9eCcC1965A193B7388713",
  },
  // Monad mainnet
  143: {
    identity: "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432",
    reputation: "0x8004BAa17C55a88189AE136b182e5fdA19dE9b63",
  },
};

/** CRE forwarders for monad-testnet (docs.chain.link/cre → Forwarder Directory). */
export const CRE_FORWARDERS = {
  monadTestnet: {
    simulation: "0xB9F79d863261869B234c481D1f9A7af84AeAd192", // MockKeystoneForwarder — `cre workflow simulate --broadcast`
    production: "0xF8344CFd5c43616a4366C34E3EEE75af79a74482", // KeystoneForwarder — deployed workflows
  },
};

/** Minimal ABI that works against both the canonical registry and the mock. */
export const IDENTITY_MIN_ABI = [
  "function register(string agentURI) returns (uint256)",
  "function ownerOf(uint256) view returns (address)",
  "event Registered(uint256 indexed agentId, string agentURI, address indexed owner)",
];
