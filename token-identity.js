export function portfolioTokenIdentity(mint, { asset, launch, metadata, fundedMint } = {}) {
  const short = `${String(mint).slice(0,6)}…${String(mint).slice(-6)}`;
  if (mint && mint === fundedMint) return { label:'$FUNDED', description:'Funded · platform token', address:short };
  const usable = value => typeof value === 'string' && value.trim() && value !== mint && value !== short;
  const symbol = [launch?.symbol, metadata?.symbol, asset?.symbol].find(usable);
  const name = [launch?.name, metadata?.name, asset?.name].find(usable);
  return { label:symbol || name || 'Unnamed token', description:name && name !== symbol ? name : symbol ? 'Token name unavailable' : 'Name unavailable', address:short };
}
