# BabeCry Frontend (Vercel)

Giao diện web cho hệ thống Giám Sát An Toàn Trẻ Em & Nhận Diện Tiếng Khóc.
Repository này chỉ chứa phần giao diện tĩnh (`HTML5 / CSS3 / Vanilla JS`) để deploy lên Vercel và gọi API tới server backend chạy riêng.

## Cấu hình địa chỉ Backend API

Có 2 cách trỏ giao diện về server backend:

1. **Qua tham số URL (không cần sửa code):**
   Mở trang Vercel kèm `?api=https://your-backend-url` (hệ thống tự lưu vào `localStorage` cho các lần sau):
   ```text
   https://your-app.vercel.app/?api=https://your-backend-url
   ```
2. **Sửa trực tiếp trong code:**
   Mở `js/app.js` và đổi giá trị `DEFAULT_API_BASE_URL` sang URL backend của bạn (mặc định `http://127.0.0.1:8000`).
