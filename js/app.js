/**
 * Frontend Application Script: app.js
 * Decoupled Architecture for Infant Safety & Cry Monitoring
 * Zero Emojis / Zero Icons Policy
 * Ready for Remote API Server (configure API_BASE_URL)
 */

// Base URL for Backend API calls.
// Priority: 1) ?api=https://... query param (saved to localStorage), 2) GitHub Gist babecry_api.json, 3) localStorage, 4) DEFAULT_API_BASE_URL
const DEFAULT_API_BASE_URL = "https://tub-her-verse-scheduled.trycloudflare.com";
const GIST_ID = "ec32a46e3fc303212389a970c68466aa";
const GIST_FILENAME = "babecry_api.json";
const GIST_API_ENDPOINT = `https://api.github.com/gists/${GIST_ID}`;
const GIST_RAW_URL = `https://gist.githubusercontent.com/Luan2004/${GIST_ID}/raw/${GIST_FILENAME}`;

const urlParams = new URLSearchParams(window.location.search);
const apiFromQuery = urlParams.get("api");
if (apiFromQuery) {
    localStorage.setItem("babecry_api_base_url", apiFromQuery.replace(/\/+$/, ""));
}
let API_BASE_URL = (
    localStorage.getItem("babecry_api_base_url") || DEFAULT_API_BASE_URL
).replace(/\/+$/, "");

function extractApiUrlFromGistContent(rawText) {
    if (!rawText) return "";
    try {
        const parsed = JSON.parse(rawText);
        if (parsed && typeof parsed.api_url === "string") {
            return parsed.api_url.trim().replace(/\/+$/, "");
        }
    } catch (_) {
        const match = rawText.match(/https:\/\/[a-zA-Z0-9.-]+/);
        if (match) return match[0].trim().replace(/\/+$/, "");
    }
    return "";
}

async function syncApiBaseUrlFromGist() {
    if (apiFromQuery) return;
    const fetchWithTimeout = (url) => {
        const opts = { cache: "no-store" };
        if (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function") {
            opts.signal = AbortSignal.timeout(4000);
        }
        return fetch(url, opts);
    };

    try {
        const resp = await fetchWithTimeout(GIST_API_ENDPOINT);
        if (resp.ok) {
            const gist = await resp.json();
            const content = gist?.files?.[GIST_FILENAME]?.content;
            const url = extractApiUrlFromGistContent(content);
            if (url) {
                API_BASE_URL = url;
                localStorage.setItem("babecry_api_base_url", url);
                return;
            }
        }
    } catch (err) {
        console.warn("Gist API lookup failed, trying raw gist:", err);
    }

    try {
        const resp = await fetchWithTimeout(`${GIST_RAW_URL}?t=${Date.now()}`);
        if (resp.ok) {
            const url = extractApiUrlFromGistContent(await resp.text());
            if (url) {
                API_BASE_URL = url;
                localStorage.setItem("babecry_api_base_url", url);
            }
        }
    } catch (err) {
        console.warn("Raw Gist lookup failed, using fallback API_BASE_URL:", err);
    }
}

// DOM Elements
const inputVideo = document.getElementById("inputVideo");
const dropzone = document.getElementById("dropzone");
const fileInput = document.getElementById("fileInput");

const outputFrame = document.getElementById("outputFrame");
const resultPlaceholder = document.getElementById("resultPlaceholder");
const resultViewer = document.getElementById("resultViewer");

// Output Video Controls Elements (Native video player controls)
const outputControls = document.getElementById("outputControls");
const outPlayPauseBtn = document.getElementById("outPlayPauseBtn");
const iconPlay = document.getElementById("iconPlay");
const iconPause = document.getElementById("iconPause");
const outSeekbar = document.getElementById("outSeekbar");
const outTimeText = document.getElementById("outTimeText");
const outFullscreenBtn = document.getElementById("outFullscreenBtn");

const runBtn = document.getElementById("runBtn");
const stopBtn = document.getElementById("stopBtn");
const statusBanner = document.getElementById("statusBanner");

const visionStatus = document.getElementById("visionStatus");
const audioStatus = document.getElementById("audioStatus");
const causeStatus = document.getElementById("causeStatus");
const examplesGrid = document.getElementById("examplesGrid");

// State
let currentVideoPath = "";
let eventSource = null;
let isAnalyzing = false;

const DEFAULT_EXAMPLES = [
    {
        filename: "280167556-female-teacher-checking-kids-d.mp4",
        path: "VIDEO_TEST/280167556-female-teacher-checking-kids-d.mp4",
        thumbnail_url: "thumbnails/280167556-female-teacher-checking-kids-d.jpg"
    },
    {
        filename: "050870650-preschool-children-are-early-c.mp4",
        path: "VIDEO_TEST/050870650-preschool-children-are-early-c.mp4",
        thumbnail_url: "thumbnails/050870650-preschool-children-are-early-c.jpg"
    },
    {
        filename: "sd_watermarked_preview.mp4",
        path: "VIDEO_TEST/sd_watermarked_preview.mp4",
        thumbnail_url: "thumbnails/sd_watermarked_preview.jpg"
    },
    {
        filename: "fromYout10s.mp4",
        path: "VIDEO_TEST/fromYout10s.mp4",
        thumbnail_url: "thumbnails/fromYout10s.jpg"
    }
];

function renderExamples(examples) {
    examplesGrid.innerHTML = "";
    examples.forEach((ex, idx) => {
        const card = document.createElement("div");
        card.className = "example-card";
        card.innerHTML = `
            <div class="example-thumb-wrapper">
                <img class="example-thumb-img" src="${ex.thumbnail_url}" alt="${ex.filename}">
            </div>
            <div class="example-name">${ex.filename}</div>
        `;
        card.addEventListener("click", () => {
            selectExample(ex.path, card, ex.thumbnail_url);
        });
        examplesGrid.appendChild(card);

        // Auto-select first example video
        if (idx === 0 && !currentVideoPath) {
            selectExample(ex.path, card, ex.thumbnail_url);
        }
    });
}

// 1. Initial Load: Fetch Test Examples with Visual Thumbnails (fallback to static VIDEO_TEST/)
async function loadExamples() {
    try {
        const response = await fetch(`${API_BASE_URL}/api/examples`);
        if (!response.ok) {
            renderExamples(DEFAULT_EXAMPLES);
            return;
        }
        const data = await response.json();
        const backendByName = new Map((data.examples || []).map(ex => [ex.filename, ex]));
        const examples = DEFAULT_EXAMPLES.map(ex => backendByName.get(ex.filename) || ex);
        renderExamples(examples);
    } catch (err) {
        console.warn("Backend unavailable, loading static VIDEO_TEST examples:", err);
        renderExamples(DEFAULT_EXAMPLES);
    }
}

// 2. Select an Example Video
function selectExample(path, cardElement, thumbnailUrl) {
    if (isAnalyzing) {
        stopAnalysis();
    }

    currentVideoPath = path;

    // Highlight selected card
    document.querySelectorAll(".example-card").forEach(c => c.classList.remove("selected"));
    if (cardElement) {
        cardElement.classList.add("selected");
    }

    // Serve static VIDEO_TEST/ directly from Frontend/Vercel when available; uploaded videos come from backend
    inputVideo.src = path.startsWith("VIDEO_TEST/")
        ? path
        : `${API_BASE_URL}/api/video?path=${encodeURIComponent(path)}`;
    if (thumbnailUrl) {
        inputVideo.poster = thumbnailUrl;
    }
    inputVideo.style.display = "block";
    dropzone.style.display = "none";
    inputVideo.load();

    resetOutputs();
}

// 3. File Upload Handling
dropzone.addEventListener("click", () => {
    fileInput.click();
});

fileInput.addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (file) {
        handleUploadFile(file);
    }
});

dropzone.addEventListener("dragover", (e) => {
    e.preventDefault();
    dropzone.classList.add("dragover");
});

dropzone.addEventListener("dragleave", () => {
    dropzone.classList.remove("dragover");
});

dropzone.addEventListener("drop", (e) => {
    e.preventDefault();
    dropzone.classList.remove("dragover");
    const file = e.dataTransfer.files[0];
    if (file) {
        handleUploadFile(file);
    }
});

async function handleUploadFile(file) {
    if (isAnalyzing) {
        stopAnalysis();
    }

    // Unselect examples
    document.querySelectorAll(".examples-table tbody tr").forEach(r => r.classList.remove("selected"));

    const formData = new FormData();
    formData.append("file", file);

    statusBanner.className = "status-banner";
    statusBanner.style.backgroundColor = "#F1F5F9";
    statusBanner.style.color = "#475569";
    statusBanner.textContent = `ĐANG TẢI LÊN: ${file.name} (${(file.size / (1024 * 1024)).toFixed(2)} MB)...`;

    try {
        const response = await fetch(`${API_BASE_URL}/api/upload`, {
            method: "POST",
            body: formData
        });

        if (!response.ok) {
            throw new Error("Lỗi khi tải lên video.");
        }

        const data = await response.json();
        currentVideoPath = data.path;

        inputVideo.src = `${API_BASE_URL}/api/video?path=${encodeURIComponent(currentVideoPath)}`;
        inputVideo.style.display = "block";
        dropzone.style.display = "none";
        inputVideo.load();

        statusBanner.textContent = `SẴN SÀNG: Đã tải lên thành công ${data.filename}. Vui lòng bấm "Phân Tích Video".`;
        resetOutputs();
    } catch (err) {
        console.error("Upload failed:", err);
        statusBanner.textContent = `LỖI: Không thể tải lên video. Vui lòng thử lại.`;
    }
}

// 4. Reset Outputs
function resetOutputs() {
    outputFrame.style.display = "none";
    outputFrame.src = "";
    resultPlaceholder.style.display = "block";
    resultPlaceholder.textContent = 'Chưa có khung hình nhận diện. Vui lòng chọn video và bấm "Phân Tích Video".';

    visionStatus.textContent = "-";
    audioStatus.textContent = "-";
    causeStatus.textContent = "-";

    bufferedSteps = [];
    currentPlayIdx = 0;
    isPlaybackStarted = false;
    isPaused = true;
    if (playbackInterval) {
        clearInterval(playbackInterval);
        playbackInterval = null;
    }
    if (iconPlay && iconPause) {
        iconPlay.style.display = "block";
        iconPause.style.display = "none";
    }
    if (outPlayPauseBtn) {
        outPlayPauseBtn.title = "Tiếp tục";
    }
    if (outSeekbar) {
        outSeekbar.value = 0;
        outSeekbar.max = 100;
    }
    if (outTimeText) {
        const dur = (inputVideo && inputVideo.duration && !isNaN(inputVideo.duration)) ? inputVideo.duration : 0;
        outTimeText.textContent = `0:00 / ${formatTime(dur)}`;
    }
}

let bufferedSteps = [];
let playbackInterval = null;
let currentPlayIdx = 0;
let isPlaybackStarted = false;
let isPaused = false;
let isUserDraggingSeekBar = false;

// Time formatting helper: m:ss (matches native video controls)
function formatTime(seconds) {
    if (!seconds || isNaN(seconds) || seconds < 0) return "0:00";
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${String(secs).padStart(2, "0")}`;
}

// Update Output Control Bar UI
function updateControlsUI(step, idx) {
    if (!step) return;
    const total = bufferedSteps.length;
    if (total > 0) {
        outSeekbar.max = Math.max(1, total - 1);
        if (!isUserDraggingSeekBar) {
            outSeekbar.value = idx;
        }
    }

    const curTime = step.current_time_sec || 0;
    let totalDuration = inputVideo.duration;
    if (!totalDuration || isNaN(totalDuration) || totalDuration === Infinity) {
        if (bufferedSteps.length > 0) {
            const lastStep = bufferedSteps[bufferedSteps.length - 1];
            totalDuration = lastStep.current_time_sec || curTime;
        } else {
            totalDuration = curTime;
        }
    }

    outTimeText.textContent = `${formatTime(curTime)} / ${formatTime(totalDuration)}`;
}

// 5. Start Streaming Analysis with Buffer Strategy
function startAnalysis() {
    if (!currentVideoPath) {
        alert("Vui lòng chọn video mẫu hoặc tải lên video trước khi phân tích.");
        return;
    }

    if (isAnalyzing) return;

    isAnalyzing = true;
    runBtn.disabled = true;
    stopBtn.disabled = false;

    // Reset buffer state
    bufferedSteps = [];
    currentPlayIdx = 0;
    isPlaybackStarted = false;
    isPaused = false;
    if (playbackInterval) {
        clearInterval(playbackInterval);
        playbackInterval = null;
    }
    if (outSeekbar) {
        outSeekbar.value = 0;
    }
    if (iconPlay && iconPause) {
        iconPlay.style.display = "block";
        iconPause.style.display = "none";
    }

    // Initial buffer placeholder (15% fast buffer)
    resultPlaceholder.style.display = "block";
    resultPlaceholder.innerHTML = `
        <div style="font-weight: 600; font-size: 16px; margin-bottom: 8px;">ĐANG PHÂN TÍCH VIDEO...</div>
        <div style="color: #64748b; font-size: 14px; margin-bottom: 14px;">Hệ thống đang đệm nhanh 15% video (~2-3 giây) trước khi phát đồng bộ.</div>
        <div style="width: 80%; max-width: 320px; height: 12px; background: #e2e8f0; border-radius: 6px; overflow: hidden; margin: 0 auto;">
            <div id="bufferBar" style="width: 0%; height: 100%; background: #2563eb; transition: width 0.2s;"></div>
        </div>
        <div id="bufferText" style="margin-top: 10px; font-weight: bold; color: #2563eb; font-size: 15px;">0% / 15% (Đang đệm nhanh...)</div>
    `;
    outputFrame.style.display = "none";
    outputFrame.src = "";

    // Keep input video paused while buffering
    inputVideo.pause();
    inputVideo.currentTime = 0;

    statusBanner.className = "status-banner active";
    statusBanner.style.backgroundColor = "#2563EB";
    statusBanner.style.color = "#FFFFFF";
    statusBanner.innerHTML = `
        <div class="banner-title">[TỐC ĐỘ CAO] Hệ thống đang phân tích nhanh (imgsz=480, skip=6)...</div>
        <div class="banner-desc">Khi tiến trình đạt 15% (~2-3 giây đầu), video gốc và kết quả nhận diện sẽ tự động phát mượt mà.</div>
    `;

    const streamUrl = `${API_BASE_URL}/api/analyze/stream?video_path=${encodeURIComponent(currentVideoPath)}`;
    eventSource = new EventSource(streamUrl);

    eventSource.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);

            if (data.event === "done") {
                if (!isPlaybackStarted) {
                    startPlayback();
                }
                if (eventSource) {
                    eventSource.close();
                    eventSource = null;
                }
                if (outputControls) {
                    outSeekbar.max = Math.max(1, bufferedSteps.length - 1);
                }
                return;
            }

            if (data.event === "step") {
                bufferedSteps.push(data);
                const pct = data.pct_done || 0;

                const bufferBar = document.getElementById("bufferBar");
                const bufferText = document.getElementById("bufferText");

                if (!isPlaybackStarted) {
                    if (bufferBar) bufferBar.style.width = `${Math.min(100, (pct / 15) * 100)}%`;
                    if (bufferText) bufferText.textContent = `${pct}% / 15% (Đang đệm nhanh...)`;

                    // Start playback as soon as 15% of video is processed!
                    if (pct >= 15) {
                        startPlayback();
                    }
                } else {
                    outSeekbar.max = Math.max(1, bufferedSteps.length - 1);
                }
            }
        } catch (err) {
            console.error("Error processing SSE message:", err);
        }
    };

    eventSource.onerror = (err) => {
        console.warn("SSE connection closed:", err);
        if (eventSource) {
            eventSource.close();
            eventSource = null;
        }
        if (!isPlaybackStarted && bufferedSteps.length > 0) {
            startPlayback();
        }
    };
}

// 6. Playback from Buffer
function startPlayback() {
    if (isPlaybackStarted) return;
    isPlaybackStarted = true;

    resultPlaceholder.style.display = "none";
    outputFrame.style.display = "block";
    if (outSeekbar) {
        outSeekbar.max = Math.max(1, bufferedSteps.length - 1);
    }

    resumePlayback();
}

function resumePlayback() {
    if (bufferedSteps.length === 0) return;
    isPaused = false;
    if (playbackInterval) {
        clearInterval(playbackInterval);
    }

    // If reached end, restart from beginning
    if (currentPlayIdx >= bufferedSteps.length) {
        currentPlayIdx = 0;
    }

    if (iconPlay && iconPause) {
        iconPlay.style.display = "none";
        iconPause.style.display = "block";
    }
    if (outPlayPauseBtn) {
        outPlayPauseBtn.title = "Tạm dừng";
    }
    if (resultViewer) {
        resultViewer.classList.add("playing");
    }

    // Compute interval for ~6-frame skip at 25 fps (~240ms per detection frame)
    const stepInterval = 240;
    playbackInterval = setInterval(() => {
        if (currentPlayIdx < bufferedSteps.length) {
            const step = bufferedSteps[currentPlayIdx];
            renderStep(step);
            updateControlsUI(step, currentPlayIdx);
            currentPlayIdx++;
        } else {
            // Reached current buffer end
            if (!eventSource) {
                // Done analyzing whole video
                pausePlayback();
            }
        }
    }, stepInterval);
}

function pausePlayback() {
    isPaused = true;
    if (playbackInterval) {
        clearInterval(playbackInterval);
        playbackInterval = null;
    }
    if (iconPlay && iconPause) {
        iconPlay.style.display = "block";
        iconPause.style.display = "none";
    }
    if (outPlayPauseBtn) {
        outPlayPauseBtn.title = "Tiếp tục";
    }
    if (resultViewer) {
        resultViewer.classList.remove("playing");
    }
}

function renderStep(data) {
    outputFrame.src = `data:image/jpeg;base64,${data.frame_b64}`;

    statusBanner.className = "status-banner active";
    statusBanner.style.backgroundColor = data.color || "#059669";
    statusBanner.style.color = "#FFFFFF";
    statusBanner.innerHTML = `
        <div class="banner-title">${data.title}</div>
        <div class="banner-desc">${data.description}</div>
    `;

    visionStatus.textContent = data.vision_text;
    audioStatus.textContent = data.audio_text;
    causeStatus.textContent = data.cause_text;
}

// 7. Stop Analysis
function stopAnalysis() {
    if (eventSource) {
        eventSource.close();
        eventSource = null;
    }
    if (playbackInterval) {
        clearInterval(playbackInterval);
        playbackInterval = null;
    }
    isAnalyzing = false;
    isPaused = true;
    runBtn.disabled = false;
    stopBtn.disabled = true;
    if (iconPlay && iconPause) {
        iconPlay.style.display = "block";
        iconPause.style.display = "none";
    }
    if (outPlayPauseBtn) {
        outPlayPauseBtn.title = "Tiếp tục";
    }
    if (resultViewer) {
        resultViewer.classList.remove("playing");
    }
}

// Control Bar & Interaction Event Listeners
outPlayPauseBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (!isAnalyzing && bufferedSteps.length === 0) {
        startAnalysis();
        return;
    }
    if (isPaused) {
        resumePlayback();
    } else {
        pausePlayback();
    }
});

outputFrame.addEventListener("click", () => {
    if (!isAnalyzing && bufferedSteps.length === 0) {
        startAnalysis();
        return;
    }
    if (isPaused) {
        resumePlayback();
    } else {
        pausePlayback();
    }
});

inputVideo.addEventListener("loadedmetadata", () => {
    if (inputVideo.duration && !isNaN(inputVideo.duration)) {
        if (outTimeText) {
            outTimeText.textContent = `0:00 / ${formatTime(inputVideo.duration)}`;
        }
    }
});

if (outFullscreenBtn) {
    outFullscreenBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        const target = document.getElementById("outputPanel") || resultViewer;
        if (!document.fullscreenElement) {
            target.requestFullscreen().catch(() => {});
        } else {
            document.exitFullscreen().catch(() => {});
        }
    });
}

outSeekbar.addEventListener("input", () => {
    isUserDraggingSeekBar = true;
    const idx = parseInt(outSeekbar.value, 10);
    if (idx >= 0 && idx < bufferedSteps.length) {
        const step = bufferedSteps[idx];
        renderStep(step);
        updateControlsUI(step, idx);
    }
});

outSeekbar.addEventListener("change", () => {
    isUserDraggingSeekBar = false;
    const idx = parseInt(outSeekbar.value, 10);
    if (idx >= 0 && idx < bufferedSteps.length) {
        currentPlayIdx = idx;
        const step = bufferedSteps[idx];
        renderStep(step);
        updateControlsUI(step, idx);
    }
});

// Action Button Event Bindings
runBtn.addEventListener("click", startAnalysis);
stopBtn.addEventListener("click", stopAnalysis);

// Initialize on DOM Ready
document.addEventListener("DOMContentLoaded", async () => {
    await syncApiBaseUrlFromGist();
    loadExamples();
});
