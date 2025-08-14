document.addEventListener("DOMContentLoaded", function () {
  // 공지사항 로드
  loadNotices();

  // 창 크기 변경 시 공지사항 섹션 표시/숨김 처리
  handleNoticeVisibility();
  window.addEventListener("resize", handleNoticeVisibility);
});

// 전역 변수
let currentSlide = 0;
let slideInterval;
let isAnimating = false;
let totalSlides = 0;

// 공지사항 가져오기 함수
async function loadNotices() {
  try {
    // 공지사항 API 호출 (public 엔드포인트 사용)
    const notices = await window.API.fetchAPI("/admin/public/notices");

    // 공지사항이 없으면 섹션 숨김
    if (!notices || notices.length === 0) {
      const noticeSection = document.querySelector(".notice-section");
      noticeSection.classList.remove("notice-visible");
      noticeSection.classList.add("notice-hidden");
      return;
    }

    // 공지사항 표시
    displayNotices(notices);
    const noticeSection = document.querySelector(".notice-section");
    noticeSection.classList.remove("notice-hidden");
    noticeSection.classList.add("notice-visible");

    // 첫 번째 슬라이드 이미지가 로드된 후 공지사항 컨테이너의 높이를 설정
    if (notices.length > 0) {
      const firstNoticeImg = new Image();
      firstNoticeImg.onload = () => {
        // 슬라이드 이벤트 초기화
        initSlideEvents();

        // 자동 슬라이드 시작 (여러 공지사항이 있는 경우)
        if (notices.length > 1) {
          startAutoSlide();
        }
      };
      firstNoticeImg.onerror = () => {
        // 이미지 로드 실패해도 슬라이드 초기화
        initSlideEvents();
        if (notices.length > 1) {
          startAutoSlide();
        }
      };
      firstNoticeImg.src = notices[0].imageUrl;
    }
  } catch (error) {
    console.error("공지사항을 불러오는 중 오류가 발생했습니다:", error);
    const noticeSection = document.querySelector(".notice-section");
    noticeSection.classList.remove("notice-visible");
    noticeSection.classList.add("notice-hidden");
  }
}

// 공지사항 표시 함수
function displayNotices(notices) {
  const noticeContainer = document.getElementById("noticeContainer");
  totalSlides = notices.length;
  currentSlide = 0;

  // 컨테이너 초기화
  noticeContainer.innerHTML = "";

  // 슬라이더 래퍼 추가
  const sliderWrapper = document.createElement("div");
  sliderWrapper.className = "notice-slider-wrapper";
  noticeContainer.appendChild(sliderWrapper);

  // 이미지 미리 로드 함수
  function preloadImage(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = resolve;
      img.onerror = reject;
      img.src = url;
    });
  }

  // 모든 이미지 먼저 미리 로드
  notices.forEach((notice) => {
    preloadImage(notice.imageUrl).catch(() => {
      console.warn("이미지 로드 실패:", notice.imageUrl);
    });
  });

  // 각 공지사항 아이템 생성
  notices.forEach((notice, index) => {
    const noticeItem = document.createElement("div");
    noticeItem.className = "notice-item";
    if (index === 0) {
      noticeItem.classList.add("show");
    } else {
      noticeItem.classList.add("hidden");
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

      indicator.addEventListener("click", () => {
        if (isAnimating) return;
        goToSlide(index);
      });

      indicatorContainer.appendChild(indicator);
    });

    noticeContainer.appendChild(indicatorContainer);
  }

  // 네비게이션 버튼 추가
  if (notices.length > 1) {
    const prevButton = document.createElement("button");
    prevButton.className = "notice-nav prev";
    prevButton.innerHTML = '<i class="fas fa-chevron-left"></i>';
    prevButton.setAttribute("aria-label", "이전 공지사항");

    const nextButton = document.createElement("button");
    nextButton.className = "notice-nav next";
    nextButton.innerHTML = '<i class="fas fa-chevron-right"></i>';
    nextButton.setAttribute("aria-label", "다음 공지사항");

    noticeContainer.appendChild(prevButton);
    noticeContainer.appendChild(nextButton);

    // 이벤트 리스너 추가
    prevButton.addEventListener("click", () => {
      if (isAnimating) return;
      prevSlide();
    });

    nextButton.addEventListener("click", () => {
      if (isAnimating) return;
      nextSlide();
    });
  }
}

// 슬라이드 이벤트 초기화
function initSlideEvents() {
  const container = document.getElementById("noticeContainer");
  if (!container || totalSlides <= 1) return;

  let touchStartX = 0;
  let touchEndX = 0;

  // 터치 이벤트 (모바일)
  container.addEventListener(
    "touchstart",
    (e) => {
      if (isAnimating) return;
      touchStartX = e.touches[0].clientX;
      pauseAutoSlide();
    },
    { passive: true }
  );

  container.addEventListener(
    "touchend",
    (e) => {
      if (isAnimating) return;
      touchEndX = e.changedTouches[0].clientX;
      handleSwipe();
      resumeAutoSlide();
    },
    { passive: true }
  );

  // 스와이프 처리 함수
  function handleSwipe() {
    const swipeDistance = touchEndX - touchStartX;
    const minSwipeDistance = 50; // 최소 스와이프 거리

    if (Math.abs(swipeDistance) < minSwipeDistance) return;

    if (swipeDistance > 0) {
      prevSlide();
    } else {
      nextSlide();
    }
  }
}

// 다음 슬라이드로 이동
function nextSlide() {
  goToSlide((currentSlide + 1) % totalSlides);
}

// 이전 슬라이드로 이동
function prevSlide() {
  goToSlide((currentSlide - 1 + totalSlides) % totalSlides);
}

// 특정 슬라이드로 이동
function goToSlide(index) {
  if (index === currentSlide || isAnimating || totalSlides <= 1) return;

  isAnimating = true;

  const items = document.querySelectorAll(".notice-item");
  const direction = index > currentSlide ? 1 : -1;

  // 현재 슬라이드와 새 슬라이드 요소
  const currentItem = items[currentSlide];
  const nextItem = items[index];

  // 고정 높이 설정을 위해 현재 슬라이더의 높이 계산
  const sliderHeight = currentItem.offsetHeight;
  const sliderWrapper = currentItem.parentElement;
  sliderWrapper.style.height = sliderHeight + "px";

  // 애니메이션 전 준비
  nextItem.classList.remove("hidden");
  nextItem.classList.add("show");

  // 현재 슬라이드 위치
  currentItem.style.position = "absolute";
  currentItem.style.top = "0";
  currentItem.style.left = "0";
  currentItem.style.width = "100%";
  currentItem.style.zIndex = "1";

  // 새 슬라이드 위치 (화면 밖에서 시작)
  nextItem.style.position = "absolute";
  nextItem.style.top = "0";
  nextItem.style.left = direction > 0 ? "100%" : "-100%";
  nextItem.style.width = "100%";
  nextItem.style.zIndex = "2";

  // 애니메이션
  const duration = 300; // ms
  const startTime = performance.now();

  // 슬라이드 실제 요소들 참조
  const currentContent =
    currentItem.querySelector(".notice-content") ||
    currentItem.querySelector("a");
  const nextContent =
    nextItem.querySelector(".notice-content") || nextItem.querySelector("a");

  // 투명도 초기화
  if (currentContent) currentContent.style.opacity = "1";
  if (nextContent) nextContent.style.opacity = "0";

  function animate(time) {
    const elapsed = time - startTime;
    const progress = Math.min(elapsed / duration, 1);

    // 이징 함수 (ease-out)
    const easeProgress = 1 - Math.pow(1 - progress, 2);

    // 투명도 변경으로 부드러운 전환
    if (currentContent)
      currentContent.style.opacity = (1 - easeProgress).toString();
    if (nextContent) nextContent.style.opacity = easeProgress.toString();

    // 위치 변경
    currentItem.style.left = -direction * 100 * easeProgress + "%";
    nextItem.style.left = direction * 100 * (1 - easeProgress) + "%";

    if (progress < 1) {
      requestAnimationFrame(animate);
    } else {
      // 애니메이션 완료
      if (currentContent) currentContent.style.opacity = "";
      if (nextContent) nextContent.style.opacity = "";
      finishTransition();
    }
  }

  function finishTransition() {
    // 슬라이더 래퍼 높이 초기화
    const sliderWrapper = items[0].parentElement;

    // 스타일 초기화
    items.forEach((item) => {
      item.style.position = "";
      item.style.top = "";
      item.style.left = "";
      item.style.width = "";
      item.style.zIndex = "";
      item.style.display = "none";
    });

    // 새 슬라이드만 표시
    nextItem.style.display = "block";

    // 슬라이더 래퍼 높이 초기화 (애니메이션 완료 후)
    setTimeout(() => {
      sliderWrapper.style.height = "";
    }, 50);

    // 인디케이터 업데이트
    updateIndicators(index);

    // 현재 슬라이드 업데이트
    currentSlide = index;

    // 애니메이션 상태 초기화
    isAnimating = false;
  }

  requestAnimationFrame(animate);
}

// 인디케이터 업데이트
function updateIndicators(index) {
  const indicators = document.querySelectorAll(".notice-indicator");
  indicators.forEach((indicator, i) => {
    indicator.classList.toggle("active", i === index);
  });
}

// 자동 슬라이드 시작
function startAutoSlide() {
  // 이전 인터벌 제거
  if (slideInterval) {
    clearInterval(slideInterval);
  }

  // 10초마다 다음 슬라이드로 이동
  slideInterval = setInterval(() => {
    if (!isAnimating) {
      nextSlide();
    }
  }, 10000);
}

// 자동 슬라이드 일시 중지
function pauseAutoSlide() {
  if (slideInterval) {
    clearInterval(slideInterval);
  }
}

// 자동 슬라이드 재개
function resumeAutoSlide() {
  startAutoSlide();
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
  if (noticeSection.classList.contains("hidden")) return;
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
      document.getElementById("noticeImage").classList.remove("hidden");
      document.getElementById("noticeImage").classList.add("show");
    }

    // 모달 표시
    modal.classList.remove("hidden");
    modal.classList.add("show");
  }
}

// API 모듈에 공지사항 API 추가
if (window.API) {
  // 공개 공지사항 API 함수 추가
  window.API.getNotices = async function () {
    return await window.API.fetchAPI("/notices");
  };
}

// 페이지 떠날 때 인터벌 정리
window.addEventListener("beforeunload", () => {
  if (slideInterval) {
    clearInterval(slideInterval);
  }
});
