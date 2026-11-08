# Clean Site Data

**English** | [Tiếng Việt](README.vi.md)

A **Tampermonkey** / **Violentmonkey** userscript that shows how much storage the current site uses and clears that site's data: cookies, Local/Session Storage, IndexedDB, Cache Storage, Service Workers and the Origin Private File System (OPFS).

> The script's interface is in Vietnamese. Menu and button names are given below in their original form, followed by their meaning.

## Install

1. Install Tampermonkey or Violentmonkey in your browser.
2. Open this link and your userscript manager will show its install page:
   **https://raw.githubusercontent.com/loooveee/script/main/clean-site-data/clean-site-data.user.js**

Installed this way, the script updates automatically.

## Usage

The script adds two commands to the Tampermonkey/Violentmonkey menu on every page:

- **🧹 Dọn dữ liệu trang này…** (clean this site's data): opens a dialog showing:
  - storage used and quota, with a per-type breakdown in Chrome;
  - how many items of each data type the site holds.

  Tick the types you want, then click **Xoá dữ liệu đã chọn** (clear selected data). Your choices are remembered.
- **⚡ Xoá nhanh & tải lại** (quick clear & reload): clears every data type at once and reloads the page, after one confirmation.

**Tải lại trang sau khi xoá** (reload after clearing) is on by default. Pages often keep data in memory and write it back, so reloading gives a truly clean start. Databases the page still has open are also only deleted once the page reloads.

## What can be cleared

| Data | Supported |
|---|---|
| Cookies | ✅ Normal cookies, on every domain and path combination. **HttpOnly** cookies only with Tampermonkey (through `GM_cookie`); Violentmonkey can't see them. |
| Local Storage, Session Storage | ✅ |
| IndexedDB | ✅ |
| Cache Storage, Service Workers | ✅ On https sites (and localhost) |
| File System (OPFS) | ✅ |
| Browser HTTP cache | ⚠️ Userscripts can't clear it. The optional **Làm mới cache trình duyệt** (refresh browser cache) re-downloads the page's files (scripts, CSS, images…) to replace the cached copies. API calls are never repeated. |
| Web SQL | ❌ Removed from Chrome since version 119 |
| All sites at once, history, download list, saved passwords, form data | ❌ Needs browser-extension permissions; a userscript only reaches the site it runs on |

## Notes

- **Clearing a site's data signs you out of it.**
- **Only the site in the address bar is cleared.** Iframes from other sites are not.
- **The script only runs when you choose one of its menu commands.** It does nothing on its own and sends nothing anywhere.
