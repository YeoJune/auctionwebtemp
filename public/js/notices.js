// public/js/notices.js
document.addEventListener("DOMContentLoaded", function () {
  // 공지사항 로드
  loadNotices();

  // 창 크기 변경 시 공지사항 섹션 표시/숨김 처리
  handleNoticeVisibility();
  window.addEventListener("resize", handleNoticeVisibility);
});

// 공지사항 가져오기 함수
async function loadNotices() {
  try {
    // 공지사항 API 호출 (public 엔드포인트 사용)
    const notices = await window.API.fetchAPI("/admin/public/notices");

    // 공지사항이 없으면 섹션 숨김
    if (!notices || notices.length === 0) {
      document.querySelector(".notice-section").style.display = "none";
      return;
    }

    // 공지사항 표시
    displayNotices(notices);
    document.querySelector(".notice-section").style.display = "block";
  } catch (error) {
    console.error("공지사항을 불러오는 중 오류가 발생했습니다:", error);
    document.querySelector(".notice-section").style.display = "none";
  }
}

// 공지사항 표시 함수
function displayNotices(notices) {
  const noticeContainer = document.getElementById("noticeContainer");

  // 컨테이너 초기화
  noticeContainer.innerHTML = "";

  // 각 공지사항 아이템 생성
  notices.forEach((notice) => {
    const noticeItem = document.createElement("div");
    noticeItem.className = "notice-item";

    // 이미지와 링크 생성
    if (notice.targetUrl) {
      // URL이 있는 경우 링크로 감싸기
      noticeItem.innerHTML = `
          <a href="${escapeHTML(notice.targetUrl)}" target="_blank">
            <img src="${escapeHTML(notice.imageUrl)}" alt="${escapeHTML(
        notice.title
      )}">
            <div class="notice-title">${escapeHTML(notice.title)}</div>
          </a>
        `;
    } else {
      // URL이 없는 경우 이미지만 표시
      noticeItem.innerHTML = `
          <img src="${escapeHTML(notice.imageUrl)}" alt="${escapeHTML(
        notice.title
      )}">
          <div class="notice-title">${escapeHTML(notice.title)}</div>
        `;
    }

    noticeContainer.appendChild(noticeItem);
  });
}

// 보안을 위한 HTML 이스케이프 함수
function escapeHTML(str) {
  if (!str) return "";
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// 창 크기에 따라 공지사항 섹션 표시/숨김 처리
function handleNoticeVisibility() {
  const noticeSection = document.querySelector(".notice-section");

  // 이미 숨겨진 상태이면 처리하지 않음
  if (noticeSection.style.display === "none") return;

  // 모바일에서는 공지사항 섹션의 높이를 제한
  if (window.innerWidth <= 768) {
    const noticeContainer = document.getElementById("noticeContainer");
    noticeContainer.style.maxHeight = "170px"; // 모바일에서의 최대 높이
  } else {
    // 데스크톱에서는 제한 없음
    const noticeContainer = document.getElementById("noticeContainer");
    noticeContainer.style.maxHeight = "";
  }
}

// API 모듈에 공지사항 API 추가
if (window.API) {
  // 공개 공지사항 API 함수 추가
  window.API.getNotices = async function () {
    return await window.API.fetchAPI("/notices");
  };
}
