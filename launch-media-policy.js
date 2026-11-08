// Published Pump requirements checked 2026-11-08:
// https://intercom.help/pumpfun-web/en/articles/11974680-create-a-coin-on-the-mobile-app
// Source files are prepared locally; the smaller published-byte cap is our API limit.
export const MAX_PUBLISHED_IMAGE_BYTES = 600_000;
export const LAUNCH_MEDIA = Object.freeze({
  logo: Object.freeze({ maxSourceBytes:15_000_000, width:1024, height:1024 }),
  banner: Object.freeze({ maxSourceBytes:5_000_000, width:1500, height:500 }),
});
export function validateLaunchMedia(file, kind='logo') {
  if(!file)return;
  const policy=LAUNCH_MEDIA[kind];
  if(!policy)throw Error('Unknown launch image type.');
  if(!['image/png','image/jpeg','image/webp'].includes(file.type))throw Error('Use a PNG, JPEG or WebP image.');
  if(!Number.isSafeInteger(file.size)||file.size<=0||file.size>policy.maxSourceBytes)
    throw Error(`Choose a ${kind} up to ${policy.maxSourceBytes/1_000_000} MB.`);
}
