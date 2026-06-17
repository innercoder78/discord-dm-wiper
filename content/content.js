(function () {
  'use strict';
  if (window.__discordDmWiperLoaded) return;
  window.__discordDmWiperLoaded = true;

  const state = {
    settings: null,
    messages: new Map(),
    reactions: new Map(),
    observer: null,
    scanTimer: 0,
    wipeList: null,
    mode: 'idle',
    paused: false,
    stopped: false,
    stats: { messagesDeleted: 0, reactionsUndone: 0, skipped: 0, failed: 0 },
    status: 'Scroll this DM to scan loaded history.'
  };

  chrome.runtime.onMessage.addListener((message) => {
    if (message && message.type === 'DDMW_START') startOverlay(message.settings);
  });

  function startOverlay(settings) {
    state.settings = settings;
    state.messages.clear();
    state.reactions.clear();
    state.wipeList = null;
    state.mode = 'review';
    state.status = 'Scroll this DM to scan loaded history.';
    renderReview();
    installScanners();
    scanLoadedMessages('Scanning loaded history...');
  }

  function renderReview() {
    const overlay = ensureOverlay();
    overlay.innerHTML = `
      <header><h2>Discord DM Wiper</h2><h3>Scan &amp; Review Wipe List</h3></header>
      <section>
        <p>Scroll through the part of this DM you want included.</p>
        <p>${state.settings.rangeMode === 'date' ? 'For a date range, scroll around that range.' : 'For EVERYTHING, scroll through as much history as you want included.'}</p>
        <p class="muted">EVERYTHING means every matching item scanned in this DM, not messages Discord has not loaded yet.</p>
      </section>
      <section><strong>Current wipe settings</strong><div class="grid">
        <span>Range</span><span>${rangeLabel()}</span>
        <span>Display name</span><span>${escapeHtml(state.settings.displayName)}</span>
        <span>Wipe options selected</span><span>${optionsLabel()}</span>
      </div></section>
      <section><strong>Found so far</strong>
        <p id="ddmw-msg-count">Messages to delete: ${messageCount()}</p>
        <p id="ddmw-react-count">Reactions to undo: ${reactionCount()}</p>
        <p id="ddmw-estimate">Estimated deletion time: ${estimate()}</p>
        <p id="ddmw-status">Status: ${state.status}</p>
      </section>
      <section><strong>Backup reminder</strong>
        <p>Before wiping anything, you may want to back up this conversation first.</p>
        <p><a href="https://github.com/innercoder78/discord-dm-exporter" target="_blank" rel="noopener noreferrer">Discord DM Exporter</a></p>
        <p class="warning">Deleted messages and undone reactions cannot be restored by this extension.</p>
      </section>
      <section>
        <label><input id="ddmw-understand" type="checkbox"> I understand this cannot be undone.</label>
        <label>Type DELETE to confirm:<input id="ddmw-delete-text" type="text" autocomplete="off"></label>
        <button class="secondary" id="ddmw-cancel">Cancel</button><button class="danger" id="ddmw-confirm" disabled>Confirm Wipe</button>
      </section>`;
    overlay.querySelector('#ddmw-cancel').onclick = closeOverlay;
    overlay.querySelector('#ddmw-confirm').onclick = beginWipe;
    overlay.querySelector('#ddmw-understand').oninput = updateConfirmState;
    overlay.querySelector('#ddmw-delete-text').oninput = updateConfirmState;
    updateConfirmState();
  }

  function installScanners() {
    document.addEventListener('scroll', scheduleScan, true);
    state.observer?.disconnect();
    state.observer = new MutationObserver(() => scheduleScan());
    state.observer.observe(document.body, { childList: true, subtree: true });
  }
  function scheduleScan() { if (state.mode !== 'review') return; clearTimeout(state.scanTimer); state.scanTimer = setTimeout(() => scanLoadedMessages('Scanning loaded history...'), 250); }

  function scanLoadedMessages(status) {
    state.status = status;
    const before = messageCount() + reactionCount();
    getMessageNodes().forEach(scanMessageNode);
    const after = messageCount() + reactionCount();
    state.status = after > before ? 'New matching items found.' : (after > 0 ? 'Ready to wipe.' : 'No new matching items found recently. Scroll farther to include more history.');
    updateCounts();
  }

  function getMessageNodes() { return Array.from(document.querySelectorAll('[id^="chat-messages-"], li[class*="messageListItem"], div[class*="messageListItem"]')); }
  function scanMessageNode(node) {
    const id = getMessageId(node);
    if (!id || node.closest('[class*="repliedMessage"], [class*="replyBar"]')) return;
    const author = getAuthor(node);
    const date = getMessageDate(node);
    if (!date || !isInRange(date)) return;
    if (state.settings.deleteMessages && author === state.settings.displayName) state.messages.set(id, { id, author, time: date.getTime() });
    if (state.settings.undoReactions && !(author === state.settings.displayName && state.settings.deleteMessages)) {
      findOwnReactions(node).forEach((reaction, index) => state.reactions.set(`${id}:r:${index}:${reaction.label}`, { id: `${id}:r:${index}:${reaction.label}`, messageId: id, label: reaction.label }));
    }
  }
  function getMessageId(node) { const raw = node.id || node.getAttribute('data-list-item-id') || ''; const match = raw.match(/(\d{15,25})/); return match ? match[1] : null; }
  function getAuthor(node) { const author = node.querySelector('[class*="username"], h3 span, [aria-label*="Username"]'); return author ? author.textContent.trim() : ''; }
  function getMessageDate(node) { const time = node.querySelector('time[datetime]'); if (!time) return null; const date = new Date(time.getAttribute('datetime')); return Number.isNaN(date.getTime()) ? null : date; }
  function findOwnReactions(node) {
    return Array.from(node.querySelectorAll('[aria-pressed="true"][aria-label], button[class*="reactionMe"], div[class*="reactionMe"][aria-label]')).map((el) => ({ el, label: el.getAttribute('aria-label') || el.textContent.trim() })).filter((r) => r.label);
  }
  function isInRange(date) {
    if (state.settings.rangeMode === 'everything') return true;
    const start = localBoundary(state.settings.fromDate, false).getTime();
    const end = localBoundary(state.settings.toDate, true).getTime();
    const t = date.getTime();
    return t >= start && t <= end;
  }
  function localBoundary(value, end) { const [y, m, d] = value.split('-').map(Number); return new Date(y, m - 1, d, end ? 23 : 0, end ? 59 : 0, end ? 59 : 0, end ? 999 : 0); }

  function beginWipe() {
    state.wipeList = { messages: Array.from(state.messages.values()), reactions: Array.from(state.reactions.values()) };
    state.mode = 'wiping'; state.paused = false; state.stopped = false; state.stats = { messagesDeleted: 0, reactionsUndone: 0, skipped: 0, failed: 0 };
    renderProgress(); wipeLoop();
  }
  async function wipeLoop() {
    for (const target of state.wipeList.reactions) { if (!(await waitIfPaused())) break; await randomDelay(); await undoReaction(target); renderProgress(); }
    for (const target of state.wipeList.messages) { if (!(await waitIfPaused())) break; await randomDelay(); await deleteMessage(target); renderProgress(); }
    if (!state.stopped) renderComplete();
  }
  async function waitIfPaused() { while (state.paused && !state.stopped) await sleep(250); return !state.stopped; }
  async function undoReaction(target) {
    const node = findNodeByMessageId(target.messageId); const reaction = node && findOwnReactions(node).find((r) => r.label === target.label);
    if (!reaction) { state.stats.skipped++; return; }
    reaction.el.click();
    const ok = await waitFor(() => { const fresh = findNodeByMessageId(target.messageId); return !fresh || !findOwnReactions(fresh).some((r) => r.label === target.label); }, 12000);
    ok ? state.stats.reactionsUndone++ : pauseOnStall();
  }
  async function deleteMessage(target) {
    const node = findNodeByMessageId(target.id);
    if (!node || getAuthor(node) !== state.settings.displayName) { state.stats.skipped++; return; }
    node.scrollIntoView({ block: 'center' }); node.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    await sleep(300);
    const more = findVisibleButton(['More', 'Actions', 'message-actions']) || node.querySelector('button[aria-label*="More"], button[aria-label*="Actions"]');
    if (more) more.click();
    await sleep(300);
    const del = findMenuItem(/delete message/i) || findVisibleButton(['Delete Message', 'Delete']);
    if (!del) { state.stats.skipped++; return; }
    del.click(); await sleep(300);
    const confirm = findMenuItem(/^delete$/i) || findVisibleButton(['Delete']);
    if (confirm) confirm.click();
    const ok = await waitFor(() => !findNodeByMessageId(target.id), 15000);
    ok ? state.stats.messagesDeleted++ : pauseOnStall();
  }
  function pauseOnStall() { state.stats.failed++; state.paused = true; state.status = 'Wiping paused. Discord did not confirm the last deletion. This may be caused by lag, a dropped connection, a Discord outage, or a UI change.'; }
  function findNodeByMessageId(id) { return document.getElementById(`chat-messages-${id}`) || getMessageNodes().find((n) => getMessageId(n) === id); }
  function findVisibleButton(labels) { return Array.from(document.querySelectorAll('button[aria-label], [role="button"][aria-label]')).find((b) => labels.some((l) => (b.getAttribute('aria-label') || '').includes(l))); }
  function findMenuItem(regex) { return Array.from(document.querySelectorAll('[role="menuitem"], button')).find((el) => regex.test(el.textContent.trim()) || regex.test(el.getAttribute('aria-label') || '')); }

  function renderProgress() { const overlay = ensureOverlay(); overlay.innerHTML = `<header><h2>Discord DM Wiper</h2><h3>Wiping...</h3></header><section><p>Messages deleted: ${state.stats.messagesDeleted} / ${state.wipeList.messages.length}</p><p>Reactions undone: ${state.stats.reactionsUndone} / ${state.wipeList.reactions.length}</p><p>Skipped: ${state.stats.skipped}</p><p>Failed: ${state.stats.failed}</p><p>Status: ${state.status}</p><button id="ddmw-pause">Pause</button><button id="ddmw-resume">Resume</button><button id="ddmw-skip" class="secondary">Skip</button><button id="ddmw-stop" class="danger">Stop</button></section>`; overlay.querySelector('#ddmw-pause').onclick=()=>{state.paused=true;}; overlay.querySelector('#ddmw-resume').onclick=()=>{state.paused=false; state.status='Resuming wipe.';}; overlay.querySelector('#ddmw-skip').onclick=()=>{state.paused=false; state.status='Skipped stalled item.';}; overlay.querySelector('#ddmw-stop').onclick=()=>{state.stopped=true; renderComplete();}; }
  function renderComplete() { state.mode='complete'; const s=state.stats; ensureOverlay().innerHTML = `<header><h2>Discord DM Wiper</h2><h3>Wipe complete</h3></header><section><p>Messages deleted: ${s.messagesDeleted}</p><p>Reactions undone: ${s.reactionsUndone}</p><p>Skipped: ${s.skipped}</p><p>Failed: ${s.failed}</p><button id="ddmw-close">Close</button></section>`; document.getElementById('ddmw-close').onclick=closeOverlay; }

  function updateCounts() { const o=document.getElementById('ddmw-overlay'); if(!o) return; const ids=['ddmw-msg-count','ddmw-react-count','ddmw-estimate','ddmw-status']; if(!ids.every((id)=>document.getElementById(id))) return; document.getElementById('ddmw-msg-count').textContent=`Messages to delete: ${messageCount()}`; document.getElementById('ddmw-react-count').textContent=`Reactions to undo: ${reactionCount()}`; document.getElementById('ddmw-estimate').textContent=`Estimated deletion time: ${estimate()}`; document.getElementById('ddmw-status').textContent=`Status: ${state.status}`; updateConfirmState(); }
  function updateConfirmState() { const btn=document.getElementById('ddmw-confirm'), chk=document.getElementById('ddmw-understand'), txt=document.getElementById('ddmw-delete-text'); if(!btn||!chk||!txt) return; btn.disabled = messageCount()+reactionCount() < 1 || !chk.checked || txt.value !== 'DELETE' || (!state.settings.deleteMessages && !state.settings.undoReactions); }
  function ensureOverlay() { let o=document.getElementById('ddmw-overlay'); if(!o){ o=document.createElement('div'); o.id='ddmw-overlay'; document.body.appendChild(o);} return o; }
  function closeOverlay(){ document.getElementById('ddmw-overlay')?.remove(); state.observer?.disconnect(); document.removeEventListener('scroll', scheduleScan, true); }
  function messageCount(){ return state.settings?.deleteMessages ? state.messages.size : 0; } function reactionCount(){ return state.settings?.undoReactions ? state.reactions.size : 0; }
  function estimate(){ const total=messageCount()+reactionCount(); if(!total) return '—'; const min=total, max=total*2; return max<90 ? `about ${min}–${max} seconds` : `about ${Math.ceil(min/60)}–${Math.ceil(max/60)} minutes`; }
  function rangeLabel(){ return state.settings.rangeMode === 'everything' ? 'EVERYTHING scanned in this DM' : `${state.settings.fromDate} through ${state.settings.toDate}`; }
  function optionsLabel(){ return [state.settings.deleteMessages&&'Delete my messages', state.settings.undoReactions&&'Undo my reactions'].filter(Boolean).join(', '); }
  function randomDelay(){ return sleep(1000 + Math.floor(Math.random() * 1001)); } function sleep(ms){ return new Promise((r)=>setTimeout(r,ms)); }
  async function waitFor(fn, timeout){ const end=Date.now()+timeout; while(Date.now()<end){ if(fn()) return true; await sleep(300);} return false; }
  function escapeHtml(v){ return String(v).replace(/[&<>"]/g, (c)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
}());
