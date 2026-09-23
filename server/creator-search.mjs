// Code-point grams preserve Unicode without creating isolated surrogate halves.
export function searchGrams(value, allSizes = false) {
  const chars=Array.from(String(value).toLowerCase());
  const sizes=allSizes?[1,2,3]:[Math.min(3,chars.length)];
  const grams=new Set();
  for(const size of sizes)if(size>0)for(let i=0;i+size<=chars.length;i++)grams.add(chars.slice(i,i+size).join(''));
  return [...grams].sort();
}
