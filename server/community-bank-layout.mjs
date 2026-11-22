import assert from 'node:assert/strict';
import {PublicKey} from '@solana/web3.js';
import {TOKEN_PROGRAM_ID,TOKEN_2022_PROGRAM_ID,unpackMint,unpackAccount,
  isMintExtension,isAccountExtension,getTypeLen,ExtensionType} from '@solana/spl-token';
import {unpack as unpackMetadata,pack as packMetadata} from '@solana/spl-token-metadata';

// Structural decoding of retained public bytes, not admission of an extension's
// financial behavior. Unknown/malformed layouts cannot qualify archival input.
export function decodeCommunityBankLayout({data,programId,address,kind}){
  const mint=kind==='mint',program=new PublicKey(programId),key=new PublicKey(address),base=mint?82:165;
  assert(mint||kind==='account','Unknown raw bank layout.');
  assert(program.equals(TOKEN_PROGRAM_ID)||program.equals(TOKEN_2022_PROGRAM_ID),'Unsupported raw bank owner.');
  assert(data.length>=base&&(program.equals(TOKEN_2022_PROGRAM_ID)||data.length===base),'Classic SPL bank layout size differs.');
  const options=mint?[0,46]:[72,109,129];
  assert(options.every(offset=>[0,1].includes(data.readUInt32LE(offset))),'Raw bank COption layout differs.');
  assert(mint?data[45]===1:[1,2].includes(data[108]),'Raw bank initialized state differs.');
  const decoded=(mint?unpackMint:unpackAccount)(key,{owner:program,data},program);
  if(data.length>base){
    if(mint)assert(data.subarray(82,165).every(byte=>byte===0),'Extended mint padding differs.');
    // The SDK checks the extended account-type byte. Walk TLV boundaries here:
    // its general extension iterator does not reject a length past the buffer.
    const tlv=decoded.tlvData,seen=new Set();let offset=0;
    while(offset<tlv.length){
      if(tlv.subarray(offset).every(byte=>byte===0))break; // uninitialized allocation slack
      assert(offset+4<=tlv.length,'Truncated bank extension header.');
      const type=tlv.readUInt16LE(offset),length=tlv.readUInt16LE(offset+2),end=offset+4+length;
      assert(type!==0&&!seen.has(type)&&(mint?isMintExtension(type):isAccountExtension(type))&&end<=tlv.length,
        'Invalid raw bank extension type or boundary.');
      const value=tlv.subarray(offset+4,end);
      if(type===ExtensionType.TokenMetadata){
        const metadata=unpackMetadata(value);
        assert(metadata.mint.equals(key)&&Buffer.from(packMetadata(metadata)).equals(value),'Invalid token metadata bank layout.');
      }else assert(length===getTypeLen(type),'Raw bank extension size differs.');
      seen.add(type);offset=end;
    }
  }
  return decoded;
}
