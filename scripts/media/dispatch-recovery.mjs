/** Only text planning may be retried after a lost thread; never image generation. */
export function canRetryLostPlan(request, retries = 0) {
  return (
    request?.kind === 'plan' &&
    ['intent', 'sent', 'uncertain'].includes(request.status) &&
    (!request.thread_url ||
      new URL(request.thread_url).pathname === '/thread/new') &&
    retries < 2
  );
}

export async function submitComposer(page, editor, marker) {
  await page.waitForTimeout(300);
  await page.keyboard.press('Enter');
  for (let i = 0; i < 10; i++) {
    await page.waitForTimeout(300);
    const acknowledged = await page
      .locator('[data-message-item][data-message-role="user"]')
      .allTextContents();
    if (
      acknowledged.some((x) => x.includes(marker)) ||
      (await page.locator('[data-testid="hatch-composer-stop-button"]').count())
    )
      return;
    const text = await editor.evaluate((el) => el.value ?? el.innerText ?? '');
    if (!text.trim()) return;
  }
  const text = await editor.evaluate((el) => el.value ?? el.innerText ?? '');
  if (!text.includes(marker)) throw Error('COMPOSER_DISPATCH_UNCERTAIN');
  const send = page.locator('[data-hatch-composer-action-slot] button').last();
  if (!(await send.count()) || !(await send.isEnabled()))
    throw Error('COMPOSER_SEND_UNAVAILABLE');
  await send.click({ timeout: 5000 });
}
