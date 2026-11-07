# Gom Media

[English](README.md) | **Tiếng Việt**

Userscript cho **Tampermonkey** / **Violentmonkey** để quét và tải toàn bộ ảnh, video trong một thread diễn đàn XenForo 2. Script được tối ưu cho **voz**, **xamvn** và **rphang**.

## Cài đặt

1. Cài Tampermonkey hoặc Violentmonkey cho trình duyệt.
2. Mở link sau, trình quản lý script sẽ hiện trang cài đặt:
   **https://raw.githubusercontent.com/loooveee/script/main/gom-media/gom-media.user.js**

Cài bằng link này thì Tampermonkey/Violentmonkey sẽ **tự cập nhật** mỗi khi có bản mới trên GitHub.

## Site được hỗ trợ

- **voz, xamvn, rphang:** vào thread là **bảng tự mở**.
  - Site được nhận theo **tên**, không theo đuôi tên miền. Vì vậy `voz.vn`, `voz.net`, `abc.voz.com`, `xamvn.xyz`, `rphang.beer`, `rphang2.show`… đều được nhận.
  - Nếu site đổi hẳn sang tên khác, script vẫn nhận ra nhờ tên site khai báo trong trang (`og:site_name`).
  - Muốn tắt tự mở thì bỏ dấu ô **Tự mở bảng khi vào thread** ở cuối bảng.
- **Các diễn đàn XenForo 2 khác:** chỉ hiện nút **⬇** ở giữa cạnh phải màn hình. Bấm nút để mở bảng; kéo nút lên/xuống để đổi chỗ.
- **Trang không tự nhận diện được:** mở menu của Tampermonkey/Violentmonkey và chọn **Mở Gom Media**.

## Sử dụng

- **Ô số trang:** nhập `3`, `1-5` hoặc `1,3,7-9`. Để trống thì quét tất cả trang. Nhấn Enter để quét.
- **🔍 Quét / ⏹ Dừng:** quét 4 trang cùng lúc. Bấm Dừng thì vẫn giữ những gì đã tìm được. Script bỏ qua ảnh trong trích dẫn, emoji, avatar và quảng cáo chèn trong bài.
- **📦 Tải ZIP:** gom tất cả vào một file ZIP đặt theo tên thread. Mỗi file ZIP tối đa khoảng 1 GB; vượt quá thì tự tách thành `_part1`, `_part2`…
- **⬇️ Tải lẻ:** tải từng file vào thư mục Downloads, tên file bắt đầu bằng tên thread.
  - File của chính diễn đàn (đính kèm, ảnh qua proxy của voz) được tải ngay trong tab nên qua được Cloudflare. Video loại này được tải thẳng xuống đĩa, không giữ cả file trong bộ nhớ.
  - File trên máy chủ ảnh/video khác (như video của xamvn) được tải bằng `GM_download`. Với Tampermonkey, các file này vào thư mục `Downloads/<tên-thread>/`. Nếu `GM_download` lỗi, script tự chuyển sang tải trong tab.
- **📺 Xem:** mở trình xem toàn màn hình. Bấm vào ảnh để phóng to, dùng ← → để chuyển, Esc để đóng.

Kết quả quét được nhớ riêng cho từng thread (10 thread gần nhất).

**Link video có hạn dùng:** video của rphang có link kèm hạn dùng (`?hash=…&verify=…`). Nếu link đã hết hạn lúc tải, script tự tải lại trang chứa video để lấy link mới, nên không cần quét lại.

## Lưu ý

- **Phải để tab mở** trong lúc quét hoặc tải. Đóng tab là công việc dừng.
- **Site có màn hình xác nhận Cloudflare:** bạn tự qua màn hình đó một lần, sau đó script dùng chung phiên của tab.
- **Khi tải lẻ hoặc lưu nhiều part ZIP**, Chrome có thể hỏi *"tải nhiều file"*. Bấm **Allow**.
- **Lần đầu tải từ máy chủ ảnh/video khác**, Tampermonkey sẽ hỏi quyền kết nối. Chọn **Always allow domain** (hoặc **Always allow all domains**).
- **Tải lẻ vào thư mục con trên Tampermonkey:** vào Settings, đặt *Config mode* là Advanced, rồi đặt *Downloads → Download Mode* là **Browser API**. Nếu đuôi file bị chặn, thêm đuôi đó vào *Whitelisted file extensions*.
- **Video nhúng YouTube/Facebook** không tải được bằng script này.
- **Khi có lỗi**, bảng ghi rõ lý do; chi tiết từng link xem trong Console (F12).
- **Quyền riêng tư:** script không gửi cookie khi tải từ máy chủ ảnh/video bên thứ ba, chỉ gửi cho chính diễn đàn và tên miền con của nó. Thư viện JSZip được ghim phiên bản và khoá bằng mã băm SHA-256 (Tampermonkey kiểm tra mã băm này; Violentmonkey hiện bỏ qua).
