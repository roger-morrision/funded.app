import { initializeAppState } from '../runtime.js';

// Startup runs in the order declared in start.js.
export function initializeAirdropDirectory(appState) {
  // app-source: 326
  let airdropDirectoryPage = 1;
  initializeAppState(appState, 'airdropDirectoryPage', airdropDirectoryPage);
  // app-source-end

  // app-source: 327
  let airdropDirectoryStatus = 'upcoming';
  initializeAppState(appState, 'airdropDirectoryStatus', airdropDirectoryStatus);
  // app-source-end

  // app-source: 328
  const AIRDROP_DIRECTORY_PAGE_SIZE = 10;
  initializeAppState(appState, 'AIRDROP_DIRECTORY_PAGE_SIZE', AIRDROP_DIRECTORY_PAGE_SIZE);
  // app-source-end

}
