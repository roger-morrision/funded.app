// Keep independent placement deadlines so an expired boost can fall back to a
// still-valid launch promotion or paid listing, even while the API is offline.
export function currentFeaturedTokens(items,now=Date.now()) {
  return items.flatMap(item=>{
    const placement=(item.placements||[item])
      .filter(row=>row.featuredAt<=now&&row.expiresAt>now)
      .sort((a,b)=>b.featuredAt-a.featuredAt||b.expiresAt-a.expiresAt)[0];
    return placement?[{...item,...placement}]:[];
  }).sort((a,b)=>b.featuredAt-a.featuredAt||a.mint.localeCompare(b.mint));
}
