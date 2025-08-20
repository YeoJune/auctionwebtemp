// public/js/admin/settings.js

// 전역 변수
let isCrawlingProduct = false;
let isCrawlingValue = false;

// 페이지 로드 시 실행
document.addEventListener("DOMContentLoaded", function () {
  // 크롤링 상태 체크
  checkCrawlStatus();

  // 메트릭스 초기 로드 및 주기적 업데이트
  updateMetrics();
  setInterval(updateMetrics, 60000); // 1분마다 갱신

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
    .addEventListener("click", startProductCrawl);
  document
    .getElementById("valueCrawlBtn")
    .addEventListener("click", showValueCrawlOptions); // 수정됨
  document
    .getElementById("uploadLogoBtn")
    .addEventListener("click", uploadLogo);
  document
    .getElementById("uploadGuideBtn")
    .addEventListener("click", uploadGuide);
  document
    .getElementById("uploadInquiryBtn")
    .addEventListener("click", uploadInquiry);
  document
    .getElementById("updateScheduleBtn")
    .addEventListener("click", submitCrawlSchedule);
  document
    .getElementById("saveNoticeBtn")
    .addEventListener("click", submitNotice);
  document
    .getElementById("newNoticeBtn")
    .addEventListener("click", clearNoticeForm);

  document
    .getElementById("resetMetricsBtn")
    .addEventListener("click", resetMetricsData);
  // 이미지 미리보기 이벤트 리스너
  document
    .getElementById("noticeImage")
    .addEventListener("change", previewImage);
  document
    .getElementById("removeImageBtn")
    .addEventListener("click", removeImage);

  // 시세표 크롤링 UI 관련 이벤트 리스너 추가
  setupValueCrawlUI();
});

// 시세표 크롤링 UI 관련 이벤트 리스너 설정
function setupValueCrawlUI() {
  // 시세표 크롤링 시작 버튼
  document
    .getElementById("startValueCrawlBtn")
    .addEventListener("click", startValueCrawl);

  // 취소 버튼
  document
    .getElementById("cancelValueCrawlBtn")
    .addEventListener("click", hideValueCrawlOptions);

  // 체크박스 상태에 따라 개월 수 입력 활성화/비활성화
  document.querySelectorAll(".auc-checkbox").forEach((checkbox) => {
    checkbox.addEventListener("change", function () {
      const aucId = this.value;
      const monthsInput = document.getElementById(getMonthsInputId(aucId));
      monthsInput.disabled = !this.checked;
    });
  });
}

// 경매 ID로 개월 입력 필드 ID 구하기
function getMonthsInputId(aucId) {
  switch (aucId) {
    case "1":
      return "ecoAucMonths";
    case "2":
      return "brandAucMonths";
    case "3":
      return "starAucMonths";
    default:
      return "";
  }
}

// 시세표 크롤링 옵션 UI 표시
function showValueCrawlOptions() {
  document.getElementById("valueCrawlOptions").style.display = "block";
}

// 시세표 크롤링 옵션 UI 숨기기
function hideValueCrawlOptions() {
  document.getElementById("valueCrawlOptions").style.display = "none";
}

// 시세표 크롤링 시작 함수 수정
async function startValueCrawl() {
  if (isCrawlingProduct || isCrawlingValue) return;

  // 선택된 경매 플랫폼 확인
  const selectedAucNums = [];
  const selectedMonths = [];

  document.querySelectorAll(".auc-checkbox:checked").forEach((checkbox) => {
    const aucId = checkbox.value;
    selectedAucNums.push(parseInt(aucId));

    // 해당 경매의 개월 수 가져오기
    const monthsInput = document.getElementById(getMonthsInputId(aucId));
    selectedMonths.push(parseInt(monthsInput.value) || 3);
  });

  if (selectedAucNums.length === 0) {
    showAlert("크롤링할 경매를 하나 이상 선택해주세요.");
    return;
  }

  try {
    isCrawlingValue = true;
    updateCrawlingUI();
    hideValueCrawlOptions();

    // API 호출 시 선택된 경매와 개월 수 전달
    const params = new URLSearchParams();
    params.append("auc_num", selectedAucNums.join(","));
    params.append("months", selectedMonths.join(","));

    await startValueCrawling(params.toString()); // API 함수 호출
    // 크롤링이 시작되면 주기적으로 상태 체크
    startStatusCheck();
  } catch (error) {
    console.error("시세표 크롤링 시작 중 오류:", error);
    isCrawlingValue = false;
    updateCrawlingUI();
    showAlert("시세표 크롤링 시작 중 오류가 발생했습니다.");
  }
}

// ----- 메트릭스 관리 -----

// 메트릭스 데이터 업데이트
async function updateMetrics() {
  try {
    const stats = await fetchUserStats();

    // 실시간 접속자 업데이트
    document.getElementById("activeMemberUsers").textContent =
      stats.activeMemberUsers || 0;
    document.getElementById("activeGuestUsers").textContent =
      stats.activeGuestUsers || 0;
    document.getElementById("totalActiveUsers").textContent =
      stats.totalActiveUsers || 0;

    // 오늘 방문자 업데이트
    document.getElementById("dailyMemberUsers").textContent =
      stats.dailyMemberUsers || 0;
    document.getElementById("dailyGuestUsers").textContent =
      stats.dailyGuestUsers || 0;
    document.getElementById("totalDailyUsers").textContent =
      stats.totalDailyUsers || 0;

    // 총 요청 수 및 페이지뷰 업데이트
    document.getElementById("totalRequests").textContent = (
      stats.totalRequests || 0
    ).toLocaleString();
    document.getElementById("uniquePageviews").textContent = (
      stats.uniquePageviews || 0
    ).toLocaleString();

    // 마지막 초기화 시간 업데이트
    if (stats.lastManualReset) {
      const resetDate = new Date(stats.lastManualReset);
      document.getElementById("lastReset").textContent =
        resetDate.toLocaleString();
    } else if (stats.lastReset) {
      const resetDate = new Date(stats.lastReset);
      document.getElementById("lastReset").textContent =
        resetDate.toLocaleString() + " (자동)";
    }
  } catch (error) {
    console.error("메트릭스 업데이트 중 오류:", error);
  }
}

// 메트릭스 초기화
async function resetMetricsData() {
  if (
    !confirmAction(
      "정말로 모든 메트릭스 데이터를 초기화하시겠습니까? 이 작업은 되돌릴 수 없습니다."
    )
  ) {
    return;
  }

  try {
    const response = await fetch("/api/metrics/reset", {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      throw new Error("메트릭스 초기화에 실패했습니다.");
    }

    const result = await response.json();
    showAlert("메트릭스 데이터가 성공적으로 초기화되었습니다.", "success");

    // 메트릭스 데이터 즉시 새로고침
    updateMetrics();
  } catch (error) {
    handleError(error, "메트릭스 초기화 중 오류가 발생했습니다.");
  }
}

// ----- 크롤링 관리 -----

// 크롤링 상태 체크 함수
async function checkCrawlStatus() {
  try {
    const status = await checkCrawlingStatus(); // API 함수 호출

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
    await checkCrawlStatus();

    // 크롤링이 모두 끝났으면 인터벌 종료
    if (!isCrawlingProduct && !isCrawlingValue) {
      clearInterval(statusCheckInterval);
    }
  }, 5000);
}

// 상품 크롤링 시작
async function startProductCrawl() {
  if (isCrawlingProduct || isCrawlingValue) return;

  try {
    isCrawlingProduct = true;
    updateCrawlingUI();

    await startProductCrawling(); // API 함수 호출

    // 크롤링이 시작되면 주기적으로 상태 체크
    startStatusCheck();
  } catch (error) {
    console.error("상품 크롤링 시작 중 오류:", error);
    isCrawlingProduct = false;
    updateCrawlingUI();
    showAlert("상품 크롤링 시작 중 오류가 발생했습니다.");
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

// guide.html 업로드
async function uploadGuide() {
  const guideFile = document.getElementById("guideFile").files[0];
  if (!guideFile) {
    showAlert("가이드 페이지 파일을 선택해주세요.");
    return;
  }

  // HTML 파일 검증
  if (!guideFile.type.includes("html")) {
    showAlert("HTML 파일만 업로드 가능합니다.");
    return;
  }

  const formData = new FormData();
  formData.append("guide", guideFile);

  try {
    // 파일 업로드 API는 fetchAPI 함수 대신 기본 fetch 사용
    const response = await fetch("/api/admin/upload-guide", {
      method: "POST",
      body: formData,
      credentials: "include",
    });

    if (!response.ok) {
      throw new Error("가이드 페이지 업로드에 실패했습니다.");
    }

    showAlert("가이드 페이지가 성공적으로 업로드되었습니다.", "success");
  } catch (error) {
    handleError(error, "가이드 페이지 업로드 중 오류가 발생했습니다.");
  }
}

// 입점신청 페이지 업로드 함수 추가
async function uploadInquiry() {
  const inquiryFile = document.getElementById("inquiryFile").files[0];
  if (!inquiryFile) {
    showAlert("입점신청 페이지 파일을 선택해주세요.");
    return;
  }

  // HTML 파일 검증
  if (!inquiryFile.type.includes("html")) {
    showAlert("HTML 파일만 업로드 가능합니다.");
    return;
  }

  const formData = new FormData();
  formData.append("inquiry", inquiryFile);

  try {
    // 파일 업로드 API는 fetchAPI 함수 대신 기본 fetch 사용
    const response = await fetch("/api/admin/upload-inquiry", {
      method: "POST",
      body: formData,
      credentials: "include",
    });

    if (!response.ok) {
      throw new Error("입점신청 페이지 업로드에 실패했습니다.");
    }

    showAlert("입점신청 페이지가 성공적으로 업로드되었습니다.", "success");
  } catch (error) {
    handleError(error, "입점신청 페이지 업로드 중 오류가 발생했습니다.");
  }
}

// 크롤링 스케줄 설정
async function submitCrawlSchedule() {
  const crawlTime = document.getElementById("crawlTime").value;
  if (!crawlTime) {
    showAlert("크롤링 시간을 선택해주세요.");
    return;
  }

  try {
    await updateCrawlSchedule(crawlTime); // API 함수 호출
    showAlert("크롤링 스케줄이 성공적으로 설정되었습니다.", "success");
  } catch (error) {
    handleError(error, "크롤링 스케줄 설정 중 오류가 발생했습니다.");
  }
}

// ----- 공지 관리 -----

// 이미지 미리보기 함수
function previewImage(e) {
  const file = e.target.files[0];
  if (file) {
    const reader = new FileReader();
    reader.onload = function (e) {
      const preview = document.getElementById("imagePreview");
      preview.src = e.target.result;
      document.getElementById("imagePreviewContainer").style.display = "block";
    };
    reader.readAsDataURL(file);
  }
}

// 이미지 제거 함수
function removeImage() {
  document.getElementById("noticeImage").value = "";
  document.getElementById("imagePreviewContainer").style.display = "none";
}

// 공지 저장
async function submitNotice() {
  const noticeId = document.getElementById("noticeId").value;
  const title = document.getElementById("noticeTitle").value;
  const targetUrl = document.getElementById("noticeUrl").value;
  const imageFile = document.getElementById("noticeImage").files[0];

  if (!title) {
    showAlert("제목을 입력해주세요.");
    return;
  }

  // 새 공지 작성시 이미지는 필수
  if (!noticeId && !imageFile) {
    showAlert("공지 이미지를 선택해주세요.");
    return;
  }

  try {
    const formData = new FormData();
    formData.append("title", title);
    if (targetUrl) formData.append("targetUrl", targetUrl);

    if (imageFile) {
      formData.append("image", imageFile);
    } else if (noticeId) {
      // 기존 이미지 유지
      formData.append("keepExistingImage", "true");
    }

    let url = "/api/admin/notices";
    let method = "POST";

    if (noticeId) {
      url = `/api/admin/notices/${noticeId}`;
      method = "PUT";
    }

    const response = await fetch(url, {
      method: method,
      body: formData,
      credentials: "include",
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.message || "공지 저장 중 오류가 발생했습니다.");
    }

    showAlert("공지가 성공적으로 저장되었습니다.", "success");
    clearNoticeForm();

    // 공지 목록 새로고침
    const notices = await fetchNotices();
    displayNotices(notices);
  } catch (error) {
    handleError(error, "공지 저장 중 오류가 발생했습니다.");
  }
}

// 공지 폼 초기화
function clearNoticeForm() {
  document.getElementById("noticeId").value = "";
  document.getElementById("noticeTitle").value = "";
  document.getElementById("noticeUrl").value = "";
  document.getElementById("noticeImage").value = "";
  document.getElementById("imagePreviewContainer").style.display = "none";
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
    html += `
      <div class="notice-item">
        <h3>${notice.title}</h3>
        <div class="notice-image-container">
          <img src="${notice.imageUrl}" alt="${
      notice.title
    }" style="max-width: 100%; max-height: 200px;">
        </div>
        <div class="notice-url">
          ${
            notice.targetUrl
              ? `링크: <a href="${notice.targetUrl}" target="_blank">${notice.targetUrl}</a>`
              : "링크 없음"
          }
        </div>
        <div class="notice-actions">
          <button class="btn" onclick="editNotice('${notice.id}')">수정</button>
          <button class="btn btn-danger" onclick="deleteSelectedNotice('${
            notice.id
          }')">삭제</button>
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
    document.getElementById("noticeUrl").value = notice.targetUrl || "";

    // 이미지 미리보기 설정
    const preview = document.getElementById("imagePreview");
    preview.src = notice.imageUrl;
    document.getElementById("imagePreviewContainer").style.display = "block";
  } catch (error) {
    handleError(error, "공지를 불러오는데 실패했습니다.");
  }
}

// 공지 삭제 (함수명 변경)
async function deleteSelectedNotice(id) {
  if (!confirmAction("정말로 이 공지를 삭제하시겠습니까?")) {
    return;
  }

  try {
    await deleteNotice(id); // API 함수 호출
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
            onchange="toggleFilterSetting('${filter.filter_type}', '${
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

// 필터 설정 업데이트 (함수명 변경)
async function toggleFilterSetting(filterType, filterValue, isEnabled) {
  try {
    await updateFilterSetting(filterType, filterValue, isEnabled); // API 함수 호출

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
