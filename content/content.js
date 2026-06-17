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
    debugLog: [],
    discordContext: null,
    status: 'Scroll this DM to scan loaded history.'
  };

  chrome.runtime.onMessage.addListener((message) => {
    if (message && message.type === 'DDMW_START') startOverlay(message.settings);
  });

  function startOverlay(settings) {
    const context = getDiscordDmContext();
    if (!context.ok) {
      renderUnsupportedContext(context.message);
      return;
    }
    state.settings = settings;
    state.discordContext = context;
    state.debugLog = [];
    if (settings.developerMode) initializeDebugLog(context);
    state.messages.clear();
    state.reactions.clear();
    state.wipeList = null;
    state.mode = 'review';
    state.status = 'Scroll this DM to scan loaded history.';
    renderReview();
    installScanners();
    scanLoadedMessages('Scanning loaded history...');
  }

  function renderUnsupportedContext(message) {
    const overlay = ensureOverlay();
    overlay.innerHTML = `<header><h2>Discord DM Wiper</h2><h3>Unsupported Discord view</h3></header><section><p class="warning">${escapeHtml(message)}</p><p class="muted">This extension only works in Discord Web one-on-one DMs. It will not run in server channels, group DMs, or other Discord views.</p><button id="ddmw-close">Close</button></section>`;
    overlay.querySelector('#ddmw-close').onclick = closeOverlay;
  }

  function getDiscordDmContext() {
    if (location.hostname !== 'discord.com' && !location.hostname.endsWith('.discord.com')) {
      return { ok: false, message: 'Open a one-on-one Discord DM to use Discord DM Wiper.' };
    }

    const dmRoute = location.pathname.match(/^\/channels\/@me\/(\d{15,25})(?:\b|\/)?/);
    if (!dmRoute) return { ok: false, message: 'Open a one-on-one Discord DM to use Discord DM Wiper.' };

    // Discord group DMs share the /channels/@me/:id route, so the URL alone is not enough.
    // Keep this heuristic intentionally conservative and block when selected navigation or
    // the active header exposes group-DM wording.
    const activeChannel = document.querySelector('[aria-current="page"], [class*="selected"] a[href*="/channels/@me/"], a[href$="' + dmRoute[1] + '"]');
    const activeText = `${activeChannel?.textContent || ''} ${activeChannel?.getAttribute('aria-label') || ''}`;
    const header = document.querySelector('main header, [class*="chat"] header, [aria-label*="Channel header"]');
    const headerText = `${header?.textContent || ''} ${header?.getAttribute('aria-label') || ''}`;
    if (/group\s*dm|group message|members?\s*list/i.test(activeText) || /group\s*dm|group message/i.test(headerText)) {
      return { ok: false, message: 'Open a one-on-one Discord DM to use Discord DM Wiper.' };
    }

    return { ok: true };
  }

  function renderReview() {
    const overlay = ensureOverlay();
    overlay.innerHTML = `
      <header><h2>Discord DM Wiper</h2><h3>${state.settings.developerMode ? 'Developer Dry Scan' : 'Scan &amp; Review Wipe List'}</h3>${state.settings.developerMode ? '<p class="dev-label">Developer Mode / Dry Run is ON</p>' : ''}</header>
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
        <p id="ddmw-msg-count">${state.settings.developerMode ? 'Messages that would be deleted' : 'Messages to delete'}: ${messageCount()}</p>
        <p id="ddmw-react-count">${state.settings.developerMode ? 'Reactions that would be undone' : 'Reactions to undo'}: ${reactionCount()}</p>
        <p id="ddmw-estimate">${state.settings.developerMode ? 'Estimated normal-mode time' : 'Estimated deletion time'}: ${estimate()}</p>
        <p id="ddmw-status">Status: ${state.status}</p>
      </section>
      ${state.settings.developerMode ? dryRunActionsHtml() : `<section><strong>Backup reminder</strong>
        <p>Before wiping anything, you may want to back up this conversation first.</p>
        <p><a href="https://github.com/innercoder78/discord-dm-exporter" target="_blank" rel="noopener noreferrer">Discord DM Exporter</a></p>
        <p class="warning">Deleted messages and undone reactions cannot be restored by this extension.</p>
      </section>
      <section>
        <label><input id="ddmw-understand" type="checkbox"> I understand this cannot be undone.</label>
        <label>Type DELETE to confirm:<input id="ddmw-delete-text" type="text" autocomplete="off"></label>
        <button class="secondary" id="ddmw-cancel">Cancel</button><button class="danger" id="ddmw-confirm" disabled>Confirm Wipe</button>
      </section>`}`;
    overlay.querySelector('#ddmw-cancel')?.addEventListener('click', closeOverlay);
    overlay.querySelector('#ddmw-confirm')?.addEventListener('click', beginWipe);
    overlay.querySelector('#ddmw-run-dry-scan')?.addEventListener('click', () => scanLoadedMessages('Running dry scan of loaded history...'));
    overlay.querySelector('#ddmw-copy-log')?.addEventListener('click', copyDebugLog);
    overlay.querySelector('#ddmw-download-log')?.addEventListener('click', downloadDebugLog);
    overlay.querySelector('#ddmw-close')?.addEventListener('click', closeOverlay);
    overlay.querySelector('#ddmw-understand')?.addEventListener('input', updateConfirmState);
    overlay.querySelector('#ddmw-delete-text')?.addEventListener('input', updateConfirmState);
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
    const inRange = date ? isInRange(date) : false;
    const authorMatched = author === state.settings.displayName;
    const wouldTargetMessage = Boolean(date && inRange && state.settings.deleteMessages && authorMatched);
    if (state.settings.developerMode) logScannedMessage(node, { id, author, date, inRange, authorMatched, wouldTargetMessage });
    if (!date || !inRange) return;
    if (state.settings.deleteMessages && authorMatched) state.messages.set(id, { id, author, time: date.getTime() });
    if (state.settings.undoReactions && !(authorMatched && state.settings.deleteMessages)) {
      findOwnReactions(node).forEach((reaction, index) => {
        const reactionTarget = { id: `${id}:r:${index}:${reaction.label}`, messageId: id, label: reaction.label };
        if (state.settings.developerMode) logScannedReaction(reactionTarget, { inRange, wouldBeUndone: true });
        state.reactions.set(reactionTarget.id, reactionTarget);
      });
    }
  }
  function getMessageId(node) {
    const content = node.querySelector('[id^="message-content-"]');
    const contentMatch = content?.id.match(/^message-content-(\d{15,25})$/);
    if (contentMatch) return contentMatch[1];

    const labelledBy = node.getAttribute('aria-labelledby') || '';
    const labelledMatch = labelledBy.match(/message-content-(\d{15,25})/);
    if (labelledMatch) return labelledMatch[1];

    const raw = `${node.id || ''} ${node.getAttribute('data-list-item-id') || ''}`;
    const snowflakes = raw.match(/\d{15,25}/g);
    return snowflakes && snowflakes.length ? snowflakes[snowflakes.length - 1] : null;
  }
  function getAuthor(node) { const author = node.querySelector('[class*="username"], h3 span, [aria-label*="Username"]'); return author ? author.textContent.trim() : ''; }
  function getMessageDate(node) { const time = node.querySelector('time[datetime]'); if (!time) return null; const date = new Date(time.getAttribute('datetime')); return Number.isNaN(date.getTime()) ? null : date; }
  function findOwnReactions(node) {
    return Array.from(node.querySelectorAll('[aria-pressed="true"][aria-label], button[class*="reactionMe"], div[class*="reactionMe"][aria-label]')).map((el) => ({ el, label: el.getAttribute('aria-label') || el.textContent.trim() })).filter((r) => r.label);
  }
  function isInRange(date) {
    if (state.settings.rangeMode === 'everything') return true;
    const range = getDateRangeMs(state.settings);
    const t = date.getTime();
    return t >= range.fromStart && t <= range.toEnd;
  }
  function getDateRangeMs(settings) {
    return {
      fromStart: localDayBoundaryMs(settings.fromDate, false),
      toEnd: localDayBoundaryMs(settings.toDate, true)
    };
  }
  function localDayBoundaryMs(value, endOfDay) { return parseDateInputAsLocalDayBounds(value, endOfDay).getTime(); }
  function parseDateInputAsLocalDayBounds(dateString, isEndOfDay) { const [year, month, day] = dateString.split('-').map(Number); return isEndOfDay ? new Date(year, month - 1, day, 23, 59, 59, 999) : new Date(year, month - 1, day, 0, 0, 0, 0); }

  function beginWipe() {
    if (state.settings.developerMode) return;
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
    for (let attempt = 0; attempt < 2; attempt++) {
      const result = await tryUndoReaction(target);
      if (result === 'done') { state.stats.reactionsUndone++; return; }
      if (result === 'missing') { state.stats.skipped++; return; }
      state.status = 'Discord did not confirm the reaction undo. Retrying once...';
      await sleep(700);
    }
    pauseOnStall();
  }
  async function tryUndoReaction(target) {
    const node = findNodeByMessageId(target.messageId);
    const reaction = node && findOwnReactions(node).find((r) => r.label === target.label);
    if (!reaction) return 'missing';
    reaction.el.click();
    const ok = await waitFor(() => { const fresh = findNodeByMessageId(target.messageId); return !fresh || !findOwnReactions(fresh).some((r) => r.label === target.label); }, 12000);
    return ok ? 'done' : 'timeout';
  }
  async function deleteMessage(target) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const result = await tryDeleteMessage(target);
      if (result === 'done') { state.stats.messagesDeleted++; return; }
      if (result === 'missing') { state.stats.skipped++; return; }
      state.status = 'Discord did not confirm the message deletion. Retrying once...';
      await sleep(700);
    }
    pauseOnStall();
  }
  async function tryDeleteMessage(target) {
    const node = findNodeByMessageId(target.id);
    if (!node || getAuthor(node) !== state.settings.displayName) return 'missing';
    node.scrollIntoView({ block: 'center' });
    node.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    await sleep(350);

    const more = findMessageActionButton(node);
    if (!more) return 'missing';
    more.click();
    const menu = await waitForElement(() => findOpenMenuForMessage(target.id), 2500);
    if (!menu) return 'missing';

    const del = findDeleteMenuItem(menu);
    if (!del) return 'missing';
    del.click();

    const dialog = await waitForElement(findDeleteConfirmDialog, 4000);
    if (!dialog) return 'timeout';
    const confirm = findDialogDeleteButton(dialog);
    if (!confirm) return 'missing';
    confirm.click();

    const ok = await waitFor(() => !findNodeByMessageId(target.id), 15000);
    return ok ? 'done' : 'timeout';
  }
  function pauseOnStall() { state.stats.failed++; state.paused = true; state.status = 'Wiping paused. Discord did not confirm the last deletion. This may be caused by lag, a dropped connection, a Discord outage, or a UI change.'; }
  function findNodeByMessageId(id) { return document.getElementById(`chat-messages-${id}`) || getMessageNodes().find((n) => getMessageId(n) === id); }
  function findMessageActionButton(node) {
    return Array.from(node.querySelectorAll('button[aria-label], [role="button"][aria-label]')).find((button) => {
      const label = button.getAttribute('aria-label') || '';
      return /more|actions/i.test(label);
    });
  }
  function findOpenMenuForMessage(messageId) {
    const menus = Array.from(document.querySelectorAll('[role="menu"]')).filter((menu) => menu.offsetParent !== null);
    return menus.find((menu) => {
      const text = menu.textContent || '';
      const labelled = menu.getAttribute('aria-label') || '';
      return /delete message/i.test(text) || /message actions/i.test(labelled) || labelled.includes(messageId);
    }) || null;
  }
  function findDeleteMenuItem(menu) {
    return Array.from(menu.querySelectorAll('[role="menuitem"], button')).find((el) => /delete message/i.test(el.textContent.trim()) || /delete message/i.test(el.getAttribute('aria-label') || '')) || null;
  }
  function findDeleteConfirmDialog() {
    return Array.from(document.querySelectorAll('[role="dialog"], [aria-modal="true"]')).find((dialog) => /delete message/i.test(dialog.textContent || '')) || null;
  }
  function findDialogDeleteButton(dialog) {
    return Array.from(dialog.querySelectorAll('button')).find((button) => /^delete$/i.test(button.textContent.trim()) || /^delete$/i.test(button.getAttribute('aria-label') || '')) || null;
  }

  function renderProgress() { const overlay = ensureOverlay(); overlay.innerHTML = `<header><h2>Discord DM Wiper</h2><h3>Wiping...</h3></header><section><p>Messages deleted: ${state.stats.messagesDeleted} / ${state.wipeList.messages.length}</p><p>Reactions undone: ${state.stats.reactionsUndone} / ${state.wipeList.reactions.length}</p><p>Skipped: ${state.stats.skipped}</p><p>Failed: ${state.stats.failed}</p><p>Status: ${state.status}</p><button id="ddmw-pause">Pause</button><button id="ddmw-resume">Resume</button><button id="ddmw-skip" class="secondary">Skip</button><button id="ddmw-stop" class="danger">Stop</button></section>`; overlay.querySelector('#ddmw-pause').onclick=()=>{state.paused=true;}; overlay.querySelector('#ddmw-resume').onclick=()=>{state.paused=false; state.status='Resuming wipe.';}; overlay.querySelector('#ddmw-skip').onclick=()=>{state.paused=false; state.status='Skipped stalled item.';}; overlay.querySelector('#ddmw-stop').onclick=()=>{state.stopped=true; renderComplete();}; }
  function renderComplete() { state.mode='complete'; const s=state.stats; ensureOverlay().innerHTML = `<header><h2>Discord DM Wiper</h2><h3>Wipe complete</h3></header><section><p>Messages deleted: ${s.messagesDeleted}</p><p>Reactions undone: ${s.reactionsUndone}</p><p>Skipped: ${s.skipped}</p><p>Failed: ${s.failed}</p><button id="ddmw-close">Close</button></section>`; document.getElementById('ddmw-close').onclick=closeOverlay; }


  function dryRunActionsHtml() {
    return `<section><strong>Developer Mode / Dry Run is ON</strong>
      <p class="warning">Dry scan only. No Discord delete buttons, confirmations, or reactions will be clicked.</p>
      <button id="ddmw-run-dry-scan">Run Dry Scan</button><button id="ddmw-copy-log">Copy Debug Log</button><button id="ddmw-download-log">Download Debug Log</button><button class="secondary" id="ddmw-close">Close</button>
    </section>`;
  }

  function initializeDebugLog(context) {
    const now = new Date();
    const manifest = chrome.runtime?.getManifest?.();
    addDebugLine('Discord DM Wiper Developer Mode / Dry Run Debug Log');
    addDebugLine(`Extension version: ${manifest?.version || 'unknown'}`);
    addDebugLine(`Browser timezone: ${Intl.DateTimeFormat().resolvedOptions().timeZone || 'unknown'}`);
    addDebugLine(`Current time: ${now.toString()}`);
    addDebugLine(`Current timezone offset: ${now.getTimezoneOffset()}`);
    addDebugLine(`Current Discord URL: ${location.href}`);
    addDebugLine(`One-on-one DM detected: ${Boolean(context.ok)}`);
    addDebugLine(`Range mode: ${state.settings.rangeMode}`);
    addDebugLine(`Delete my messages selected: ${Boolean(state.settings.deleteMessages)}`);
    addDebugLine(`Undo my reactions selected: ${Boolean(state.settings.undoReactions)}`);
    addDebugLine('Popup validation:');
    addDebugLine(JSON.stringify(state.settings.popupValidationLog || {}, null, 2));
    if (state.settings.rangeMode === 'date') {
      addDebugLine('Content script local range:');
      addDebugLine(JSON.stringify({
        selectedFromInput: state.settings.fromDate,
        selectedToInput: state.settings.toDate,
        computedFromStart: describeDate(parseDateInputAsLocalDayBounds(state.settings.fromDate, false)),
        computedToEnd: describeDate(parseDateInputAsLocalDayBounds(state.settings.toDate, true))
      }, null, 2));
    }
  }

  function logScannedMessage(node, details) {
    addDebugLine('--- Scanned message ---');
    addDebugLine(JSON.stringify({
      messageId: details.id,
      authorDisplayNameDetected: details.author,
      authorMatchedEnteredDisplayName: details.authorMatched,
      rawTimestampAttributesFound: getTimestampAttributes(node),
      parsedDateResult: describeDate(details.date),
      nearestVisibleDiscordDayDividerText: getNearestDayDividerText(node),
      selectedFromInput: state.settings.fromDate,
      selectedToInput: state.settings.toDate,
      computedLocalFromStart: state.settings.rangeMode === 'date' ? describeDate(parseDateInputAsLocalDayBounds(state.settings.fromDate, false)) : null,
      computedLocalToEnd: state.settings.rangeMode === 'date' ? describeDate(parseDateInputAsLocalDayBounds(state.settings.toDate, true)) : null,
      messageInsideSelectedRange: details.inRange,
      messageWouldBeTargeted: details.wouldTargetMessage,
      messageTextLengthOnly: getMessageTextLength(node)
    }, null, 2));
  }

  function logScannedReaction(reaction, details) {
    addDebugLine('--- Scanned reaction ---');
    addDebugLine(JSON.stringify({
      messageId: reaction.messageId,
      reactionLabelOrEmojiIdentifier: reaction.label,
      appearsToBelongToUser: true,
      wouldBeUndone: details.wouldBeUndone,
      dateRangeDecisionBasedOnParentMessageDate: details.inRange
    }, null, 2));
  }

  function getTimestampAttributes(node) {
    return Array.from(node.querySelectorAll('time, [datetime], [aria-label], [title]')).slice(0, 8).map((el) => ({
      tagName: el.tagName.toLowerCase(),
      datetime: el.getAttribute('datetime'),
      ariaLabel: el.getAttribute('aria-label'),
      title: el.getAttribute('title')
    })).filter((entry) => entry.datetime || entry.ariaLabel || entry.title);
  }
  function getNearestDayDividerText(node) { const divider = previousElements(node).find((el) => /divider|date|separator/i.test(`${el.className || ''} ${el.getAttribute('role') || ''}`) && (el.textContent || '').trim()); return divider ? divider.textContent.trim().slice(0, 120) : ''; }
  function previousElements(node) { const els=[]; let cur=node; while(cur && els.length<80){ cur=cur.previousElementSibling || cur.parentElement?.previousElementSibling; if(cur) els.push(cur); } return els; }
  function getMessageTextLength(node) { return (node.querySelector('[id^="message-content-"]')?.textContent || '').length; }
  function describeDate(date) { if (!date) return null; const time = date.getTime(); return { toString: date.toString(), toISOString: Number.isNaN(time) ? null : date.toISOString(), getTime: time, getTimezoneOffset: date.getTimezoneOffset() }; }
  function addDebugLine(line) { state.debugLog.push(String(line)); }
  function getDebugLogText() { return `${state.debugLog.join('\n')}\n`; }
  async function copyDebugLog() { await navigator.clipboard?.writeText(getDebugLogText()); state.status='Debug log copied.'; updateCounts(); }
  function downloadDebugLog() { const url=URL.createObjectURL(new Blob([getDebugLogText()], { type: 'text/plain' })); const a=document.createElement('a'); a.href=url; a.download='discord-dm-wiper-debug-log.txt'; a.click(); setTimeout(()=>URL.revokeObjectURL(url), 1000); }

  function updateCounts() { const o=document.getElementById('ddmw-overlay'); if(!o) return; const ids=['ddmw-msg-count','ddmw-react-count','ddmw-estimate','ddmw-status']; if(!ids.every((id)=>document.getElementById(id))) return; document.getElementById('ddmw-msg-count').textContent=`${state.settings.developerMode ? 'Messages that would be deleted' : 'Messages to delete'}: ${messageCount()}`; document.getElementById('ddmw-react-count').textContent=`${state.settings.developerMode ? 'Reactions that would be undone' : 'Reactions to undo'}: ${reactionCount()}`; document.getElementById('ddmw-estimate').textContent=`${state.settings.developerMode ? 'Estimated normal-mode time' : 'Estimated deletion time'}: ${estimate()}`; document.getElementById('ddmw-status').textContent=`Status: ${state.status}`; updateConfirmState(); }
  function updateConfirmState() { if(state.settings?.developerMode) return; const btn=document.getElementById('ddmw-confirm'), chk=document.getElementById('ddmw-understand'), txt=document.getElementById('ddmw-delete-text'); if(!btn||!chk||!txt) return; btn.disabled = messageCount()+reactionCount() < 1 || !chk.checked || txt.value !== 'DELETE' || (!state.settings.deleteMessages && !state.settings.undoReactions); }
  function ensureOverlay() { let o=document.getElementById('ddmw-overlay'); if(!o){ o=document.createElement('div'); o.id='ddmw-overlay'; document.body.appendChild(o);} return o; }
  function closeOverlay(){ document.getElementById('ddmw-overlay')?.remove(); state.observer?.disconnect(); document.removeEventListener('scroll', scheduleScan, true); }
  function messageCount(){ return state.settings?.deleteMessages ? state.messages.size : 0; } function reactionCount(){ return state.settings?.undoReactions ? state.reactions.size : 0; }
  function estimate(){ const total=messageCount()+reactionCount(); if(!total) return '—'; const min=total, max=total*2; return max<90 ? `about ${min}–${max} seconds` : `about ${Math.ceil(min/60)}–${Math.ceil(max/60)} minutes`; }
  function rangeLabel(){ return state.settings.rangeMode === 'everything' ? 'EVERYTHING scanned in this DM' : `${state.settings.fromDate} through ${state.settings.toDate}`; }
  function optionsLabel(){ return [state.settings.deleteMessages&&'Delete my messages', state.settings.undoReactions&&'Undo my reactions'].filter(Boolean).join(', '); }
  function randomDelay(){ return sleep(1000 + Math.floor(Math.random() * 1001)); } function sleep(ms){ return new Promise((r)=>setTimeout(r,ms)); }
  async function waitFor(fn, timeout){ const end=Date.now()+timeout; while(Date.now()<end){ if(fn()) return true; await sleep(300);} return false; }
  async function waitForElement(fn, timeout){ let found=null; const ok=await waitFor(()=>{ found=fn(); return Boolean(found); }, timeout); return ok ? found : null; }
  function escapeHtml(v){ return String(v).replace(/[&<>"]/g, (c)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
}());
