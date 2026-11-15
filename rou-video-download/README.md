# Rou Video Download

**English** | [Tiếng Việt](README.vi.md)

> [!WARNING]
> **This script is for educational purposes only.** It shows how HLS streaming, data hidden in PNG
> images and in-browser MP4 muxing work. Do not use it to re-upload, share or sell videos.

A **Tampermonkey** / **Violentmonkey** userscript that downloads videos and series from **rou.video** as **MP4** files, right in the browser. No Python, ffmpeg or other programs needed.

> The script's interface is in Vietnamese. Menu and button names are given below in their original form, followed by their meaning.

## Install

1. Install Tampermonkey or Violentmonkey in your browser.
2. Open this link and your userscript manager will show its install page:
   **https://raw.githubusercontent.com/loooveee/script/main/rou-video-download/rou-video-download.user.js**

Installed this way, the script updates automatically.

## Usage

1. Open a video page (`https://rou.video/v/...`) or a series page (`https://rou.video/s/...`).
2. In the Tampermonkey/Violentmonkey menu, choose **Tải video này (MP4)** (download this video).
3. A panel opens with the video's name and length. On a series, every episode is listed with a checkbox;
   use **Chọn hết** / **Bỏ chọn** (select all / none).
4. Click **Tải MP4** (download MP4), or **Tải N tập (MP4)** (download N episodes), and choose where to save.

The panel shows the quality, progress, size, speed and time left. **Huỷ** (cancel) stops the download.
When it is done, failed videos can be retried with **Thử lại** (retry).

- Always downloads the **highest quality** the site has, and shows the real resolution, e.g. `720p (720x1280)`.
- One video: you pick the file name. Several episodes: you pick a folder, files are named
  `<series> E01.mp4`, `<series> E02.mp4`, ... and episodes already in that folder are skipped.
- Works on the mirror domains too (`rouvb1.xyz`, ...).

## How it works

1. The page carries the video's name, length, series and episode list in its server-rendered data.
2. `/api/hls/<id>` redirects to a signed playlist on the CDN.
3. The playlist and every video segment come as small **PNG images**: the real data sits in a custom
   `roUd` chunk of the image (zlib-compressed for the playlist). The script takes it out.
4. Segments are downloaded 6 at a time, and [mux.js](https://github.com/videojs/mux.js) turns the
   MPEG-TS video into MP4 without re-encoding. The video length is written into the MP4 header so
   players can show it and seek.

## Notes

- **Chrome / Edge** write the file straight to disk while downloading, so even long videos use little memory.
- **Firefox and other browsers** can't do that: the whole video is kept in memory and saved at the end.
  Very long videos may need a lot of RAM. When you download several episodes, each one is a separate
  download: if the browser asks whether the site may download multiple files, choose **Allow**, or the
  later episodes will be blocked.
- Keep the tab open until the download is done. Closing it stops the download, and a stopped video
  starts over the next time.
- If the site asks for a **login**, a **captcha** or a **Cloudflare check**, the script stops and says so.
  It does not try to get past them.
- **The script only runs when you choose its menu command.** It talks only to rou.video and its video servers.

## Disclaimer

**This is for educational purposes only.** You are responsible for how you use it.
Respect copyright, the website's terms of use and the laws where you live.

This script is not affiliated with rou.video. The author is not responsible for any misuse.
