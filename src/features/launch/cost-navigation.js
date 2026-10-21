// Local navigation only. Cost rendering, request admission and wizard state
// remain owned by their existing controllers.
export function bindLaunchCostNavigation(appState, document = globalThis.document, window = globalThis.window) {
  const page = document.querySelector('#launch-dialog');
  const back = document.querySelector('#launch-cost-return');
  if (!page || !back) return;
  let invoker = null;
  let pendingFocusFrame = null;
  let focusEpisode = 0;
  const invalidateFocusFrame = () => {
    ++focusEpisode;
    if (pendingFocusFrame !== null) window.cancelAnimationFrame(pendingFocusFrame);
    pendingFocusFrame = null;
  };
  const visible = element => Boolean(element?.isConnected && element.getClientRects().length);
  const current = button => !appState.wallet && appState.requestedPageRoute() === 'launch'
    && window.matchMedia('(max-width:600px)').matches
    && document.querySelector('#cost-summary')?.classList.contains('public-launch-planning')
    && visible(button) && button.dataset.launchCostStep === page.dataset.step;
  const clearReturn = () => {
    invalidateFocusFrame();
    back.hidden = true;
    document.querySelector('#launch-cost-details')?.classList.remove('launch-cost-navigation-target');
    invoker = null;
  };
  const positionReturn = () => {
    const target = document.querySelector('#launch-cost-details');
    const summary = document.querySelector('#cost-summary');
    if (!target || !summary || back.hidden) return;
    if (!current(invoker)) { clearReturn(); return; }
    // The summary may be reparented by the existing page mount. The return
    // control stays outside the whole live region, in reserved space above
    // the persistent review wrapper, and scrolls with that ordinary content.
    const host = summary.parentElement;
    if (back.parentElement !== host || back.nextElementSibling !== summary) host.insertBefore(back, summary);
    host.classList.add('launch-cost-return-host');
    const rect = target.getBoundingClientRect(), bounds = host.getBoundingClientRect();
    back.style.left = `${rect.left - bounds.left - host.clientLeft + host.scrollLeft}px`;
    back.style.top = `${rect.top - bounds.top - host.clientTop + host.scrollTop - back.offsetHeight - 8}px`;
    back.style.width = `${rect.width}px`;
  };
  const reveal = element => {
    element.scrollIntoView({block:'start', behavior:'instant'});
    const header = document.querySelector('.topbar');
    const top = header?.getClientRects().length ? Math.max(0, header.getBoundingClientRect().bottom) : 0;
    // Leave room for the observed native post-focus scroll adjustment and the
    // full focus outline. This stays local to explicit/new-control navigation.
    window.scrollBy({top:element.getBoundingClientRect().top - top - 32, behavior:'instant'});
  };
  const revealFocusedControl = (control, contextInvoker) => {
    invalidateFocusFrame();
    if (document.activeElement !== control || !visible(control) || !current(contextInvoker)) return;
    if (control === back) positionReturn();
    reveal(control);
    const episode = focusEpisode;
    // One post-native-focus check, never a loop or a delayed focus transfer.
    pendingFocusFrame = window.requestAnimationFrame(() => {
      if (episode !== focusEpisode || document.activeElement !== control
        || !visible(control) || !current(contextInvoker)) return;
      pendingFocusFrame = null;
      window.scrollTo({top:window.scrollY, left:window.scrollX, behavior:'instant'});
      if (control === back) positionReturn();
      const rect = control.getBoundingClientRect(), style = window.getComputedStyle(control);
      const outline = (parseFloat(style.outlineWidth) || 0) + Math.max(0, parseFloat(style.outlineOffset) || 0);
      const header = document.querySelector('.topbar'), nav = document.querySelector('.mobile-workspace-nav');
      const top = header?.getClientRects().length ? Math.max(0, header.getBoundingClientRect().bottom) : 0;
      const bottom = nav?.getClientRects().length ? Math.min(window.innerHeight, nav.getBoundingClientRect().top) : window.innerHeight;
      if (rect.top - outline < top || rect.bottom + outline > bottom
        || rect.left - outline < 0 || rect.right + outline > window.innerWidth) reveal(control);
    });
  };
  // Native reverse navigation can arrive while the browser is still scrolling
  // toward the previous control. Only the newly focused navigation button may
  // cancel that superseded scroll; never move focus or change native Tab order.
  back.addEventListener('focus', () => {
    if (!back.hidden) revealFocusedControl(back, invoker);
  });
  back.addEventListener('blur', invalidateFocusFrame);
  page.querySelectorAll('[data-launch-cost-step]').forEach(button => {
    button.addEventListener('focus', () => {
      revealFocusedControl(button, button);
    });
    button.addEventListener('blur', invalidateFocusFrame);
    button.addEventListener('click', () => {
    if (!current(button)) return;
    const target = document.querySelector('#launch-cost-details');
    if (!visible(target)) return;
    invoker = button;
    target.tabIndex = -1;
    target.setAttribute('role', 'region');
    target.setAttribute('aria-label', 'Review launch costs');
    target.classList.add('launch-cost-navigation-target');
    back.hidden = false;
    positionReturn();
    reveal(back);
    target.focus({preventScroll:true});
    });
  });
  back.addEventListener('click', () => {
    if (!current(invoker)) return;
    const destination = invoker;
    clearReturn();
    reveal(destination);
    destination.focus({preventScroll:true});
  });
  // Context updates invalidate queued focus work; never move focus or request.
  const contextChanged = () => { invalidateFocusFrame(); positionReturn(); };
  window.addEventListener('resize', contextChanged);
  window.addEventListener('funded:launch-step', contextChanged);
  window.addEventListener('hashchange', contextChanged);
  window.addEventListener('popstate', contextChanged);
  document.fonts?.addEventListener('loadingdone', positionReturn);
}
