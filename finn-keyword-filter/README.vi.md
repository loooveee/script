# FINN Keyword Filter

[English](README.md) | **Tiếng Việt**

Userscript cho **Tampermonkey** / **Violentmonkey**, dùng ở mục bất động sản của [finn.no](https://www.finn.no/realestate/browse.html). Gõ hoặc bấm từ khoá như `tvangssalg`, `oppussingsobjekt`, `dødsbo` để lọc tin đăng, rồi xem các từ đó được tô sáng trong từng tin.

> Giao diện của script là tiếng Anh. Tên nút bên dưới được giữ nguyên, kèm nghĩa tiếng Việt.

## Cài đặt

1. Cài Tampermonkey hoặc Violentmonkey cho trình duyệt.
2. Mở link sau, trình quản lý script sẽ hiện trang cài đặt:
   **https://raw.githubusercontent.com/loooveee/script/main/finn-keyword-filter/finn-keyword-filter.user.js**

Cài bằng link này thì script sẽ tự cập nhật.

## Sử dụng

### Trên trang tìm kiếm

Ở mọi trang tìm kiếm bất động sản của FINN (ví dụ [Bolig til salgs](https://www.finn.no/realestate/homes/search.html)), bảng **🔎 Keyword filter** hiện ở góc dưới bên phải. Bấm vào tiêu đề để thu gọn hoặc mở rộng.

- **Gõ từ khoá rồi Enter** để lọc ngay. Tách nhiều từ bằng dấu phẩy, thêm `-` trước từ muốn loại trừ. Từ bạn gõ được lưu thành chip cho lần sau.
- **Bấm một chip** để đổi trạng thái lần lượt: phải có (xanh), loại trừ (đỏ), tắt. Dấu **×** trên chip xoá nó khỏi danh sách.
- **Match: ANY keyword / ALL keywords** (khớp bất kỳ từ nào / tất cả các từ) đổi giữa OR và AND cho các chip xanh.
- **Clear** (xoá lọc) tắt mọi chip.

Các bộ lọc của FINN (khu vực, giá, loại nhà…) được giữ nguyên khi bạn đổi từ khoá.

Chip có sẵn: `tvangssalg`, `oppussingsobjekt`, `oppussingsbehov`, `renoveringsobjekt`, `moderniseringsbehov`, `oppgraderingsbehov`, `trenger oppussing`, `dødsbo`, `selges som den er`, `rivningsobjekt`, `utleiedel` và `hybel`.

### Trên trang tin đăng

Khi mở một tin lúc đang lọc, các từ khoá "phải có" được tô vàng. Một nhãn nhỏ ở góc dưới bên phải cho biết số chỗ khớp; bấm vào để nhảy lần lượt tới từng chỗ.

## Cách hoạt động

Ô tìm kiếm của FINN vốn đã tìm trong toàn bộ nội dung tin và hiểu `OR`, `-từ` và `"cụm từ chính xác"`. Script chỉ dựng câu truy vấn đó từ các chip rồi đặt vào tham số `q` của URL tìm kiếm, nên việc lọc do FINN thực hiện trên toàn bộ kết quả, không chỉ trang đang xem.

## Lưu ý

- **Script không tự gửi request nào.** Nó chỉ đổi URL tìm kiếm và đọc trang bạn đã mở. Từ khoá và lựa chọn được lưu trong trình quản lý script.
- **Có tin khớp nhưng không có chỗ nào được tô sáng.** FINN có thể khớp một từ không nằm trong phần chữ hiển thị của tin; khi đó nhãn sẽ báo không tìm thấy.
- **Nếu bạn gõ nội dung khác vào ô tìm kiếm của FINN**, lựa chọn trong bảng sẽ bị xoá, trừ khi câu truy vấn chỉ gồm các từ có trong danh sách chip.
