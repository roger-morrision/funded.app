import { isDevnetBannerUri } from '../../../devnet-metadata.js';
import { verifiedPromotionBadge } from '../../../promotion-badge.js';

export function verifiedTokenBannerUri(launch, mint) {
  return launch?.mint === mint && verifiedPromotionBadge(launch) && isDevnetBannerUri(launch.bannerUri, mint)
    ? launch.bannerUri : '';
}
