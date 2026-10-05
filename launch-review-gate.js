import { freshLaunchReview } from './launch-review.js';

export function launchReviewStillCurrent(pending, current, now = Date.now()) {
  return Boolean(pending && current
    && pending.reviewedCost === current.reviewedCost
    && freshLaunchReview(pending.reviewedCost, now)
    && pending.wallet === current.wallet
    && pending.router === current.router
    && pending.tierQuoteId === current.tierQuoteId
    && pending.tierBurnAmount === current.tierBurnAmount
    && pending.form === current.form
    && pending.image === current.image
    && current.feeConsent === true
    && current.termsConsent === true);
}
