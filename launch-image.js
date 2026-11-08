import { LAUNCH_MEDIA, MAX_PUBLISHED_IMAGE_BYTES, validateLaunchMedia } from './launch-media-policy.js';
export const MAX_IMAGE_BYTES=MAX_PUBLISHED_IMAGE_BYTES;
export const validateImageFile=validateLaunchMedia;
export function imageDimensions(width,height){if(!Number.isFinite(width)||!Number.isFinite(height)||width<1||height<1||width*height>25_000_000)throw new Error('Image must be at most 25 megapixels.');return {width:LAUNCH_MEDIA.logo.width,height:LAUNCH_MEDIA.logo.height};}
let prepared=null,pending=false,error=null,generation=0,previewUrl=null;
export function getPreparedImage(){return prepared;}
export function assertImageReady(){if(pending)throw new Error('Wait for image preparation to finish.');if(error)throw new Error(error);}
export async function prepareLaunchImage(file,{crop=false}={}) {
  const request=++generation;prepared=null;pending=Boolean(file);error=null;
  if(!file){if(previewUrl)URL.revokeObjectURL(previewUrl);previewUrl=null;return null;}
  let bitmap;
  try {
    validateImageFile(file);bitmap=await createImageBitmap(file);const size=imageDimensions(bitmap.width,bitmap.height,crop);
    const canvas=document.createElement('canvas');canvas.width=size.width;canvas.height=size.height;
    const ctx=canvas.getContext('2d');const side=Math.min(bitmap.width,bitmap.height);
    if(crop)ctx.drawImage(bitmap,(bitmap.width-side)/2,(bitmap.height-side)/2,side,side,0,0,size.width,size.height);
    else {const scale=Math.min(size.width/bitmap.width,size.height/bitmap.height);const width=bitmap.width*scale,height=bitmap.height*scale;ctx.drawImage(bitmap,(size.width-width)/2,(size.height-height)/2,width,height);}
    let blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
    for(const quality of [.9,.8,.65,.5]){if(blob&&blob.size<=MAX_IMAGE_BYTES)break;blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/webp',quality));}
    if(!blob||blob.size>MAX_IMAGE_BYTES)throw new Error('This image is still too complex. Try a smaller or simpler image.');
    if(request!==generation)return null;
    prepared=new File([blob],`coin-image.${blob.type==='image/png'?'png':'webp'}`,{type:blob.type});
    if(previewUrl)URL.revokeObjectURL(previewUrl);previewUrl=URL.createObjectURL(blob);
    return {file:prepared,url:previewUrl,...size};
  }catch(cause){if(request===generation)error=cause.message;throw cause;}finally{bitmap?.close();if(request===generation)pending=false;}
}
