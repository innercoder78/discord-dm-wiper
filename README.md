# Discord DM Wiper

Discord DM Wiper is a local Chrome Manifest V3 extension that helps you wipe your own activity from the currently open Discord Web one-on-one DM.

It can:

- Delete messages that the extension can confidently match to your exact Discord display name.
- Undo reactions that Discord's visible UI indicates belong to you.

It is intentionally conservative. If the extension cannot confidently identify an item as yours, it skips it.

## Safety and privacy

Discord DM Wiper:

- Only works on Discord Web.
- Only supports one-on-one DMs.
- Does not target server channels.
- Does not target group DMs.
- Never intentionally deletes the other person's messages.
- Never intentionally undoes the other person's reactions.
- Does not use the Discord API.
- Does not read or use Discord tokens.
- Does not use self-bot behavior.
- Does not use backend servers, analytics, telemetry, external runtimes, package managers, or build steps.
- Does not send message contents anywhere.
- Uses slow, visible, UI-based actions with a randomized delay before each delete or undo action.

Deleted messages and undone reactions cannot be restored by this extension.

## Important limitation: loaded history only

Discord only keeps part of a DM loaded in the page at a time. Discord DM Wiper can only scan and wipe matching items that are loaded in the browser DOM while the overlay is open.

To include older history, scroll the DM so Discord loads it. For `EVERYTHING`, the extension means every matching item scanned in this DM, not messages Discord has not loaded yet.

## Back up first

Before wiping anything, you may want to back up the conversation first with Discord DM Exporter:

https://github.com/innercoder78/discord-dm-exporter

## Install as an unpacked Chrome extension

1. Download or clone this repository.
2. Open Chrome and go to `chrome://extensions`.
3. Enable `Developer mode`.
4. Click `Load unpacked`.
5. Select this repository folder.

No build command is required.

## Usage

1. Open Discord Web in Chrome.
2. Open a one-on-one DM.
3. Click the Discord DM Wiper extension icon.
4. Enter your exact Discord display name as shown above your messages in Discord.
5. Choose a date range or `EVERYTHING scanned in this DM`.
6. Choose whether to delete your messages, undo your reactions, or both.
7. Click `START`.
8. In the overlay, scroll through the part of the DM you want included.
9. Review the live counts.
10. If you are sure, check the warning box, type `DELETE`, and click `Confirm Wipe`.

The extension waits 1-2 seconds before each action and waits for Discord's UI to confirm that the item disappeared before counting it as complete. If Discord does not confirm progress, it retries the same item once; if confirmation still does not arrive, the wipe pauses rather than blindly continuing.

## Date ranges

Date filtering uses local browser day boundaries:

- From date starts at local `00:00:00.000`.
- To date ends at local `23:59:59.999`.
- Message timestamps are compared as JavaScript `Date` objects using milliseconds.

This avoids excluding local end-of-day messages just because their UTC ISO date falls on the next day.

## Project structure

- `manifest.json` - Chrome Manifest V3 metadata and permissions.
- `popup/popup.html` - Extension popup markup.
- `popup/popup.css` - Popup styles.
- `popup/popup.js` - Popup validation and startup messaging.
- `content/content.js` - Discord page overlay, scanning, review, and conservative UI-based wipe logic.
- `content/content.css` - Overlay styles.

## Notes for contributors

Discord's DOM changes frequently. Keep all parsing and deletion behavior conservative:

- Prefer stable Discord snowflake message IDs when present.
- Dedupe by message ID.
- Ignore reply preview nodes.
- Verify ownership again before deleting.
- Do not advance after a click unless the DOM confirms the item was removed.
- Skip anything uncertain.
