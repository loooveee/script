# VLXX Video Download

**English** | [Tiếng Việt](README.vi.md)

A **Tampermonkey** / **Violentmonkey** userscript that downloads a video from vlxx.net as an MP4 file, right in the browser.

> The script's interface is in Vietnamese. Menu and button names are given below in their original form, followed by their meaning.

## Install

1. Install Tampermonkey or Violentmonkey in your browser.
2. Open this link and your userscript manager will show its install page:
   **https://raw.githubusercontent.com/loooveee/script/main/vlxx-video-download/vlxx-video-download.user.js**

Installed this way, the script updates automatically.

## Usage

1. Open a video page (`vlxx.net/video/.../<id>/`, or the same page on whichever address the site currently uses).
2. Open the Tampermonkey/Violentmonkey menu and choose **Tải video này (MP4)** (download this video as MP4).
3. If the page offers several servers, pick one under **Nguồn** (source). The server the page is showing is selected by default.
4. Click **Tải MP4** and choose a folder to save into.

The panel shows the progress, speed and remaining time. **Huỷ** (cancel) stops the download. If a download fails, **Thử lại** (retry) and **Thử server #N** (try another server) appear.

## Saved files

- **The video** is named after the actress and the video's code, for example `Yuna Shiina JUR-914.mp4`. If the page lists no actress or no code, the video's title is used in its place.
- **The description** shown on the video page is saved next to it as a text file with the same name, for example `Yuna Shiina JUR-914.txt`. It is written once the video has finished downloading.

If the folder already has a video with that name, the script asks before overwriting it.

## How it works

- The video page embeds a player in an iframe; the player page holds the link to an HLS playlist.
- Each segment of the playlist is MPEG-TS data behind a short PNG image header. The script skips the header.
- [mux.js](https://github.com/videojs/mux.js) turns the segments into MP4 without re-encoding, and the script writes one regular MP4 file that desktop players can open.

## Notes

- **Use Chrome or Edge for long videos.** They write the file straight to disk while downloading. Other browsers keep the whole video in memory before saving it, and a full-length film (1–2 GB) may not fit. There the description is a second download, so allow the page to download multiple files if the browser asks.
- **The site changes its address often.** The script runs on any address of the form `vlxx.<ending>` (`vlxx.net`, `vlxx.phd`…), so it keeps working after a move. It does not run on other names, such as `vlxx.example.com` or `sub.vlxx.net`.
- **The script only runs when you choose its menu command.**
- **It needs permission to reach other domains** (`@connect *`): the player page and the playlist are on domains that vlxx.net itself is not allowed to read, so they are fetched with `GM_xmlhttpRequest`. Your userscript manager may ask you to allow this the first time.
- The quality is whatever the server provides; the playlist offers a single quality.
