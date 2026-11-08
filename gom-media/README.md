# Gom Media

**English** | [Tiếng Việt](README.vi.md)

A **Tampermonkey** / **Violentmonkey** userscript that scans a XenForo 2 forum thread and downloads all of its images and videos. It is tuned for **voz**, **xamvn** and **rphang**.

> The script's interface is in Vietnamese. The button names are given below in their original form, followed by their meaning.

## Install

1. Install Tampermonkey or Violentmonkey in your browser.
2. Open this link and your userscript manager will show its install page:
   **https://raw.githubusercontent.com/loooveee/script/main/gom-media/gom-media.user.js**

Installed this way, Tampermonkey/Violentmonkey **updates the script automatically** whenever a new version is pushed to GitHub.

## Opening the panel

The script shows nothing on the page by itself. On a XenForo 2 thread, open the **Tampermonkey/Violentmonkey menu** (the extension icon in the toolbar) and choose **Mở Gom Media** (open Gom Media). Close the panel with **✕**.

It works on any XenForo 2 forum, on any domain, and is tested on voz, xamvn and rphang.

## Usage

- **Page box:** enter `3`, `1-5` or `1,3,7-9`. Leave it empty to scan every page. Press Enter to scan.
- **🔍 Quét / ⏹ Dừng (Scan / Stop):** scans 4 pages at a time. Stopping keeps whatever has been found so far. Images inside quotes, emoji, avatars and ads inside posts are skipped.
- **📦 Tải ZIP (Download ZIP):** puts everything into one ZIP file named after the thread. Each ZIP is capped at about 1 GB; beyond that the script splits it into `_part1`, `_part2`…
- **⬇️ Tải lẻ (Download files):** downloads each file separately into your Downloads folder, with the thread name at the start of each file name.
  - Files hosted by the forum itself (attachments, images through voz's proxy) are downloaded inside the tab, so they get past Cloudflare. Videos of this kind are saved straight to disk instead of being held in memory.
  - Files on other image/video hosts (such as xamvn's videos) are downloaded with `GM_download`. In Tampermonkey they go into `Downloads/<thread-name>/`. If `GM_download` fails, the script falls back to downloading inside the tab.
- **📺 Xem (View):** opens a full-screen viewer. Click an image to enlarge it, use ← → to move between files, and Esc to close.

Scan results are remembered per thread (the 10 most recent threads).

**Expiring video links:** rphang video links carry an expiry (`?hash=…&verify=…`). If a link has expired by the time you download, the script reloads the page that contains the video to get a fresh link, so you don't need to scan again.

## Notes

- **Keep the tab open** while scanning or downloading. Closing the tab stops the job.
- **Sites with a Cloudflare check:** pass the check once yourself; after that the script uses the tab's session.
- **When downloading separate files or several ZIP parts**, Chrome may ask about *"download multiple files"*. Click **Allow**.
- **The first time you download from another image/video host**, Tampermonkey asks for permission to connect. Choose **Always allow domain** (or **Always allow all domains**).
- **Subfolders in Tampermonkey:** in Settings, set *Config mode* to Advanced, then set *Downloads → Download Mode* to **Browser API**. If a file extension is blocked, add it to *Whitelisted file extensions*.
- **Embedded YouTube/Facebook videos** can't be downloaded with this script.
- **When something fails**, the panel shows the reason; per-link details are in the Console (F12).
- **Privacy:** the script doesn't send cookies to third-party image/video hosts, only to the forum itself and its subdomains. The JSZip library is pinned to one version and locked with a SHA-256 hash (Tampermonkey checks this hash; Violentmonkey currently ignores it).
