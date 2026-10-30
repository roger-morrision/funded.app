import { apiRequest } from '../../../client.js';
export function mountUpcomingAnnouncements(page, creator) {
  const upcoming = Array.isArray(creator.upcoming) ? creator.upcoming : [];
  if (!upcoming.length) return;
  const section = document.createElement('section'); section.className = 'flow-panel';
  section.innerHTML = '<h2>Upcoming creator announcements</h2><p>Scheduled publication times. Reload after the scheduled time to read the update. Reminders are saved on this device; open this app to see them.</p>';
  for (const update of upcoming) {
    const row = document.createElement('p'), time = document.createElement('time'); time.dateTime = update.publishAt;
    time.textContent = new Date(update.publishAt).toLocaleString();
    const button = document.createElement('button'); button.type = 'button'; button.textContent = 'Remind me';
    button.dataset.announcementReminder = update.publishAt; button.dataset.reminderHref = `/creator/x/${creator.id}`;
    const status = document.createElement('span'); status.setAttribute('role', 'status'); row.append(time, document.createTextNode(' '), button, status); section.append(row);
  }
  page.querySelector('.creator-updates')?.before(section);
}
export function mountAnnouncementSettings(page, managed) {
  const form = page.querySelector('#creator-update-form'), status = page.querySelector('#creator-settings-status');
  if (!form) return;
  const scheduling = managed.announcements?.scheduling === true;
  let updates = [...(managed.profile?.updates || [])];
  const label = document.createElement('label'); label.textContent = 'Publish at (optional, your local time)';
  const date = document.createElement('input'); date.type = 'datetime-local'; date.id = 'creator-update-time'; label.append(date);
  date.disabled = !scheduling;
  form.querySelector('textarea').closest('label').after(label);
  form.querySelector('p').textContent = scheduling ? 'Leave time empty to publish now, or schedule within 30 days. Published after that time on the public creator page. Opt-in listing and verified X session required; no trade is scheduled.' : 'This API supports immediate publication only. Scheduling requires the updated API; no scheduled request will be sent.';
  form.querySelector('button').textContent = scheduling ? 'Publish or schedule update' : 'Publish update';
  const list = document.createElement('section'); list.className = 'flow-panel'; form.after(list);
  const post = body => apiRequest('/api/creator-support/updates', { method:'POST', headers:{'x-creator-csrf':managed.csrf}, body });
  function render() {
    list.replaceChildren(); const title = document.createElement('h3'); title.textContent = 'Scheduled announcements'; list.append(title);
    const pending = updates.filter(row => Date.parse(row.publishAt) > Date.now());
    for (const row of pending) {
      const item = document.createElement('p'); item.textContent = `${new Date(row.publishAt).toLocaleString()} · ${row.text} `;
      const button = document.createElement('button'); button.type = 'button'; button.textContent = 'Cancel scheduled update';
      button.disabled = !scheduling;
      button.addEventListener('click', async () => {
        button.disabled = true;
        try { const result = await post({cancelId:row.id}); if (!result.available || !result.data?.cancelled) throw new Error('Cancellation unavailable. Refresh settings to check its state.'); updates = updates.filter(other => other.id !== row.id); status.textContent = 'Scheduled announcement cancelled.'; render(); }
        catch (error) { status.textContent = error.message; button.disabled = false; }
      }); item.append(button); list.append(item);
    }
    if (!pending.length) list.append(Object.assign(document.createElement('p'), { textContent:'No pending scheduled announcements.' }));
  }
  form.onsubmit = async event => {
    event.preventDefault(); const button = form.querySelector('button'); button.disabled = true;
    try {
      if (date.value && !scheduling) throw new Error('Scheduling requires the updated API. No update was sent.');
      const at = date.value ? new Date(date.value).getTime() : null;
      if (date.value && (!Number.isFinite(at) || at <= Date.now() || at > Date.now() + 30 * 86400000)) throw new Error('Choose a future time within 30 days.');
      const result = await post({text:form.querySelector('textarea').value, ...(scheduling ? {publishAt:at ? new Date(at).toISOString() : null} : {})});
      if (!result.available || !result.data?.id) throw new Error('Update unavailable. Refresh your settings before trying again.');
      if (at && result.data.publishAt !== new Date(at).toISOString()) throw new Error('Scheduling outcome could not be verified. Refresh settings before trying again.');
      updates.push(result.data); form.querySelector('textarea').value = ''; date.value = '';
      status.textContent = Date.parse(result.data.publishAt) > Date.now() ? 'Announcement scheduled. You can cancel it below.' : 'Update published.'; render();
    } catch (error) { status.textContent = error.message; }
    finally { button.disabled = false; }
  };
  render();
}
