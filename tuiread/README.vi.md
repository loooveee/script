# TuiRead (userscript)

[English](README.md) | **Tiếng Việt**

Userscript cho **Tampermonkey** / **Violentmonkey**: đọc raw truyện tiếng Trung và hiện bản convert tiếng Việt ngay trên trang truyện, theo từ điển VietPhrase. Việc dịch chạy hoàn toàn trong trình duyệt, nội dung trang không gửi đi đâu.

Đây là bản userscript của extension [TuiRead](https://github.com/memories169/tuiread-firefox) (bản Firefox của [ppptran/tuiread](https://github.com/ppptran/tuiread)). Engine dịch và `content.js` được nhúng nguyên văn từ repo đó; từ điển cũng tải từ repo đó.

## Cài đặt

1. Cài Tampermonkey hoặc Violentmonkey cho trình duyệt.
2. Mở link sau, trình quản lý script sẽ hiện trang cài đặt:
   **https://raw.githubusercontent.com/loooveee/script/main/tuiread/tuiread.user.js**

Cài bằng link này thì script sẽ tự cập nhật.

## Sử dụng

Mở một chương truyện trên `uukanshu.cc` hoặc `piaotia.com`, thân truyện tự chuyển sang tiếng Việt.

- **Lần đầu trên mỗi site**, script tải khoảng 45MB từ điển từ GitHub rồi lưu vào IndexedDB của site đó. Chip góc dưới phải hiện tiến độ. Các lần sau không tải lại.
- **Bấm vào một cụm đã dịch** để xem chữ Hán gốc và sửa nghĩa. "Lưu" áp dụng cho truyện đang đọc, "Lưu vào VP" áp dụng cho mọi truyện.
- **Bảng Tùy chọn** mở bằng nút tròn **TR** ở góc dưới trái, hoặc lệnh **TuiRead: Tùy chọn** trong menu của Tampermonkey/Violentmonkey. Trong đó có:
  - bật/tắt dịch trên site, kiểu hiển thị (chỉ tiếng Việt, hoặc Việt + gốc Hán), giao diện sáng/tối;
  - cách chọn nghĩa: chỉ lấy nghĩa đầu, bỏ chữ thừa 的/了/着/著, rule số-ngày-đơn vị, nhận diện tên riêng;
  - từ điển của tôi (bản vá cho mọi truyện): sửa trực tiếp, nhập/xuất `.txt`, tải từ URL;
  - từ điển riêng theo truyện, luật nhân của tôi, selector khu vực truyện, thử convert.
- **Thêm site truyện khác**: mở trang truyện đó, chọn lệnh **TuiRead: bật trên site này** trong menu. Nếu script chọn nhầm khối chứa truyện, dán selector CSS đúng vào mục "Site & selector khu vực truyện".

## Khác extension gốc

| | Extension | Userscript |
|---|---|---|
| Từ điển | Đóng gói sẵn | Tải một lần cho mỗi site, lưu IndexedDB của site đó |
| Engine | Một bản dùng chung cho cả trình duyệt | Chạy trong Web Worker của từng tab; tự giải phóng RAM sau 3 phút không dùng |
| Chuyển chương | Engine đã nạp sẵn | Script dịch trước chương kế vào cache để sang chương hiện tiếng Việt ngay (tắt được trong Tùy chọn) |
| Cài đặt, bản vá | `chrome.storage` | Bộ nhớ của trình quản lý userscript, dùng chung cho mọi site |
| Font | SF Pro Display | Font hệ thống |

## Lưu ý

- **Script khai `@match *://*/*`** để thêm được site lúc đang chạy, nhưng chỉ hoạt động trên `uukanshu.cc`, `piaotia.com` và site bạn đã thêm. Ở trang khác nó chỉ đăng ký một lệnh menu.
- **Mỗi tab đang dịch giữ một bản từ điển trong RAM** (khoảng 150–300MB) cho tới khi rảnh 3 phút.
- **Dịch trước chương kế gửi thêm một request tới site cho mỗi chương**, và không có tác dụng với site nạp nội dung chương bằng JavaScript.
- **Trang chặn Web Worker** thì engine chạy thẳng trên trang: trang khựng vài giây mỗi lần nạp từ điển, và không dịch trước chương kế.

## Build lại từ repo gốc

`tuiread.user.js` do `build.mjs` sinh ra từ `src/userscript.template.js` và mã nguồn của extension. Khi repo gốc cập nhật:

```bash
node build.mjs
```

Script chỉ tự clone repo gốc vào `upstream/` khi thư mục đó chưa có; đã có thì dùng lại nguyên trạng, nên hãy chạy `git -C upstream pull` (hoặc xoá `upstream/`) trước để lấy bản mới của repo gốc. Cũng có thể truyền đường dẫn tới bản clone của bạn: `node build.mjs <đường-dẫn>`. Build ghim từ điển theo commit vừa clone, và dừng với thông báo lỗi nếu chỗ vá không còn khớp. Sửa userscript mà bản gốc không đổi version thì tăng `USERSCRIPT_REV` trong `build.mjs` để trình quản lý nhận bản mới.

## Nguồn

Engine, `content.js`, CSS và từ điển thuộc về [ppptran/tuiread](https://github.com/ppptran/tuiread) và [memories169/tuiread-firefox](https://github.com/memories169/tuiread-firefox). Hai repo đó hiện không kèm file LICENSE.
