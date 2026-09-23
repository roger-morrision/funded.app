// Keep keyboard context with the visible panel, never a now-hidden action.
export function focusLaunchStep(dialog,step,{reducedMotion=false}={}) {
  if(!dialog?.open)return;
  const panel=dialog.querySelector(`[data-launch-step="${step}"]`);
  const heading=panel?.querySelector('h3');
  if(!heading||panel.hidden)return;
  heading.tabIndex=-1;
  heading.focus({preventScroll:true});
  dialog.scrollTo({top:0,behavior:reducedMotion?'instant':'smooth'});
}
