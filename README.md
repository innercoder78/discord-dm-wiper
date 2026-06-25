# Discord DM Wiper

Discord DM Wiper is a local Chrome Manifest V3 extension that helps you wipe your own activity from the currently open Discord Web one-on-one DM.

It can:

- Delete messages that the extension can confidently match to your exact Discord display name.
- Undo standalone reactions that Discord's visible UI indicates belong to you.

It is intentionally conservative. If the extension cannot confidently identify an item as yours, it skips it.

## Supported Discord context

Discord DM Wiper works only in Discord Web one-on-one DMs.

It does not support:

- Group DMs.
- Servers or server channels.
- Mobile Discord.
- Desktop Discord.

Before wiping, you must confirm that the current conversation is a one-on-one DM. You must also confirm that you understand the wipe cannot be undone.

## Safety and privacy

Discord DM Wiper:

- Only works on Discord Web one-on-one DMs.
- Never intentionally deletes the other person's messages.
- Never intentionally undoes the other person's reactions.
- Deletes only your own messages when ownership is confidently detected.
- Undoes only your own standalone reactions when ownership is confidently detected.
- Skips any item when ownership is uncertain.
- Does not use the Discord API.
- Does not read or use Discord tokens.
- Does not use self-bot behavior.
- Does not use backend servers, analytics, telemetry, external runtimes, package managers, or build steps.
- Does not send message contents anywhere.
- Uses Discord Web's visible UI only.
- Uses slow, visible, UI-based actions with a randomized delay before each delete or undo action.

Deleted messages and undone standalone reactions cannot be restored by this extension.

## Important limitation: loaded and actionable history only

Discord only keeps part of a DM loaded in the page at a time. Discord DM Wiper can only wipe matching items that are currently loaded in Discord Web when they are reviewed, confirmed, and acted on.

Items found earlier while scanning may be skipped if Discord unloads them before confirmation or before the wipe action reaches them. To reduce skipped items, keep the relevant messages visible and loaded while reviewing and wiping.

For `EVERYTHING`, the extension means matching currently loaded and actionable items found in the current DM. It does not mean the entire Discord history that Discord has not loaded into the page.

To include older history, scroll the DM so Discord loads the relevant messages, then keep the messages you want to wipe loaded while you review and confirm.

## Back up first

Before wiping anything, you may want to back up the conversation first with Discord DM Exporter:

https://github.com/innercoder78/discord-dm-exporter

## Install as an unpacked Chrome extension

1. Download or clone this repository.
2. Open Chrome and go to `chrome://extensions`.
3. Use Chrome's extensions page option that allows loading an unpacked extension.
4. Click `Load unpacked`.
5. Select this repository folder.

No build command is required.

## Usage

1. Open Discord Web in Chrome.
2. Open a one-on-one DM.
3. Click the Discord DM Wiper extension icon.
4. Enter your exact Discord display name as shown above your messages in Discord.
5. Choose a date range or `EVERYTHING scanned in this DM`.
6. Choose whether to delete your messages, undo your standalone reactions, or both.
7. Click `START`.
8. In the overlay, scroll through the part of the DM you want included and keep relevant items loaded.
9. Review the live counts.
10. If you are sure, complete both required confirmation checkboxes: the irreversible wipe confirmation and the one-on-one DM confirmation.
11. Type `DELETE` and click `Confirm Wipe`.

The extension waits 1-2 seconds before each action and waits for Discord's UI to confirm that the item disappeared before counting it as complete. If Discord does not confirm progress, it retries the same item once; if confirmation still does not arrive, the wipe pauses rather than blindly continuing.

## Messages and standalone reactions

Message deletion applies only to your own messages when ownership is confidently detected.

Standalone reactions means your reactions on messages that are not being deleted. Reactions on your own messages being deleted are not counted separately, because deleting the message also removes those reactions with the message.

Standalone reaction undo applies only to your own standalone reactions when ownership is confidently detected. If ownership is uncertain, the extension skips the reaction.

## Date ranges

Date filtering uses local browser day boundaries:

- From date starts at local `00:00:00.000`.
- To date ends at local `23:59:59.999`.
- Same-day date ranges are valid.
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
