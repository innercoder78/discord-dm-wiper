(function () {
  'use strict';

  const displayName = document.getElementById('displayName');
  const fromDate = document.getElementById('fromDate');
  const toDate = document.getElementById('toDate');
  const deleteMessages = document.getElementById('deleteMessages');
  const undoReactions = document.getElementById('undoReactions');
  const start = document.getElementById('start');
  const error = document.getElementById('error');

  document.querySelectorAll('input[name="rangeMode"]').forEach((radio) => {
    radio.addEventListener('change', () => {
      document.getElementById('dateFields').style.opacity = radio.value === 'date' && radio.checked ? '1' : '0.55';
    });
  });

  start.addEventListener('click', async () => {
    error.textContent = '';
    const rangeMode = document.querySelector('input[name="rangeMode"]:checked').value;
    const settings = {
      displayName: displayName.value.trim(),
      rangeMode,
      fromDate: fromDate.value,
      toDate: toDate.value,
      deleteMessages: deleteMessages.checked,
      undoReactions: undoReactions.checked
    };

    if (!settings.displayName) return showError('Enter your exact Discord display name.');
    if (!settings.deleteMessages && !settings.undoReactions) return showError('Select at least one wipe option.');
    if (rangeMode === 'date' && (!settings.fromDate || !settings.toDate)) return showError('Choose both dates or select EVERYTHING.');
    if (rangeMode === 'date' && !isValidDateRange(settings)) return showError('From date must not be after To date.');

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !/^https:\/\/(canary\.|ptb\.)?discord\.com\//.test(tab.url || '')) return showError('Open a Discord Web one-on-one DM first.');

    try {
      await chrome.tabs.sendMessage(tab.id, { type: 'DDMW_START', settings });
      window.close();
    } catch (initialError) {
      try {
        await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content/content.js'] });
        await chrome.scripting.insertCSS({ target: { tabId: tab.id }, files: ['content/content.css'] });
        await chrome.tabs.sendMessage(tab.id, { type: 'DDMW_START', settings });
        window.close();
      } catch (startupError) {
        showError("Couldn't start the overlay. Reload Discord and try again.");
      }
    }
  });

  function isValidDateRange(settings) {
    const fromStartMs = parseDateInputAsLocalDayBounds(settings.fromDate, false).getTime();
    const toEndMs = parseDateInputAsLocalDayBounds(settings.toDate, true).getTime();
    return fromStartMs <= toEndMs;
  }

  function parseDateInputAsLocalDayBounds(dateString, isEndOfDay) {
    const [year, month, day] = dateString.split('-').map(Number);
    return isEndOfDay
      ? new Date(year, month - 1, day, 23, 59, 59, 999)
      : new Date(year, month - 1, day, 0, 0, 0, 0);
  }

  function showError(message) { error.textContent = message; }
}());
