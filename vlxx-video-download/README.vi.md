# VLXX Video Download

[English](README.md) | **Tiếng Việt**

Userscript cho **Tampermonkey** / **Violentmonkey**: tải video trên vlxx.net thành file MP4, ngay trong trình duyệt.

## Cài đặt

1. Cài Tampermonkey hoặc Violentmonkey cho trình duyệt.
2. Mở link sau, trình quản lý script sẽ hiện trang cài đặt:
   **https://raw.githubusercontent.com/loooveee/script/main/vlxx-video-download/vlxx-video-download.user.js**

Cài bằng link này thì script sẽ tự cập nhật.

## Sử dụng

1. Mở trang một video (`vlxx.net/video/.../<id>/`, hoặc trang đó ở tên miền mà trang đang dùng).
2. Mở menu của Tampermonkey/Violentmonkey, chọn **Tải video này (MP4)**.
3. Nếu trang có nhiều server, chọn một server ở mục **Nguồn**. Server trang đang phát được chọn sẵn.
4. Bấm **Tải MP4** rồi chọn thư mục để lưu.

Bảng hiện tiến độ, tốc độ và thời gian còn lại. **Huỷ** để dừng tải. Nếu tải lỗi, sẽ có nút **Thử lại** và **Thử server #N**.

## File được lưu

- **Video** được đặt tên theo diễn viên và mã phim, ví dụ `Yuna Shiina JUR-914.mp4`. Nếu trang không ghi diễn viên hoặc mã phim thì tên video được dùng thay vào.
- **Mô tả** hiện trên trang video được lưu cạnh đó thành file văn bản cùng tên, ví dụ `Yuna Shiina JUR-914.txt`. File này được ghi sau khi video tải xong.

Nếu thư mục đã có video trùng tên, script sẽ hỏi trước khi ghi đè.

## Cách hoạt động

- Trang video nhúng trình phát trong một iframe; trang trình phát chứa link tới playlist HLS.
- Mỗi đoạn trong playlist là dữ liệu MPEG-TS đứng sau một phần đầu ảnh PNG ngắn. Script bỏ phần đầu đó.
- [mux.js](https://github.com/videojs/mux.js) chuyển các đoạn thành MP4 mà không mã hoá lại, rồi script ghi ra một file MP4 thường, mở được bằng trình phát trên máy.

## Lưu ý

- **Nên dùng Chrome hoặc Edge cho video dài.** Hai trình duyệt này ghi thẳng file ra đĩa trong lúc tải. Trình duyệt khác giữ cả video trong RAM rồi mới lưu, nên phim dài (1–2 GB) có thể không tải nổi. Ở các trình duyệt đó file mô tả là một lượt tải về riêng, nên hãy cho phép trang tải nhiều file nếu trình duyệt hỏi.
- **Trang hay đổi tên miền.** Script chạy trên mọi địa chỉ dạng `vlxx.<đuôi>` (`vlxx.net`, `vlxx.phd`…), nên vẫn dùng được sau khi trang đổi tên miền. Script không chạy trên tên khác, ví dụ `vlxx.example.com` hay `sub.vlxx.net`.
- **Script chỉ chạy khi bạn chọn lệnh trong menu.**
- **Script cần quyền truy cập tên miền khác** (`@connect *`): trang trình phát và playlist nằm ở tên miền mà vlxx.net không được đọc trực tiếp, nên chúng được tải bằng `GM_xmlhttpRequest`. Lần đầu, trình quản lý script có thể hỏi bạn cho phép.
- Chất lượng là mức server cung cấp; playlist chỉ có một mức.
