# Rou Video Download

[English](README.md) | **Tiếng Việt**

> [!WARNING]
> **Script chỉ phục vụ mục đích học tập.** Script cho thấy cách HLS streaming, dữ liệu giấu trong ảnh
> PNG và việc ghép MP4 ngay trong trình duyệt hoạt động. Không dùng để đăng lại, chia sẻ hay bán video.

Userscript cho **Tampermonkey** / **Violentmonkey**: tải video và phim bộ trên **rou.video** thành file **MP4**, ngay trong trình duyệt. Không cần Python, ffmpeg hay chương trình nào khác.

## Cài đặt

1. Cài Tampermonkey hoặc Violentmonkey cho trình duyệt.
2. Mở link sau, trình quản lý script sẽ hiện trang cài đặt:
   **https://raw.githubusercontent.com/loooveee/script/main/rou-video-download/rou-video-download.user.js**

Cài bằng link này thì script sẽ tự cập nhật.

## Sử dụng

1. Mở trang một video (`https://rou.video/v/...`) hoặc trang một bộ phim (`https://rou.video/s/...`).
2. Trong menu Tampermonkey/Violentmonkey, chọn **Tải video này (MP4)**.
3. Một bảng hiện ra với tên và thời lượng video. Với phim bộ, mọi tập được liệt kê kèm ô đánh dấu;
   dùng **Chọn hết** / **Bỏ chọn** để chọn nhanh.
4. Bấm **Tải MP4** (hoặc **Tải N tập (MP4)**) rồi chọn nơi lưu.

Bảng hiện chất lượng, tiến độ, dung lượng, tốc độ và thời gian còn lại. Bấm **Huỷ** để dừng.
Tải xong, video nào lỗi có thể bấm **Thử lại**.

- Luôn tải **chất lượng cao nhất** mà trang có, kèm độ phân giải thật, vd `720p (720x1280)`.
- Một video: bạn tự đặt tên file. Nhiều tập: bạn chọn một thư mục, file được đặt tên
  `<tên bộ> E01.mp4`, `<tên bộ> E02.mp4`, ... và tập nào đã có trong thư mục sẽ được bỏ qua.
- Dùng được cả với các tên miền phụ (`rouvb1.xyz`, ...).

## Cách hoạt động

1. Trang chứa tên, thời lượng, thông tin bộ và danh sách tập trong dữ liệu dựng sẵn từ máy chủ.
2. `/api/hls/<id>` chuyển hướng tới một playlist có chữ ký trên CDN.
3. Playlist và mọi đoạn video đều được gửi dưới dạng **ảnh PNG** nhỏ: dữ liệu thật nằm trong một chunk
   riêng tên `roUd` của ảnh (playlist thì được nén zlib). Script lấy phần đó ra.
4. Các đoạn được tải 6 đoạn cùng lúc, rồi [mux.js](https://github.com/videojs/mux.js) chuyển video
   MPEG-TS thành MP4 mà không mã hoá lại. Thời lượng được ghi vào phần đầu file MP4 để trình phát hiện
   đúng độ dài và tua được.

## Lưu ý

- **Chrome / Edge** ghi file thẳng ra đĩa trong lúc tải, nên video dài cũng ít tốn RAM.
- **Firefox và trình duyệt khác** không làm vậy được: cả video được giữ trong RAM rồi mới lưu.
  Video rất dài có thể tốn nhiều RAM. Khi tải nhiều tập, mỗi tập là một lượt tải về riêng: nếu trình
  duyệt hỏi có cho trang tải nhiều file không, hãy chọn **Cho phép**, nếu không các tập sau sẽ bị chặn.
- Giữ tab mở cho tới khi tải xong. Đóng tab là dừng tải, và video bị dừng sẽ phải tải lại từ đầu.
- Nếu trang yêu cầu **đăng nhập**, **captcha** hay **kiểm tra Cloudflare**, script sẽ dừng và báo lý do.
  Script không tìm cách vượt qua các bước đó.
- **Script chỉ chạy khi bạn chọn lệnh trong menu.** Script chỉ kết nối tới rou.video và máy chủ video của trang.

## Miễn trừ trách nhiệm

**Script chỉ phục vụ mục đích học tập.** Bạn tự chịu trách nhiệm về cách mình sử dụng.
Hãy tôn trọng bản quyền, điều khoản sử dụng của trang web và luật pháp nơi bạn sống.

Script không liên quan đến rou.video. Tác giả không chịu trách nhiệm cho bất kỳ hành vi lạm dụng nào.
