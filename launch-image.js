export const MAX_IMAGE_BYTES=600000;
export function validateImageFile(file){if(!file)return;if(!['image/png','image/jpeg','image/webp'].includes(file.type))throw new Error('Use a PNG, JPEG or WebP image.');if(file.size>12_000_000)throw new Error('Choose an image under 12 MB.');}
export function imageDimensions(width,height,crop=false){if(width<1||height<1||width*height>25_000_000)throw new Error('Image must be at most 25 megapixels.');const ratio=Math.min(1,1024/Math.max(width,height));return crop?{width:Math.round(Math.min(width,height)*ratio),height:Math.round(Math.min(width,height)*ratio)}:{width:Math.max(1,Math.round(width*ratio)),height:Math.max(1,Math.round(height*ratio))};}
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
    if(crop)ctx.drawImage(bitmap,(bitmap.width-side)/2,(bitmap.height-side)/2,side,side,0,0,size.width,size.height);else ctx.drawImage(bitmap,0,0,size.width,size.height);
    let blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
    for(const quality of [.9,.8,.65,.5]){if(blob&&blob.size<=MAX_IMAGE_BYTES)break;blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/webp',quality));}
    if(!blob||blob.size>MAX_IMAGE_BYTES)throw new Error('This image is still too complex. Try a smaller or simpler image.');
    if(request!==generation)return null;
    prepared=new File([blob],`coin-image.${blob.type==='image/png'?'png':'webp'}`,{type:blob.type});
    if(previewUrl)URL.revokeObjectURL(previewUrl);previewUrl=URL.createObjectURL(blob);
    return {file:prepared,url:previewUrl,...size};
  }catch(cause){if(request===generation)error=cause.message;throw cause;}finally{bitmap?.close();if(request===generation)pending=false;}
}
