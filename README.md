# Kiến Trúc Hệ Thống BabeCry

Tài liệu này mô tả cấu trúc thư mục, nguồn sự thật (source of truth) khi deploy, và luồng hoạt động của hệ thống **Giám Sát An Toàn Trẻ Em (BabeCry)** để thuận tiện cho việc bảo trì và nâng cấp.

---

## 1. Tổng Quan Kiến Trúc Tách Biệt (Decoupled Architecture)

Hệ thống gồm 2 phần chạy độc lập và giao tiếp qua HTTPS:

```text
[Browser / Vercel Frontend]  <--- HTTPS (Cloudflare Tunnel) --->  [Kaggle GPU Notebook]
   (frontend/ -> GitHub)                                          (babecry.ipynb -> FastAPI)
          |                                                                  |
          +---- Đọc URL backend từ GitHub Gist (babecry_api.json) <----------+
```

### A. Frontend (Vercel)
- **Thư mục:** `/home/luan/Code/BabeCry/frontend/`
- **GitHub Repo:** `https://github.com/Luan2004/BabeCry` (được Vercel tự động deploy khi push).
- **Thành phần chính:**
  - `index.html`: Giao diện 2 cột (Video đầu vào & Kết quả nhận diện), các nút điều khiển (`Thêm Video`, `Bật Camera`, `Phân Tích Video`, `Dừng`), banner trạng thái, 3 thẻ KPI và danh sách video mẫu.
  - `css/style.css`: Giao diện responsive.
  - `js/app.js`: Toàn bộ logic gọi API, phát lại video SSE, và vòng lặp Camera Realtime + WebAudio.
  - `VIDEO_TEST/` & `thumbnails/`: Video mẫu và ảnh thumbnail tĩnh.

### B. Backend (Kaggle GPU + Cloudflare Tunnel)
- **File duy nhất dùng để deploy Backend:** `/home/luan/Code/BabeCry/kaggle_deploy/kernel/babecry.ipynb`
- **Lưu ý quan trọng:** Cell `%%writefile /kaggle/working/BabeCry/backend/server.py` bên trong `babecry.ipynb` sẽ **ghi đè** file `server.py` khi chạy trên Kaggle. Do đó, mọi chỉnh sửa API backend **phải sửa trực tiếp trong `babecry.ipynb`** (các file `backend/server.py` hoặc `kaggle_deploy/dataset/backend/server.py` ở local không được Kaggle dùng trực tiếp).
- **Thư mục AI Core (Kaggle Dataset `babecry-backend-assets`):**
  - `Baby-Cry-Detection/engine/unified_detector.py`: `UnifiedMultimodalDetector` kết hợp:
    - **Vision:** `YOLO11m` (`kaggle_results/v4_clean_balanced/best.pt`) nhận diện `TRE EM` và `NGUOI LON`.
    - **Audio:** VAD gate + `ResNet18` (`models/best_eletriby_4class_audio_classifier.pt`) phân loại 4 nguyên nhân tiếng khóc.
- **Cơ chế cập nhật URL động:**
  - Notebook khởi chạy `uvicorn` ở `127.0.0.1:8000` và mở `cloudflared` tunnel (`https://*.trycloudflare.com`).
  - Notebook dùng `GITHUB_GIST_TOKEN` (Kaggle Secret) để `PATCH` URL mới vào GitHub Gist `ec32a46e3fc303212389a970c68466aa` (`babecry_api.json`).
  - Frontend khi tải trang sẽ ưu tiên đọc `?api=...` -> GitHub Gist -> `localStorage` -> `DEFAULT_API_BASE_URL`.

---

## 2. Các API Endpoints Chính (trong `babecry.ipynb`)

| Method & Path | Mục đích | Đầu vào | Đầu ra |
| :--- | :--- | :--- | :--- |
| `GET /` & `GET /health` | Kiểm tra trạng thái backend | - | `{ status: "ok", ... }` |
| `GET /api/examples` | Liệt kê video mẫu trong `VIDEO_TEST/` | - | `{ examples: [...] }` |
| `POST /api/upload` | Tải video từ máy người dùng lên `temp_uploads/` | `file` (multipart) | `{ status, filename, path, size_mb }` |
| `GET /api/video?path=...` | Stream file video gốc cho thẻ `<video>` | `path` (query) | Video stream (`video/mp4`) |
| `GET /api/analyze/stream` | Phân tích video theo từng frame (SSE) | `video_path` (query) | SSE events (`step`, `done`) |
| `POST /api/analyze/frame` | Phân tích 1 khung hình + audio cho Camera Realtime | `frame`, `audio_b64`, `session_id`, `dt_sec` | JSON kết quả frame + trạng thái |

---

## 3. Luồng Hoạt Động Camera Realtime

1. Người dùng bấm **Bật Camera** -> `startCamera()` trong `frontend/js/app.js`:
   - Gọi `navigator.mediaDevices.getUserMedia({ video, audio })`.
   - Hiển thị luồng webcam lên `#inputVideo`.
   - Nếu có micro, khởi tạo `AudioContext` + `ScriptProcessorNode`, downsample âm thanh về `16kHz` và lưu vào ring buffer 2 giây (`cameraPcmRing`).
2. `runCameraRealtimeLoop()` chạy liên tục:
   - Vẽ frame từ `#inputVideo` lên `<canvas>` (resize tối đa width `480px`), nén JPEG (`0.65`).
   - Mỗi `>= 1000ms`, đính kèm `audio_b64` (Float32 PCM 16kHz mã hóa base64) nếu đã thu đủ tối thiểu `4000` samples.
   - Gửi `POST /api/analyze/frame` kèm `session_id` và `dt_sec`.
3. Backend (`babecry.ipynb`) xử lý:
   - Chạy `_detect_frame_boxes_only` (vẽ bounding box, không vẽ chữ HUD lên ảnh).
   - Giải mã `audio_b64` (hoặc dùng `tracker.last_vad` / `tracker.last_cry` nếu frame này không gửi kèm audio).
   - Cập nhật `AloneStateTracker` (`ADULT_CONFIRM_FRAMES = 5`, `ALONE_GRACE_FRAMES = 5`) để làm mượt trạng thái an toàn/một mình.
   - Trả về `frame_b64`, `is_alone` (`confirmed_alone`), `badge`, `color`, `title`, `description`, `vision_text`, `audio_text`, `cause_text`.
4. Frontend hiển thị `data:image/jpeg;base64,${data.frame_b64}` lên `#outputFrame` và cập nhật banner + 3 thẻ KPI.

---

## 4. Quy Trình Sửa Code & Deploy Nhanh

- **Khi sửa Backend (API, ngưỡng nhận diện, logic fusion):**
  1. Sửa trực tiếp trong `/home/luan/Code/BabeCry/kaggle_deploy/kernel/babecry.ipynb`.
  2. Upload / import lại `babecry.ipynb` lên Kaggle (bật `Internet = On`, `Accelerator = GPU`).
  3. Bấm **Run All** — URL tunnel mới sẽ tự động cập nhật lên GitHub Gist.
- **Khi sửa Frontend (giao diện, JS, CSS):**
  1. Sửa các file trong `/home/luan/Code/BabeCry/frontend/`.
  2. Commit và push lên GitHub `Luan2004/BabeCry`:
     ```bash
     cd /home/luan/Code/BabeCry/frontend
     git add .
     git commit -m "Mô tả thay đổi"
     git push origin main
     ```
  3. Vercel tự động build và cập nhật trang web.
