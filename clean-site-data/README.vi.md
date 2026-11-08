# Clean Site Data

[English](README.md) | **Tiếng Việt**

Userscript cho **Tampermonkey** / **Violentmonkey**: xem dung lượng trang đang mở đang dùng, và xoá dữ liệu của trang đó, gồm cookie, Local/Session Storage, IndexedDB, Cache Storage, Service Worker và File System (OPFS).

## Cài đặt

1. Cài Tampermonkey hoặc Violentmonkey cho trình duyệt.
2. Mở link sau, trình quản lý script sẽ hiện trang cài đặt:
   **https://raw.githubusercontent.com/loooveee/script/main/clean-site-data/clean-site-data.user.js**

Cài bằng link này thì script sẽ tự cập nhật.

## Sử dụng

Trên mọi trang, menu của Tampermonkey/Violentmonkey có thêm hai lệnh:

- **🧹 Dọn dữ liệu trang này…**: mở bảng cho biết:
  - dung lượng đang dùng và hạn mức (Chrome còn chia theo từng loại);
  - số lượng mục của từng loại dữ liệu.

  Tick những loại muốn xoá rồi bấm **Xoá dữ liệu đã chọn**. Lựa chọn của bạn được nhớ cho lần sau.
- **⚡ Xoá nhanh & tải lại**: xoá mọi loại dữ liệu cùng lúc rồi tải lại trang, sau một lần hỏi xác nhận.

Tuỳ chọn **Tải lại trang sau khi xoá** bật sẵn. Trang thường giữ dữ liệu trong bộ nhớ rồi ghi lại, nên tải lại trang mới sạch hẳn. Cơ sở dữ liệu mà trang đang mở cũng chỉ xoá xong sau khi tải lại.

## Xoá được những gì

| Dữ liệu | Hỗ trợ |
|---|---|
| Cookie | ✅ Cookie thường, thử mọi tổ hợp domain và path. Cookie **HttpOnly** chỉ xoá được trên Tampermonkey (qua `GM_cookie`); Violentmonkey không thấy được loại này. |
| Local Storage, Session Storage | ✅ |
| IndexedDB | ✅ |
| Cache Storage, Service Worker | ✅ Trên trang https (và localhost) |
| File System (OPFS) | ✅ |
| Cache trình duyệt (HTTP cache) | ⚠️ Userscript không xoá được. Tuỳ chọn **Làm mới cache trình duyệt** (mặc định tắt) tải lại các file của trang (script, CSS, ảnh…) để thay bản cũ trong cache. Không gọi lại API của trang. |
| Web SQL | ❌ Chrome đã bỏ từ bản 119 |
| Xoá cho mọi trang, lịch sử, danh sách tải về, mật khẩu, dữ liệu form | ❌ Cần quyền của extension; userscript chỉ đụng được tới trang nó đang chạy |

## Lưu ý

- **Xoá dữ liệu của trang sẽ đăng xuất bạn khỏi trang đó.**
- **Chỉ xoá dữ liệu của trang trên thanh địa chỉ**, không xoá dữ liệu của iframe từ trang khác.
- **Script chỉ chạy khi bạn chọn lệnh trong menu.** Nó không tự làm gì và không gửi gì đi đâu.
