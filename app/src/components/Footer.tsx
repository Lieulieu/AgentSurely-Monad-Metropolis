import { Wordmark } from "./Logo";

export function Footer() {
  return (
    <footer className="mt-24 border-t border-night-line bg-night text-white/60">
      <div className="page flex flex-col gap-6 py-10 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <Wordmark dark />
          <p className="mt-2 max-w-md text-sm">
            Performance bonds for ERC-8004 AI agents. Verified by a Chainlink CRE workflow, settled on Monad.
          </p>
          <p className="mt-2 text-xs">Chủ biên: Nguyễn Thị Liễu</p>
        </div>
        <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
          <a className="hover:text-white" href="https://docs.chain.link/cre" target="_blank" rel="noreferrer">Chainlink CRE</a>
          <a className="hover:text-white" href="https://eips.ethereum.org/EIPS/eip-8004" target="_blank" rel="noreferrer">ERC-8004</a>
          <a className="hover:text-white" href="https://docs.monad.xyz" target="_blank" rel="noreferrer">Monad docs</a>
        </div>
      </div>
    </footer>
  );
}
