// Open the responsive guide browser through its native control. Keep the
// original Back → Search keyboard sequence for the existing interaction checks.
export async function expandDocsBrowser(page) {
  const browse = page.getByRole('button', {name:'Browse guides', exact:true});
  if (await browse.isVisible() && await browse.getAttribute('aria-expanded') === 'false') {
    await browse.click();
    await page.keyboard.press('Tab');
  }
}
