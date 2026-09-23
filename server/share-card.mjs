import { deflateSync } from 'node:zlib';
// Dependency-free bitmap card: fixed layout, no remote media, HTML, fonts or earnings.
const glyphs={A:['01110','10001','10001','11111','10001','10001','10001'],B:['11110','10001','10001','11110','10001','10001','11110'],C:['01111','10000','10000','10000','10000','10000','01111'],D:['11110','10001','10001','10001','10001','10001','11110'],E:['11111','10000','10000','11110','10000','10000','11111'],F:['11111','10000','10000','11110','10000','10000','10000'],G:['01111','10000','10000','10111','10001','10001','01111'],H:['10001','10001','10001','11111','10001','10001','10001'],I:['11111','00100','00100','00100','00100','00100','11111'],J:['00111','00010','00010','00010','10010','10010','01100'],K:['10001','10010','10100','11000','10100','10010','10001'],L:['10000','10000','10000','10000','10000','10000','11111'],M:['10001','11011','10101','10101','10001','10001','10001'],N:['10001','11001','10101','10011','10001','10001','10001'],O:['01110','10001','10001','10001','10001','10001','01110'],P:['11110','10001','10001','11110','10000','10000','10000'],Q:['01110','10001','10001','10001','10101','10010','01101'],R:['11110','10001','10001','11110','10100','10010','10001'],S:['01111','10000','10000','01110','00001','00001','11110'],T:['11111','00100','00100','00100','00100','00100','00100'],U:['10001','10001','10001','10001','10001','10001','01110'],V:['10001','10001','10001','10001','10001','01010','00100'],W:['10001','10001','10001','10101','10101','11011','10001'],X:['10001','10001','01010','00100','01010','10001','10001'],Y:['10001','10001','01010','00100','00100','00100','00100'],Z:['11111','00001','00010','00100','01000','10000','11111'], '@':['01110','10001','10111','10101','10111','10000','01111'], '_':['00000','00000','00000','00000','00000','00000','11111'],'.':['0','0','0','0','0','1','1'],' ':[]};
for(const [i,rows] of ['01110 10001 10011 10101 11001 10001 01110','00100 01100 00100 00100 00100 00100 01110','01110 10001 00001 00010 00100 01000 11111','11110 00001 00001 01110 00001 00001 11110','00010 00110 01010 10010 11111 00010 00010','11111 10000 10000 11110 00001 00001 11110','01110 10000 10000 11110 10001 10001 01110','11111 00001 00010 00100 01000 01000 01000','01110 10001 10001 01110 10001 10001 01110','01110 10001 10001 01111 00001 00001 01110'].entries())glyphs[i]=rows.split(' ');
function crc(bytes){let c=0xffffffff;for(const b of bytes){c^=b;for(let n=0;n<8;n++)c=(c>>>1)^(0xedb88320&-(c&1));}return (c^0xffffffff)>>>0;}
function chunk(type,data){const name=Buffer.from(type),length=Buffer.alloc(4),sum=Buffer.alloc(4);length.writeUInt32BE(data.length);sum.writeUInt32BE(crc(Buffer.concat([name,data])));return Buffer.concat([length,name,data,sum]);}
export function creatorCardPng(handle,cluster,detail=null){
  const width=1200,height=630,stride=width*3+1,pixels=Buffer.alloc(stride*height);
  const rect=(x,y,w,h,color)=>{for(let row=Math.max(0,y);row<Math.min(height,y+h);row++)for(let col=Math.max(0,x);col<Math.min(width,x+w);col++){const p=row*stride+1+col*3;pixels[p]=color[0];pixels[p+1]=color[1];pixels[p+2]=color[2];}};
  const text=(value,x,y,scale,color)=>{for(const [i,char] of value.toUpperCase().split('').entries())for(const [r,line] of (glyphs[char]||glyphs[' ']).entries())for(const [c,bit] of line.split('').entries())if(bit==='1')rect(x+i*6*scale+c*scale,y+r*scale,scale,scale,color);};
  rect(0,0,width,height,[17,20,35]);rect(48,48,1104,534,[32,37,59]);rect(48,48,1104,8,[167,135,245]);
  text(`FUNDED.VIP  ${cluster==='devnet'?'DEVNET':'MAINNET'}`,95,95,5,[190,175,238]);
  if (detail?.type === 'receipt') {
    const amount=BigInt(detail.amountLamports), whole=amount/1000000000n, fraction=(amount%1000000000n).toString().padStart(9,'0').replace(/0+$/,'');
    text('CONFIRMED PAYOUT',95,170,6,[245,246,255]);
    text(String(handle).slice(0,16),95,245,7,[245,246,255]);
    text(`${whole}${fraction?'.'+fraction:''} SOL`,95,325,5,[190,175,238]);
    text(`RECEIPT ${String(detail.signature).slice(0,12)}`,95,395,4,[210,217,230]);
    text('ONE RECEIPT. NOT LIFETIME EARNINGS',95,457,4,[235,210,162]);
    text('VERIFY THE FULL SIGNATURE IN APP',95,505,4,[235,210,162]);
  } else if (detail?.type === 'update') {
    text('CREATOR UPDATE',95,170,6,[245,246,255]);
    text(String(handle).slice(0,16),95,245,7,[245,246,255]);
    text(String(detail.createdAt).slice(0,10).replaceAll('-','.'),95,325,5,[190,175,238]);
    text('READ THE FULL UPDATE IN APP',95,405,4,[210,217,230]);
    text('ACCOUNT IDENTITY IS NOT ENDORSEMENT',95,465,4,[235,210,162]);
    text('TOKENS CAN LOSE ALL VALUE',95,515,4,[235,210,162]);
  } else {
    text('SUPPORT',95,190,7,[245,246,255]);text(String(handle).slice(0,16),95,280,10,[245,246,255]);
    text('VERIFY POLICIES AND PAYOUT RECEIPTS',95,408,4,[210,217,230]);
    text('FAN COINS ARE NOT ENDORSEMENTS',95,466,4,[235,210,162]);
    text('TOKENS CAN LOSE ALL VALUE',95,515,4,[235,210,162]);
  }
  const header=Buffer.alloc(13);header.writeUInt32BE(width);header.writeUInt32BE(height,4);header[8]=8;header[9]=2;
  return Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),chunk('IHDR',header),chunk('IDAT',deflateSync(pixels)),chunk('IEND',Buffer.alloc(0))]);
}
