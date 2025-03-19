document.addEventListener("DOMContentLoaded", function () {
  // 공지사항 로드
  loadNotices();

  // 창 크기 변경 시 공지사항 섹션 표시/숨김 처리
  handleNoticeVisibility();
  window.addEventListener("resize", handleNoticeVisibility);

  // 터치 이벤트 초기화
  initTouchEvents();
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

    // 자동 슬라이드 시작 (여러 공지사항이 있는 경우)
    if (notices.length > 1) {
      startNoticeSlider();
    }
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

  // 네비게이션 버튼 제거 - 슬라이드 제스처로 대체

  // 슬라이더 래퍼 추가
  const sliderWrapper = document.createElement("div");
  sliderWrapper.className = "notice-slider-wrapper";
  noticeContainer.appendChild(sliderWrapper);

  // 각 공지사항 아이템 생성
  notices.forEach((notice, index) => {
    const noticeItem = document.createElement("div");
    noticeItem.className = "notice-item";
    noticeItem.dataset.index = index;

    if (index === 0) {
      noticeItem.classList.add("active");
    }

    // 이미지와 링크 생성
    if (notice.targetUrl) {
      // URL이 있는 경우 링크로 감싸기
      noticeItem.innerHTML = `
        <a href="${escapeHTML(notice.targetUrl)}" target="_blank">
          <div class="notice-image-container">
            <img src="${escapeHTML(notice.imageUrl)}" alt="${escapeHTML(
        notice.title
      )}">
          </div>
          <div class="notice-title">${escapeHTML(notice.title)}</div>
        </a>
      `;
    } else {
      // URL이 없는 경우 이미지와 제목만 표시
      noticeItem.innerHTML = `
        <div class="notice-content">
          <div class="notice-image-container">
            <img src="${escapeHTML(notice.imageUrl)}" alt="${escapeHTML(
        notice.title
      )}">
          </div>
          <div class="notice-title">${escapeHTML(notice.title)}</div>
        </div>
      `;

      // 클릭 이벤트 추가 (상세 모달 표시 등)
      noticeItem.addEventListener("click", () => {
        // 상세 모달 표시 함수 호출 (있는 경우)
        if (typeof showNoticeDetail === "function") {
          showNoticeDetail(notice);
        }
      });
    }

    sliderWrapper.appendChild(noticeItem);
  });

  // 인디케이터 추가 (공지사항이 여러 개일 경우)
  if (notices.length > 1) {
    const indicatorContainer = document.createElement("div");
    indicatorContainer.className = "notice-indicators";

    notices.forEach((_, index) => {
      const indicator = document.createElement("span");
      indicator.className = "notice-indicator";
      if (index === 0) indicator.classList.add("active");
      indicator.dataset.index = index;
      indicator.addEventListener("click", () => {
        const currentIndex = parseInt(
          document.querySelector(".notice-item.active").dataset.index
        );

        // 방향 결정 (애니메이션용)
        let direction = 1; // 기본은 오른쪽
        if (currentIndex < index) {
          direction = 1; // 다음으로 (왼쪽으로 슬라이드)
        } else if (currentIndex > index) {
          direction = -1; // 이전으로 (오른쪽으로 슬라이드)
        } else {
          return; // 같은 항목이면 무시
        }

        // 현재 아이템
        const currentItem = document.querySelector(".notice-item.active");
        const nextItem = document.querySelector(
          `.notice-item[data-index="${index}"]`
        );

        if (direction > 0) {
          // 다음으로 이동 (왼쪽으로 슬라이드)
          currentItem.classList.add("notice-slide-out-left");
          nextItem.classList.add("notice-slide-left");
        } else {
          // 이전으로 이동 (오른쪽으로 슬라이드)
          currentItem.classList.add("notice-slide-out-right");
          nextItem.classList.add("notice-slide-right");
        }

        // 애니메이션 시작 전에 다음 아이템 표시
        nextItem.style.display = "block";

        // 애니메이션 종료 후 클래스 정리
        setTimeout(() => {
          document.querySelectorAll(".notice-item").forEach((item) => {
            item.classList.remove(
              "active",
              "notice-slide-left",
              "notice-slide-right",
              "notice-slide-out-left",
              "notice-slide-out-right"
            );
          });
          nextItem.classList.add("active");

          // 인디케이터 업데이트
          document.querySelectorAll(".notice-indicator").forEach((ind, idx) => {
            ind.classList.toggle("active", idx === index);
          });
        }, 300);

        // 자동 슬라이드 재시작
        startNoticeSlider();
      });
      indicatorContainer.appendChild(indicator);
    });

    noticeContainer.appendChild(indicatorContainer);
  }

  // 네비게이션 버튼 제거 - 슬라이드 제스처로 대체
}

// 공지사항 슬라이더 자동 재생
let noticeInterval;
function startNoticeSlider() {
  // 이전에 설정된 인터벌 제거
  if (noticeInterval) {
    clearInterval(noticeInterval);
  }

  // 5초마다 다음 공지사항으로 이동
  noticeInterval = setInterval(() => {
    navigateNotice(1);
  }, 5000);
}

// 공지사항 수동 네비게이션
function navigateNotice(direction) {
  const items = document.querySelectorAll(".notice-item");
  if (items.length <= 1) return;

  // 현재 활성화된 공지사항 찾기
  const currentItem = document.querySelector(".notice-item.active");
  const currentIndex = parseInt(currentItem.dataset.index);
  let nextIndex = currentIndex + direction;

  // 인덱스 범위 조정
  if (nextIndex < 0) nextIndex = items.length - 1;
  if (nextIndex >= items.length) nextIndex = 0;

  // 슬라이드 방향에 따른 애니메이션 클래스 설정
  const nextItem = document.querySelector(
    `.notice-item[data-index="${nextIndex}"]`
  );

  if (direction > 0) {
    // 다음으로 이동 (왼쪽으로 슬라이드)
    currentItem.classList.add("notice-slide-out-left");
    nextItem.classList.add("notice-slide-left");
  } else {
    // 이전으로 이동 (오른쪽으로 슬라이드)
    currentItem.classList.add("notice-slide-out-right");
    nextItem.classList.add("notice-slide-right");
  }

  // 애니메이션 종료 후 클래스 정리
  setTimeout(() => {
    items.forEach((item) => {
      item.classList.remove(
        "active",
        "notice-slide-left",
        "notice-slide-right",
        "notice-slide-out-left",
        "notice-slide-out-right"
      );
    });
    nextItem.classList.add("active");

    // 인디케이터 업데이트
    document.querySelectorAll(".notice-indicator").forEach((indicator, idx) => {
      indicator.classList.toggle("active", idx === nextIndex);
    });
  }, 300); // 애니메이션 지속 시간과 일치

  // 애니메이션 시작 전에 다음 아이템 표시
  nextItem.style.display = "block";

  // 자동 슬라이드 재시작
  startNoticeSlider();
}

// 특정 인덱스의 공지사항으로 직접 이동 (인디케이터 클릭 시)
function goToNotice(index) {
  const items = document.querySelectorAll(".notice-item");
  const currentItem = document.querySelector(".notice-item.active");
  const currentIndex = parseInt(currentItem.dataset.index);

  // 같은 인덱스면 무시
  if (currentIndex === index) return;

  // 방향 결정 (애니메이션 방향 설정 위함)
  const direction = index > currentIndex ? 1 : -1;

  // navigateNotice 함수 재사용
  navigateNotice(direction);
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

  // 반응형 처리는 CSS에서 주로 담당
}

// 공지사항 상세 모달 표시 함수 (선택적 구현)
function showNoticeDetail(notice) {
  // 기존 모달이 있으면 활용
  const modal = document.getElementById("noticeDetailModal");
  if (modal) {
    // 모달 내용 업데이트
    document.getElementById("noticeTitle").textContent = notice.title;
    if (document.getElementById("noticeContent")) {
      document.getElementById("noticeContent").innerHTML = notice.content || "";
    }
    if (document.getElementById("noticeImage")) {
      document.getElementById("noticeImage").src = notice.imageUrl;
      document.getElementById("noticeImage").style.display = "block";
    }

    // 모달 표시
    modal.style.display = "block";
  }
}

// API 모듈에 공지사항 API 추가
if (window.API) {
  // 공개 공지사항 API 함수 추가
  window.API.getNotices = async function () {
    return await window.API.fetchAPI("/notices");
  };
}

// 터치 슬라이드 기능 초기화
function initTouchEvents() {
  const container = document.getElementById("noticeContainer");
  if (!container) return;

  let touchStartX = 0;
  let touchEndX = 0;

  // 마우스 이벤트 (데스크톱)
  container.addEventListener("mousedown", (e) => {
    touchStartX = e.clientX;

    // 드래그 중 텍스트 선택 방지
    e.preventDefault();

    // 마우스 드래그 이벤트
    const handleMouseMove = (moveEvent) => {
      // 드래그 중 텍스트 선택 방지
      moveEvent.preventDefault();
    };

    // 마우스 업 이벤트
    const handleMouseUp = (upEvent) => {
      touchEndX = upEvent.clientX;
      handleSwipe();

      // 이벤트 리스너 제거
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };

    // 문서 전체에 이벤트 리스너 추가
    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
  });

  // 터치 이벤트 (모바일)
  container.addEventListener(
    "touchstart",
    (e) => {
      touchStartX = e.touches[0].clientX;
    },
    { passive: true }
  );

  container.addEventListener(
    "touchend",
    (e) => {
      touchEndX = e.changedTouches[0].clientX;
      handleSwipe();
    },
    { passive: true }
  );

  // 스와이프 처리 함수
  function handleSwipe() {
    const swipeDistance = touchEndX - touchStartX;
    const minSwipeDistance = 50; // 최소 스와이프 거리 (픽셀)

    // 우측에서 좌측으로 스와이프 (다음 공지사항)
    if (swipeDistance < -minSwipeDistance) {
      navigateNotice(1);
    }
    // 좌측에서 우측으로 스와이프 (이전 공지사항)
    else if (swipeDistance > minSwipeDistance) {
      navigateNotice(-1);
    }
  }
}

// 페이지 떠날 때 인터벌 정리
window.addEventListener("beforeunload", () => {
  if (noticeInterval) {
    clearInterval(noticeInterval);
  }
});
