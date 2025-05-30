// public/js/admin.js

const API_URL = "/api";

let isCrawlingProduct = false;
let isCrawlingValue = false;

// 크롤링 상태 체크 함수
async function checkCrawlingStatus() {
  try {
    const response = await fetch(`${API_URL}/crawler/crawl-status`);
    const status = await response.json();

    isCrawlingProduct = status.isCrawling;
    isCrawlingValue = status.isValueCrawling;

    updateCrawlingUI();
  } catch (error) {
    console.error("크롤링 상태 확인 중 오류 발생:", error);
  }
}

// UI 업데이트 함수
function updateCrawlingUI() {
  const productBtn = document.getElementById("productCrawlBtn");
  const valueBtn = document.getElementById("valueCrawlBtn");
  const statusText = document.getElementById("crawlStatus");

  productBtn.disabled = isCrawlingProduct || isCrawlingValue;
  valueBtn.disabled = isCrawlingProduct || isCrawlingValue;

  if (isCrawlingProduct) {
    statusText.textContent = "상품 크롤링 중...";
    productBtn.textContent = "상품 크롤링 중...";
  } else if (isCrawlingValue) {
    statusText.textContent = "시세표 크롤링 중...";
    valueBtn.textContent = "시세표 크롤링 중...";
  } else {
    statusText.textContent = "";
    productBtn.textContent = "상품 크롤링";
    valueBtn.textContent = "시세표 크롤링";
  }
}

// 상품 크롤링 시작
async function startProductCrawling() {
  if (isCrawlingProduct || isCrawlingValue) return;

  try {
    isCrawlingProduct = true;
    updateCrawlingUI();

    const response = await fetch(`${API_URL}/crawler/crawl`, {
      method: "GET",
    });

    if (!response.ok) throw new Error("크롤링 요청 실패");

    // 크롤링이 시작되면 주기적으로 상태 체크
    startStatusCheck();
  } catch (error) {
    console.error("상품 크롤링 시작 중 오류 발생:", error);
    isCrawlingProduct = false;
    updateCrawlingUI();
  }
}

// 시세표 크롤링 시작
async function startValueCrawling() {
  if (isCrawlingProduct || isCrawlingValue) return;

  try {
    isCrawlingValue = true;
    updateCrawlingUI();

    const response = await fetch(`${API_URL}/crawler/crawl-values`, {
      method: "GET",
    });

    if (!response.ok) throw new Error("크롤링 요청 실패");

    // 크롤링이 시작되면 주기적으로 상태 체크
    startStatusCheck();
  } catch (error) {
    console.error("시세표 크롤링 시작 중 오류 발생:", error);
    isCrawlingValue = false;
    updateCrawlingUI();
  }
}

// 주기적 상태 체크 시작
let statusCheckInterval;
function startStatusCheck() {
  // 이전 인터벌이 있다면 제거
  if (statusCheckInterval) clearInterval(statusCheckInterval);

  // 5초마다 상태 체크
  statusCheckInterval = setInterval(async () => {
    await checkCrawlingStatus();

    // 크롤링이 모두 끝났으면 인터벌 종료
    if (!isCrawlingProduct && !isCrawlingValue) {
      clearInterval(statusCheckInterval);
    }
  }, 5000);
}
// 이미지 압축 함수
function compressImage(file, maxWidth, maxHeight, quality) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = function (event) {
      const img = new Image();
      img.src = event.target.result;
      img.onload = function () {
        const canvas = document.createElement("canvas");
        let width = img.width;
        let height = img.height;

        if (width > height) {
          if (width > maxWidth) {
            height *= maxWidth / width;
            width = maxWidth;
          }
        } else {
          if (height > maxHeight) {
            width *= maxHeight / height;
            height = maxHeight;
          }
        }

        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, width, height);

        canvas.toBlob(
          (blob) => {
            resolve(blob);
          },
          "image/jpeg",
          quality
        );
      };
    };
    reader.onerror = (error) => reject(error);
  });
}

// Quill 에디터 초기화 및 이미지 핸들러 설정
const quill = new Quill("#editor", {
  theme: "snow",
  modules: {
    toolbar: [
      [{ header: [1, 2, false] }],
      ["bold", "italic", "underline", "strike"],
      ["image", "code-block"],
      [{ list: "ordered" }, { list: "bullet" }],
      ["clean"],
    ],
  },
  placeholder: "내용을 입력하세요...",
});

const toolbar = quill.getModule("toolbar");
toolbar.addHandler("image", () => {
  const input = document.createElement("input");
  input.setAttribute("type", "file");
  input.setAttribute("accept", "image/*");
  input.click();

  input.onchange = async () => {
    const file = input.files[0];
    if (file) {
      try {
        const compressedBlob = await compressImage(file, 1920, 1080, 0.85);

        const formData = new FormData();
        formData.append("image", compressedBlob, file.name);

        const response = await fetch(`${API_URL}/admin/upload-image`, {
          method: "POST",
          body: formData,
        });

        if (response.ok) {
          const result = await response.json();
          const range = quill.getSelection(true);
          quill.insertEmbed(range.index, "image", result.file.url);
        } else {
          console.error("Image upload failed");
        }
      } catch (error) {
        console.error("Error processing image:", error);
      }
    }
  };
});

// 1. 로고 변경
async function uploadLogo() {
  const logoFile = document.getElementById("logoFile").files[0];
  if (!logoFile) {
    alert("로고 파일을 선택해주세요.");
    return;
  }
  const formData = new FormData();
  formData.append("logo", logoFile);
  try {
    const response = await fetch(`${API_URL}/admin/upload-logo`, {
      method: "POST",
      body: formData,
    });
    if (response.ok) {
      alert("로고가 성공적으로 업로드되었습니다.");
    } else {
      alert("로고 업로드에 실패했습니다.");
    }
  } catch (error) {
    console.error("Error:", error);
    alert("로고 업로드 중 오류가 발생했습니다.");
  }
}

// intro.html 업로드
async function uploadIntro() {
  const introFile = document.getElementById("introFile").files[0];
  if (!introFile) {
    alert("인트로 페이지 파일을 선택해주세요.");
    return;
  }

  // HTML 파일 검증
  if (!introFile.type.includes("html")) {
    alert("HTML 파일만 업로드 가능합니다.");
    return;
  }

  const formData = new FormData();
  formData.append("intro", introFile);

  try {
    const response = await fetch(`${API_URL}/admin/upload-intro`, {
      method: "POST",
      body: formData,
    });

    if (response.ok) {
      alert("인트로 페이지가 성공적으로 업로드되었습니다.");
    } else {
      const error = await response.json();
      alert(error.message || "인트로 페이지 업로드에 실패했습니다.");
    }
  } catch (error) {
    console.error("Error:", error);
    alert("인트로 페이지 업로드 중 오류가 발생했습니다.");
  }
}

// 2. 크롤링 스케줄 설정
async function updateCrawlSchedule() {
  const crawlTime = document.getElementById("crawlTime").value;
  if (!crawlTime) {
    alert("크롤링 시간을 선택해주세요.");
    return;
  }
  try {
    const response = await fetch(`${API_URL}/admin/settings`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ crawlSchedule: crawlTime }),
    });
    if (response.ok) {
      alert("크롤링 스케줄이 성공적으로 설정되었습니다.");
    } else {
      alert("크롤링 스케줄 설정에 실패했습니다.");
    }
  } catch (error) {
    console.error("Error:", error);
    alert("크롤링 스케줄 설정 중 오류가 발생했습니다.");
  }
}

// 3. 공지 관리
async function saveNotice() {
  const noticeId = document.getElementById("noticeId").value;
  const title = document.getElementById("noticeTitle").value;
  const content = quill.root.innerHTML;
  if (!title || !content) {
    alert("제목과 내용을 모두 입력해주세요.");
    return;
  }

  const method = noticeId ? "PUT" : "POST";
  const url = noticeId
    ? `${API_URL}/admin/notices/${noticeId}`
    : `${API_URL}/admin/notices`;

  try {
    const response = await fetch(url, {
      method: method,
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ title, content }),
    });
    if (response.ok) {
      alert("공지가 성공적으로 저장되었습니다.");
      clearNoticeForm();
      fetchNotices();
    } else {
      alert("공지 저장에 실패했습니다.");
    }
  } catch (error) {
    console.error("Error:", error);
    alert("공지 저장 중 오류가 발생했습니다.");
  }
}

function clearNoticeForm() {
  document.getElementById("noticeId").value = "";
  document.getElementById("noticeTitle").value = "";
  quill.setContents([]);
}

async function fetchNotices() {
  try {
    const response = await fetch(`${API_URL}/admin/notices`);
    const notices = await response.json();
    displayNotices(notices);
  } catch (error) {
    console.error("Error fetching notices:", error);
    alert("공지 목록을 불러오는데 실패했습니다.");
  }
}

function displayNotices(notices) {
  const noticeList = document.getElementById("noticeList");
  noticeList.innerHTML = notices
    .map(
      (notice) => `
        <div class="notice-item">
            <h3>${notice.title}</h3>
            <p>${notice.content.substring(0, 100)}...</p>
            <button onclick="editNotice('${notice.id}')">수정</button>
            <button onclick="deleteNotice('${notice.id}')">삭제</button>
        </div>
    `
    )
    .join("");
}
async function editNotice(id) {
  try {
    const response = await fetch(`${API_URL}/admin/notices/${id}`);
    const notice = await response.json();
    document.getElementById("noticeId").value = notice.id;
    document.getElementById("noticeTitle").value = notice.title;

    // Quill 내용 설정
    quill.setContents([]);
    quill.clipboard.dangerouslyPasteHTML(0, notice.content);
  } catch (error) {
    console.error("Error fetching notice:", error);
    alert("공지를 불러오는데 실패했습니다.");
  }
}

async function deleteNotice(id) {
  if (!confirm("정말로 이 공지를 삭제하시겠습니까?")) return;

  try {
    const response = await fetch(`${API_URL}/admin/notices/${id}`, {
      method: "DELETE",
    });
    if (response.ok) {
      alert("공지가 성공적으로 삭제되었습니다.");
      fetchNotices();
    } else {
      alert("공지 삭제에 실패했습니다.");
    }
  } catch (error) {
    console.error("Error:", error);
    alert("공지 삭제 중 오류가 발생했습니다.");
  }
}

async function fetchFilterSettings() {
  try {
    const response = await fetch(`${API_URL}/admin/filter-settings`);
    const settings = await response.json();
    displayFilterSettings(settings);
  } catch (error) {
    console.error("Error fetching filter settings:", error);
    alert("필터 설정을 불러오는데 실패했습니다.");
  }
}

function displayFilterSettings(settings) {
  const dateFilters = settings.filter((s) => s.filter_type === "date");
  const brandFilters = settings.filter((s) => s.filter_type === "brand");
  const categoryFilters = settings.filter((s) => s.filter_type === "category");

  document.getElementById("dateFilters").innerHTML = dateFilters
    .map(createFilterToggle)
    .join("");
  document.getElementById("brandFilters").innerHTML = brandFilters
    .map(createFilterToggle)
    .join("");
  document.getElementById("categoryFilters").innerHTML = categoryFilters
    .map(createFilterToggle)
    .join("");
}

function formatDate(dateString) {
  const date = new Date(dateString);
  // UTC 시간에 9시간(KST)을 더함
  const kstDate = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  return kstDate.toISOString().split("T")[0];
}

function createFilterToggle(filter) {
  return `
        <div class="filter-item">
            <label class="toggle-switch">
                <input type="checkbox" 
                    ${filter.is_enabled ? "checked" : ""} 
                    onchange="updateFilter('${filter.filter_type}', '${
    filter.filter_value
  }', this.checked)">
                <span class="toggle-slider"></span>
            </label>
            <span class="filter-value">${
              filter.filter_type == "date"
                ? formatDate(filter.filter_value)
                : filter.filter_value
            }</span>
        </div>
    `;
}

async function updateFilter(filterType, filterValue, isEnabled) {
  try {
    const response = await fetch(`${API_URL}/admin/filter-settings`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ filterType, filterValue, isEnabled }),
    });

    if (!response.ok) {
      throw new Error("Failed to update filter");
    }

    // 업데이트가 성공적으로 이루어졌음을 사용자에게 알림
    const action = isEnabled ? "활성화" : "비활성화";
    console.log(`${filterType} 필터 "${filterValue}"가 ${action}되었습니다.`);
  } catch (error) {
    console.error("Error updating filter:", error);
    alert("필터 설정 업데이트에 실패했습니다.");
    // 실패 시 토글 되돌리기
    await fetchFilterSettings();
  }
}

function updateMetrics() {
  fetch("/api/metrics")
    .then((response) => response.json())
    .then((data) => {
      document.getElementById("activeUsers").textContent = data.activeUsers;
      document.getElementById("dailyUsers").textContent = data.dailyUsers;
    })
    .catch(console.error);
}

// 1분마다 메트릭스 갱신
setInterval(updateMetrics, 60000);
updateMetrics(); // 초기 로드

// 1분마다 메트릭스 갱신
setInterval(updateMetrics, 60000);
updateMetrics(); // 초기 로드

// 페이지 로드 시 필터 설정 불러오기
fetchFilterSettings();
fetchNotices();
checkCrawlingStatus();
