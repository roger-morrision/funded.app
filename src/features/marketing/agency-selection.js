import { canonicalAgencySelection } from '../../../config/marketing-agency.js';

export function readLaunchAgencySelection(document = globalThis.document) {
  return canonicalAgencySelection([...document.querySelectorAll('[data-launch-agency]:checked')].map(input => input.value));
}
