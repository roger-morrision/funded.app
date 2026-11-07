import { isDevnetBannerUri } from '../../../devnet-metadata.js';
import { verifiedPromotionBadge } from '../../../promotion-badge.js';
import { tokenArtworkUrl } from '../shared/token-artwork.js';

export function verifiedTokenBannerUri(launch, mint) {
  return launch?.mint === mint && verifiedPromotionBadge(launch) && isDevnetBannerUri(launch.bannerUri, mint)
    ? tokenArtworkUrl(mint, launch.bannerUri, 'banner') : '';
}
