// public/js/admin/settings.js

// 전역 변수
let isCrawlingProduct = false;
let isCrawlingValue = false;

// 페이지 로드 시 실행
document.addEventListener("DOMContentLoaded", function () {
  // 크롤링 상태 체크
  checkCrawlingStatus();

  // 메트릭스 초기 로드 및 주기적 업데이트
  updateMetrics();
  setInterval(updateMetrics, 60000); // 1분마다 갱신

  // Quill 에디터 초기화
  initializeEditor();

  // 필터 설정 불러오기
  fetchFilterSettings()
    .then(displayFilterSettings)
    .catch((error) =>
      handleError(error, "필터 설정을 불러오는데 실패했습니다.")
    );

  // 공지 목록 불러오기
  fetchNotices()
    .then(displayNotices)
    .catch((error) =>
      handleError(error, "공지 목록을 불러오는데 실패했습니다.")
    );

  // 버튼 이벤트 리스너 등록
  document
    .getElementById("productCrawlBtn")
    .addEventListener("click", startProductCrawling);
  document
    .getElementById("valueCrawlBtn")
    .addEventListener("click", startValueCrawling);
  document
    .getElementById("uploadLogoBtn")
    .addEventListener("click", uploadLogo);
  document
    .getElementById("uploadIntroBtn")
    .addEventListener("click", uploadIntro);
  document
    .getElementById("updateScheduleBtn")
    .addEventListener("click", updateCrawlSchedule);
  document
    .getElementById("saveNoticeBtn")
    .addEventListener("click", saveNotice);
  document
    .getElementById("newNoticeBtn")
    .addEventListener("click", clearNoticeForm);
});

// WebSocket 이벤트 리스너 설정 (실시간 알림 위한 선택적 구현)
// ...

// ----- 메트릭스 관리 -----

// 메트릭스 데이터 업데이트
async function updateMetrics() {
  try {
    const stats = await fetchUserStats().catch(() => {
      // API가 아직 구현되지 않은 경우 샘플 데이터 사용
      return { activeUsers: 12, dailyUsers: 45, totalRequests: 256 };
    });

    document.getElementById("activeUsers").textContent = stats.activeUsers || 0;
    document.getElementById("dailyUsers").textContent = stats.dailyUsers || 0;
    document.getElementById("totalRequests").textContent =
      stats.totalRequests || 0;
  } catch (error) {
    console.error("메트릭스 업데이트 중 오류:", error);
  }
}

// ----- 크롤링 관리 -----

// 크롤링 상태 체크 함수
async function checkCrawlingStatus() {
  try {
    const status = await checkCrawlingStatus();

    isCrawlingProduct = status.isCrawling;
    isCrawlingValue = status.isValueCrawling;

    updateCrawlingUI();

    // 크롤링 중인 경우 주기적으로 상태 체크
    if (isCrawlingProduct || isCrawlingValue) {
      startStatusCheck();
    }
  } catch (error) {
    console.error("크롤링 상태 확인 중 오류:", error);
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

// 상품 크롤링 시작
async function startProductCrawling() {
  if (isCrawlingProduct || isCrawlingValue) return;

  try {
    isCrawlingProduct = true;
    updateCrawlingUI();

    await startProductCrawling();

    // 크롤링이 시작되면 주기적으로 상태 체크
    startStatusCheck();
  } catch (error) {
    console.error("상품 크롤링 시작 중 오류:", error);
    isCrawlingProduct = false;
    updateCrawlingUI();
    showAlert("상품 크롤링 시작 중 오류가 발생했습니다.");
  }
}

// 시세표 크롤링 시작
async function startValueCrawling() {
  if (isCrawlingProduct || isCrawlingValue) return;

  try {
    isCrawlingValue = true;
    updateCrawlingUI();

    await startValueCrawling();

    // 크롤링이 시작되면 주기적으로 상태 체크
    startStatusCheck();
  } catch (error) {
    console.error("시세표 크롤링 시작 중 오류:", error);
    isCrawlingValue = false;
    updateCrawlingUI();
    showAlert("시세표 크롤링 시작 중 오류가 발생했습니다.");
  }
}

// ----- 파일 업로드 관리 -----

// 로고 업로드
async function uploadLogo() {
  const logoFile = document.getElementById("logoFile").files[0];
  if (!logoFile) {
    showAlert("로고 파일을 선택해주세요.");
    return;
  }

  const formData = new FormData();
  formData.append("logo", logoFile);

  try {
    // 파일 업로드 API는 fetchAPI 함수 대신 기본 fetch 사용
    const response = await fetch("/api/admin/upload-logo", {
      method: "POST",
      body: formData,
      credentials: "include",
    });

    if (!response.ok) {
      throw new Error("로고 업로드에 실패했습니다.");
    }

    showAlert("로고가 성공적으로 업로드되었습니다.", "success");
  } catch (error) {
    handleError(error, "로고 업로드 중 오류가 발생했습니다.");
  }
}

// intro.html 업로드
async function uploadIntro() {
  const introFile = document.getElementById("introFile").files[0];
  if (!introFile) {
    showAlert("인트로 페이지 파일을 선택해주세요.");
    return;
  }

  // HTML 파일 검증
  if (!introFile.type.includes("html")) {
    showAlert("HTML 파일만 업로드 가능합니다.");
    return;
  }

  const formData = new FormData();
  formData.append("intro", introFile);

  try {
    // 파일 업로드 API는 fetchAPI 함수 대신 기본 fetch 사용
    const response = await fetch("/api/admin/upload-intro", {
      method: "POST",
      body: formData,
      credentials: "include",
    });

    if (!response.ok) {
      throw new Error("인트로 페이지 업로드에 실패했습니다.");
    }

    showAlert("인트로 페이지가 성공적으로 업로드되었습니다.", "success");
  } catch (error) {
    handleError(error, "인트로 페이지 업로드 중 오류가 발생했습니다.");
  }
}

// 크롤링 스케줄 설정
async function updateCrawlSchedule() {
  const crawlTime = document.getElementById("crawlTime").value;
  if (!crawlTime) {
    showAlert("크롤링 시간을 선택해주세요.");
    return;
  }

  try {
    await updateCrawlSchedule(crawlTime);
    showAlert("크롤링 스케줄이 성공적으로 설정되었습니다.", "success");
  } catch (error) {
    handleError(error, "크롤링 스케줄 설정 중 오류가 발생했습니다.");
  }
}

// ----- 공지 관리 -----

// Quill 에디터 초기화
let quill;
function initializeEditor() {
  quill = new Quill("#editor", {
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

  // 이미지 핸들러 추가 (선택적 구현)
  // ...
}

// 공지 저장
async function saveNotice() {
  const noticeId = document.getElementById("noticeId").value;
  const title = document.getElementById("noticeTitle").value;
  const content = quill.root.innerHTML;

  if (!title || !content || content === "<p><br></p>") {
    showAlert("제목과 내용을 모두 입력해주세요.");
    return;
  }

  try {
    const noticeData = {
      id: noticeId || undefined,
      title,
      content,
    };

    await saveNotice(noticeData);
    showAlert("공지가 성공적으로 저장되었습니다.", "success");
    clearNoticeForm();

    // 공지 목록 새로고침
    const notices = await fetchNotices();
    displayNotices(notices);
  } catch (error) {
    handleError(error, "공지 저장 중 오류가 발생했습니다.");
  }
} // 공지 폼 초기화
function clearNoticeForm() {
  document.getElementById("noticeId").value = "";
  document.getElementById("noticeTitle").value = "";
  quill.setContents([]);
}

// 공지 목록 표시
function displayNotices(notices) {
  const noticeList = document.getElementById("noticeList");

  if (!notices || notices.length === 0) {
    noticeList.innerHTML =
      '<div class="no-notices">등록된 공지가 없습니다.</div>';
    return;
  }

  let html = "";

  notices.forEach((notice) => {
    // 본문 미리보기 생성 (HTML 태그 제거하고 일부만 표시)
    const contentPreview =
      notice.content
        .replace(/<[^>]*>?/gm, "") // HTML 태그 제거
        .substring(0, 100) + (notice.content.length > 100 ? "..." : "");

    html += `
        <div class="notice-item">
          <h3>${notice.title}</h3>
          <p>${contentPreview}</p>
          <div class="notice-actions">
            <button class="btn" onclick="editNotice('${notice.id}')">수정</button>
            <button class="btn btn-danger" onclick="deleteNotice('${notice.id}')">삭제</button>
          </div>
        </div>
      `;
  });

  noticeList.innerHTML = html;
}

// 공지 수정
async function editNotice(id) {
  try {
    const notice = await fetchNotice(id);

    document.getElementById("noticeId").value = notice.id;
    document.getElementById("noticeTitle").value = notice.title;

    // Quill 내용 설정
    quill.setContents([]);
    quill.clipboard.dangerouslyPasteHTML(0, notice.content);
  } catch (error) {
    handleError(error, "공지를 불러오는데 실패했습니다.");
  }
}

// 공지 삭제
async function deleteNotice(id) {
  if (!confirmAction("정말로 이 공지를 삭제하시겠습니까?")) {
    return;
  }

  try {
    await deleteNotice(id);
    showAlert("공지가 성공적으로 삭제되었습니다.", "success");

    // 공지 목록 새로고침
    const notices = await fetchNotices();
    displayNotices(notices);
  } catch (error) {
    handleError(error, "공지 삭제 중 오류가 발생했습니다.");
  }
}

// ----- 필터 설정 관리 -----

// 필터 설정 표시
function displayFilterSettings(settings) {
  // 필터 타입별로 분류
  const dateFilters = settings.filter((s) => s.filter_type === "date");
  const brandFilters = settings.filter((s) => s.filter_type === "brand");
  const categoryFilters = settings.filter((s) => s.filter_type === "category");

  // 각 섹션에 필터 아이템 추가
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

// 날짜 포맷 함수 (YYYY-MM-DD)
function formatDateOnly(dateString) {
  const date = new Date(dateString);
  // UTC 시간에 9시간(KST)을 더함
  const kstDate = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  return kstDate.toISOString().split("T")[0];
}

// 필터 토글 HTML 생성
function createFilterToggle(filter) {
  return `
      <div class="filter-item">
        <label class="toggle-switch">
          <input type="checkbox" 
            ${filter.is_enabled ? "checked" : ""} 
            onchange="updateFilterSetting('${filter.filter_type}', '${
    filter.filter_value
  }', this.checked)">
          <span class="toggle-slider"></span>
        </label>
        <span class="filter-value">
          ${
            filter.filter_type === "date"
              ? formatDateOnly(filter.filter_value)
              : filter.filter_value
          }
        </span>
      </div>
    `;
}

// 필터 설정 업데이트
async function updateFilterSetting(filterType, filterValue, isEnabled) {
  try {
    await updateFilterSetting(filterType, filterValue, isEnabled);

    // 성공 메시지 표시
    const action = isEnabled ? "활성화" : "비활성화";
    showAlert(
      `${getFilterTypeText(
        filterType
      )} 필터 "${filterValue}"가 ${action}되었습니다.`,
      "success"
    );
  } catch (error) {
    handleError(error, "필터 설정 업데이트에 실패했습니다.");

    // 실패 시 필터 설정 다시 로드하여 UI 업데이트
    const settings = await fetchFilterSettings();
    displayFilterSettings(settings);
  }
}

// 필터 타입 텍스트 반환
function getFilterTypeText(filterType) {
  switch (filterType) {
    case "date":
      return "날짜";
    case "brand":
      return "브랜드";
    case "category":
      return "카테고리";
    default:
      return filterType;
  }
}
