import { newLaunchAgencySelection } from '../../../config/marketing-agency.js';

export function readLaunchAgencySelection(policy = {}) {
  return newLaunchAgencySelection({promotion:policy.requiresBurn===true});
}
