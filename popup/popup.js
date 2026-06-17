(function () {
  'use strict';

  const displayName = document.getElementById('displayName');
  const fromDate = document.getElementById('fromDate');
  const toDate = document.getElementById('toDate');
  const deleteMessages = document.getElementById('deleteMessages');
  const undoReactions = document.getElementById('undoReactions');
  const developerMode = document.getElementById('developerMode');
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
      undoReactions: undoReactions.checked,
      developerMode: developerMode.checked,
      popupValidationLog: null
    };

    if (!settings.displayName) return showError('Enter your exact Discord display name.');
    if (!settings.deleteMessages && !settings.undoReactions) return showError('Select at least one wipe option.');
    if (rangeMode === 'date' && (!settings.fromDate || !settings.toDate)) return showError('Choose both dates or select EVERYTHING.');
    settings.popupValidationLog = buildPopupValidationLog(settings);
    if (rangeMode === 'date' && !settings.popupValidationLog.validationPassed) return showError('From date must not be after To date.');

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !/^https:\/\/(canary\.|ptb\.)?discord\.com\//.test(tab.url || '')) return showError('Open a Discord Web one-on-one DM first.');

    await chrome.tabs.sendMessage(tab.id, { type: 'DDMW_START', settings }).catch(async () => {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content/content.js'] });
      await chrome.scripting.insertCSS({ target: { tabId: tab.id }, files: ['content/content.css'] });
      await chrome.tabs.sendMessage(tab.id, { type: 'DDMW_START', settings });
    });
    window.close();
  });

  function buildPopupValidationLog(settings) {
    if (settings.rangeMode !== 'date') {
      return {
        rawFromInput: settings.fromDate,
        rawToInput: settings.toDate,
        fromStartLocal: null,
        toEndLocal: null,
        fromStartMs: null,
        toEndMs: null,
        validationPassed: true
      };
    }

    const fromStart = parseDateInputAsLocalDayBounds(settings.fromDate, false);
    const toEnd = parseDateInputAsLocalDayBounds(settings.toDate, true);
    const fromStartMs = fromStart.getTime();
    const toEndMs = toEnd.getTime();
    return {
      rawFromInput: settings.fromDate,
      rawToInput: settings.toDate,
      fromStartLocal: describeDate(fromStart),
      toEndLocal: describeDate(toEnd),
      fromStartMs,
      toEndMs,
      validationPassed: fromStartMs <= toEndMs
    };
  }

  function parseDateInputAsLocalDayBounds(dateString, isEndOfDay) {
    const [year, month, day] = dateString.split('-').map(Number);
    return isEndOfDay
      ? new Date(year, month - 1, day, 23, 59, 59, 999)
      : new Date(year, month - 1, day, 0, 0, 0, 0);
  }

  function describeDate(date) {
    return {
      toString: date.toString(),
      toISOString: Number.isNaN(date.getTime()) ? null : date.toISOString(),
      getTime: date.getTime(),
      getTimezoneOffset: date.getTimezoneOffset()
    };
  }

  function showError(message) { error.textContent = message; }
}());
