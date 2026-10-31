/** Load existing lazy attachment thumbnails without sending messages or regenerating. */
export async function hydrateAttachments(page) {
  const images = page.locator('button[aria-label^="Open generated image "]');
  const count = await images.count();
  for (let i = 0; i < count; i++) {
    const image = images.nth(i);
    if (image.isVisible && !(await image.isVisible())) continue;
    await image.scrollIntoViewIfNeeded({ timeout: 10000 });
    await image
      .locator('img')
      .first()
      .waitFor({ state: 'attached', timeout: 15000 });
  }
  if (count)
    await page.waitForFunction(
      () => {
        const nodes = [
          ...document.querySelectorAll(
            'button[aria-label^="Open generated image "] img',
          ),
        ].filter((n) => n.getClientRects().length > 0);
        return (
          nodes.length > 0 &&
          nodes.every((n) => n.complete && n.naturalWidth > 0)
        );
      },
      null,
      { timeout: 30000 },
    );
  return count;
}
