// public/js/bids.js

// 경매 기능 관리 모듈
window.BidManager = (function () {
  // 내부 상태
  const _state = {
    liveBidData: [], // 현장 경매 입찰 데이터
    directBidData: [], // 직접 경매 입찰 데이터
    isAuthenticated: false,
    currentData: [], // 현재 표시 중인 상품 데이터
  };

  // 내부 API 참조
  const API = window.API;

  /**
   * 남은 시간 계산 함수
   * @param {string} scheduledDate - 마감 날짜/시간
   * @returns {object|null} 남은 시간 정보 객체 또는 null
   */
  function getRemainingTime(scheduledDate) {
    if (!scheduledDate) return null;

    const now = new Date();
    const endDate = new Date(scheduledDate);

    // 이미 지난 날짜면 null 반환
    if (endDate <= now) return null;

    const diff = endDate - now;
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((diff % (1000 * 60)) / 1000);

    return {
      hours,
      minutes,
      seconds,
      total: diff,
      text: `${hours.toString().padStart(2, "0")}:${minutes
        .toString()
        .padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`,
      isNearEnd: diff <= 10 * 60 * 1000, // 10분 이하 남았는지
    };
  }

  /**
   * 현장 경매 입찰 섹션 HTML 생성
   * @param {object} bidInfo - 입찰 정보 객체
   * @param {string} itemId - 상품 ID
   * @param {number} aucNum - 출품사 번호
   * @param {string} category - 상품 카테고리
   * @returns {string} 입찰 섹션 HTML
   */
  function getLiveBidSectionHTML(bidInfo, itemId, aucNum, category) {
    const item = _state.currentData.find((item) => item.item_id === itemId);
    if (!item) return "";

    // 시작가
    const startingPrice = parseFloat(item.starting_price) || 0;

    // 타이머 HTML
    const timer = getRemainingTime(item.scheduled_date);
    const timerHTML = timer
      ? `
        <div class="bid-timer ${timer.isNearEnd ? "near-end" : ""}">
          입찰마감 남은시간 [${timer.text}]
        </div>
      `
      : "";

    // 최종 입찰가가 있는 경우
    if (bidInfo?.final_price) {
      return `
          <div class="bid-info live">
            ${timerHTML}
            <div class="final-price">
              <p>최종 입찰금액: ${cleanNumberFormat(bidInfo.final_price)} ¥</p>
              <div class="price-details-container">
                관부가세 포함 ${cleanNumberFormat(
                  calculateTotalPrice(bidInfo.final_price, aucNum, category)
                )}원
              </div>
            </div>
          </div>`;
    }

    // 1차/2차 입찰 진행 중인 경우
    let html = `<div class="bid-info live">
        ${timerHTML}
        <div class="real-time-price">
          <p>시작 금액: ${cleanNumberFormat(startingPrice)} ¥</p>
          <div class="price-details-container">
            관부가세 포함 ${cleanNumberFormat(
              calculateTotalPrice(startingPrice, aucNum, category)
            )}원
          </div>
        </div>`;

    if (bidInfo?.first_price || bidInfo?.second_price) {
      // 1차 입찰이 있는 경우
      if (bidInfo.first_price) {
        html += `
            <div class="bid-price-info">
              <p>1차 입찰금액: ${cleanNumberFormat(bidInfo.first_price)} ¥</p>
              <div class="price-details-container first-price">
                관부가세 포함 ${cleanNumberFormat(
                  calculateTotalPrice(bidInfo.first_price, aucNum, category)
                )}원
              </div>
            </div>`;
      }

      // 2차 제안이 있는 경우
      if (bidInfo.second_price) {
        html += `
            <div class="bid-price-info">
              <p>2차 제안금액: ${cleanNumberFormat(bidInfo.second_price)} ¥</p>
              <div class="price-details-container second-price">
                관부가세 포함 ${cleanNumberFormat(
                  calculateTotalPrice(bidInfo.second_price, aucNum, category)
                )}원
              </div>
            </div>`;
      }
    }

    // 입찰 입력 UI
    html += `
        <div class="bid-input-container">
          <div class="bid-input-group">
            <span class="bid-input-label">${
              bidInfo?.first_price ? "최종입찰 금액" : "1차금액 입력"
            }</span>
            <input type="number" placeholder="" class="bid-input" data-item-id="${itemId}" data-bid-type="live">
            <span class="bid-value-display">000</span>
            <span class="bid-currency">¥</span>
            <button class="bid-button" onclick="event.stopPropagation(); BidManager.handleLiveBidSubmit(this.parentElement.querySelector('.bid-input').value, '${itemId}')">입찰</button>
          </div>
          <div class="price-details-container"></div>
          <div class="quick-bid-buttons">
            <button class="quick-bid-btn" onclick="event.stopPropagation(); BidManager.quickAddBid('${itemId}', 1, 'live')">+1,000¥</button>
            <button class="quick-bid-btn" onclick="event.stopPropagation(); BidManager.quickAddBid('${itemId}', 5, 'live')">+5,000¥</button>
            <button class="quick-bid-btn" onclick="event.stopPropagation(); BidManager.quickAddBid('${itemId}', 10, 'live')">+10,000¥</button>
          </div>
        </div>
      </div>`;

    return html;
  }

  /**
   * 직접 경매 입찰 섹션 HTML 생성
   * @param {object} bidInfo - 입찰 정보 객체
   * @param {string} itemId - 상품 ID
   * @param {number} aucNum - 출품사 번호
   * @param {string} category - 상품 카테고리
   * @returns {string} 입찰 섹션 HTML
   */
  function getDirectBidSectionHTML(bidInfo, itemId, aucNum, category) {
    const item = _state.currentData.find((item) => item.item_id === itemId);
    if (!item) return "";

    // 시작가
    const live_price =
      item.bid_type == "direct" &&
      bidInfo?.current_price &&
      Number(bidInfo.current_price) > Number(item.starting_price)
        ? bidInfo.current_price
        : item.starting_price;

    // 현재 내 입찰가
    const currentPrice = bidInfo?.current_price || 0;

    // 나의 입찰가와 실시간 가격 비교
    const hasHigherBid =
      Number(live_price) > Number(currentPrice) && currentPrice > 0;

    // 타이머 HTML
    const timer = getRemainingTime(item.scheduled_date);
    const timerHTML = timer
      ? `
        <div class="bid-timer ${timer.isNearEnd ? "near-end" : ""}">
          입찰마감 남은시간 [${timer.text}]
        </div>
      `
      : "";

    let html = `<div class="bid-info direct">
        ${
          hasHigherBid
            ? '<div class="higher-bid-alert">더 높은 입찰 존재</div>'
            : ""
        }
        ${timerHTML}
        <div class="real-time-price">
          <p>실시간 금액: ${cleanNumberFormat(live_price)} ¥</p>
          <div class="price-details-container">
            관부가세 포함 ${cleanNumberFormat(
              calculateTotalPrice(live_price, aucNum, category)
            )}원
          </div>
        </div>`;

    if (currentPrice > 0) {
      html += `
          <div class="bid-price-info">
            <p>나의 입찰 금액: ${cleanNumberFormat(currentPrice)} ¥</p>
            <div class="price-details-container my-price">
              관부가세 포함 ${cleanNumberFormat(
                calculateTotalPrice(currentPrice, aucNum, category)
              )}원
            </div>
          </div>`;
    }

    // 입찰 입력 UI
    html += `
        <div class="bid-input-container">
          <div class="bid-input-group">
            <input type="number" placeholder="나의 입찰 금액" class="bid-input" data-item-id="${itemId}" data-bid-type="direct">
            <span class="bid-value-display">000</span>
            <span class="bid-currency">¥</span>
            <button class="bid-button" onclick="event.stopPropagation(); BidManager.handleDirectBidSubmit(this.parentElement.querySelector('.bid-input').value, '${itemId}')">입찰</button>
          </div>
          <div class="price-details-container"></div>
          <div class="quick-bid-buttons">
            <button class="quick-bid-btn" onclick="event.stopPropagation(); BidManager.quickAddBid('${itemId}', 1, 'direct')">+1,000¥</button>
            <button class="quick-bid-btn" onclick="event.stopPropagation(); BidManager.quickAddBid('${itemId}', 5, 'direct')">+5,000¥</button>
            <button class="quick-bid-btn" onclick="event.stopPropagation(); BidManager.quickAddBid('${itemId}', 10, 'direct')">+10,000¥</button>
          </div>
        </div>
      </div>`;

    return html;
  }

  /**
   * 입찰 금액 표시 업데이트
   * @param {HTMLElement} inputElement - 입력 요소
   */
  function updateBidValueDisplay(inputElement) {
    const valueDisplay =
      inputElement.parentElement.querySelector(".bid-value-display");
    if (valueDisplay) {
      valueDisplay.textContent = "000"; // 항상 "000"으로 고정
    }
  }

  /**
   * 현장 경매 입찰 제출 처리
   * @param {string} value - 입찰 금액
   * @param {string} itemId - 상품 ID
   * @returns {Promise<void>}
   */
  async function handleLiveBidSubmit(value, itemId) {
    if (!_state.isAuthenticated) {
      alert("입찰하려면 로그인이 필요합니다.");
      return;
    }

    if (!value) {
      alert("입찰 금액을 입력해주세요.");
      return;
    }

    const numericValue = parseFloat(value) * 1000; // 1000 곱하기
    const item = _state.currentData.find((item) => item.item_id === itemId);
    const bidInfo = _state.liveBidData.find((bid) => bid.item_id === itemId);

    try {
      // 이미 입찰한 내역이 있는지 확인
      if (bidInfo) {
        // 2차 입찰 이후면 최종 입찰 처리
        if (bidInfo.status === "second") {
          await API.fetchAPI(`/live-bids/${bidInfo.id}/final`, {
            method: "PUT",
            body: JSON.stringify({
              finalPrice: numericValue,
            }),
          });
          alert("최종 입찰금액이 등록되었습니다.");
        } else {
          alert("이미 입찰한 상품입니다. 관리자의 2차 제안을 기다려주세요.");
          return;
        }
      } else {
        // 첫 입찰
        await API.fetchAPI("/live-bids", {
          method: "POST",
          body: JSON.stringify({
            itemId,
            firstPrice: numericValue,
          }),
        });
        alert("1차 입찰금액이 등록되었습니다.");
      }

      // 데이터 갱신 이벤트 발생
      if (typeof window.dispatchEvent === "function") {
        window.dispatchEvent(
          new CustomEvent("bidSuccess", { detail: { itemId, type: "live" } })
        );
      }
    } catch (error) {
      alert(`입찰 신청 중 오류가 발생했습니다: ${error.message}`);
    }
  }

  /**
   * 직접 경매 입찰 제출 처리
   * @param {string} value - 입찰 금액
   * @param {string} itemId - 상품 ID
   * @returns {Promise<void>}
   */
  async function handleDirectBidSubmit(value, itemId) {
    if (!_state.isAuthenticated) {
      alert("입찰하려면 로그인이 필요합니다.");
      return;
    }

    if (!value) {
      alert("입찰 금액을 입력해주세요.");
      return;
    }

    const numericValue = parseFloat(value) * 1000; // 1000 곱하기
    const item = _state.currentData.find((item) => item.item_id === itemId);

    try {
      await API.fetchAPI("/direct-bids", {
        method: "POST",
        body: JSON.stringify({
          itemId,
          currentPrice: numericValue,
        }),
      });

      alert("입찰 금액이 등록되었습니다.");

      // 데이터 갱신 이벤트 발생
      if (typeof window.dispatchEvent === "function") {
        window.dispatchEvent(
          new CustomEvent("bidSuccess", { detail: { itemId, type: "direct" } })
        );
      }
    } catch (error) {
      alert(`입찰 신청 중 오류가 발생했습니다: ${error.message}`);
    }
  }

  /**
   * 빠른 입찰 금액 추가
   * @param {string} itemId - 상품 ID
   * @param {number} amount - 추가할 금액 (천원 단위)
   * @param {string} bidType - 경매 유형 ('live' 또는 'direct')
   */
  function quickAddBid(itemId, amount, bidType) {
    // 이벤트 버블링과 기본 동작 방지
    if (event) {
      event.stopPropagation();
      event.preventDefault();
    }

    const item = _state.currentData.find((item) => item.item_id === itemId);
    if (!item) return;

    const inputElement = document.querySelector(
      `.bid-input[data-item-id="${itemId}"][data-bid-type="${bidType}"]`
    );
    if (!inputElement) return;

    // 현재 input 값을 가져오기
    let currentValue = parseFloat(inputElement.value) || 0;

    // 값이 없으면 시작가를 기준으로 설정
    if (currentValue === 0) {
      currentValue = parseFloat(item.starting_price) / 1000 || 0;
    }

    // 새 값 설정 (1000으로 나눈 값을 표시)
    const newValue = currentValue + amount;
    inputElement.value = newValue;

    // 가격 표시 업데이트
    updateBidValueDisplay(inputElement);

    // 가격 상세 정보 업데이트 이벤트 발생
    inputElement.dispatchEvent(new Event("input"));
  }

  /**
   * 현장 경매 입찰 정보 HTML
   * @param {object} bidInfo - 입찰 정보 객체
   * @param {object} item - 상품 정보 객체
   * @returns {string} 입찰 정보 HTML
   */
  function getLiveBidInfoHTML(bidInfo, item) {
    if (!bidInfo) return "";

    let html = "";

    // 1차 입찰 정보
    if (bidInfo.first_price) {
      html += `
          <div class="bid-price-info">
            <span class="price-label">1차 입찰금액</span>
            <span class="price-value">${cleanNumberFormat(
              bidInfo.first_price
            )}￥</span>
            <span class="price-detail">관부가세 포함 ${cleanNumberFormat(
              calculateTotalPrice(
                bidInfo.first_price,
                item.auc_num,
                item.category
              )
            )}\\</span>
          </div>`;
    }

    // 최종 입찰가 정보만 표시 (2차 제안 제외)
    if (bidInfo.final_price) {
      html += `
          <div class="final-price">
            <span class="price-label">최종 입찰금액</span>
            <span class="price-value">${cleanNumberFormat(
              bidInfo.final_price
            )}￥</span>
            <span class="price-detail">관부가세 포함 ${cleanNumberFormat(
              calculateTotalPrice(
                bidInfo.final_price,
                item.auc_num,
                item.category
              )
            )}\\</span>
          </div>`;
    }

    return html;
  }

  /**
   * 직접 경매 입찰 정보 HTML
   * @param {object} bidInfo - 입찰 정보 객체
   * @param {object} item - 상품 정보 객체
   * @returns {string} 입찰 정보 HTML
   */
  function getDirectBidInfoHTML(bidInfo, item) {
    if (!bidInfo || !bidInfo.current_price) return "";

    return `
        <div class="my-bid-price">
          <span class="price-label">나의 입찰 금액</span>
          <span class="price-value">${cleanNumberFormat(
            bidInfo.current_price
          )}￥</span>
          <span class="price-detail">관부가세 포함 ${cleanNumberFormat(
            calculateTotalPrice(
              bidInfo.current_price,
              item.auc_num,
              item.category
            )
          )}\\</span>
        </div>
      `;
  }

  /**
   * 입찰 입력 UI HTML 생성
   * @param {object} bidInfo - 입찰 정보 객체
   * @param {object} item - 상품 정보 객체
   * @param {string} bidType - 경매 유형 ('live' 또는 'direct')
   * @returns {string} 입찰 입력 UI HTML
   */
  function getBidInputHTML(bidInfo, item, bidType) {
    // 최종 입찰가가 있으면 입력 UI를 표시하지 않음
    if (bidType === "live" && bidInfo?.final_price) {
      return "";
    }

    let bidInputLabel = "";
    if (bidType === "live") {
      bidInputLabel = bidInfo?.first_price
        ? "최종입찰 금액 입력"
        : "1차금액 입력";
    }

    return `
        <div class="bid-input-container">
          ${
            bidInputLabel
              ? `<div class="bid-input-label">${bidInputLabel}</div>`
              : ""
          }
          <div class="bid-input-group">
            <input type="number" class="bid-input" data-item-id="${
              item.item_id
            }" data-bid-type="${bidType}">
            <span class="bid-value-display">000</span>
            <span class="bid-currency">￥</span>
            <button class="bid-button" onclick="event.stopPropagation(); BidManager.handle${
              bidType === "live" ? "Live" : "Direct"
            }BidSubmit(this.parentElement.querySelector('.bid-input').value, '${
      item.item_id
    }')">입찰</button>
          </div>
          <div class="price-details-container"></div>
          </div>
          <div class="quick-bid-buttons">
            <button class="quick-bid-btn" onclick="event.stopPropagation(); BidManager.quickAddBid('${
              item.item_id
            }', 1, '${bidType}')">+1,000￥</button>
            <button class="quick-bid-btn" onclick="event.stopPropagation(); BidManager.quickAddBid('${
              item.item_id
            }', 5, '${bidType}')">+5,000￥</button>
            <button class="quick-bid-btn" onclick="event.stopPropagation(); BidManager.quickAddBid('${
              item.item_id
            }', 10, '${bidType}')">+10,000￥</button>
          </div>
        </div>
      `;
  }

  /**
   * 카드에 표시할 입찰 정보 HTML 생성
   * @param {object} bidInfo - 입찰 정보 객체
   * @param {object} item - 상품 정보 객체
   * @returns {string} 입찰 정보 HTML
   */
  function getBidInfoForCard(bidInfo, item) {
    if (!bidInfo) return "";

    // 경매 타입에 따라 다른 정보 반환
    if (item.bid_type === "direct") {
      return getDirectBidInfoHTML(bidInfo, item);
    } else {
      return getLiveBidInfoHTML(bidInfo, item);
    }
  }

  /**
   * 입찰 가격 계산기 초기화
   */
  function initializePriceCalculators() {
    document.querySelectorAll(".bid-input").forEach((input) => {
      const container = input.closest(".bid-input-group").nextElementSibling;
      const itemId = input.getAttribute("data-item-id");
      const bidType = input.getAttribute("data-bid-type");
      const item = _state.currentData.find((item) => item.item_id == itemId);

      if (container && item) {
        input.addEventListener("input", function () {
          const price = parseFloat(this.value) * 1000 || 0; // 입력값에 1000 곱하기
          const totalPrice = calculateTotalPrice(
            price,
            item.auc_num,
            item.category
          );

          // 입찰 타입에 따라 다른 메시지 표시
          if (bidType === "direct") {
            container.innerHTML = price
              ? `(모든부대비용 포함 ${cleanNumberFormat(totalPrice)}원)`
              : "";
          } else {
            container.innerHTML = price
              ? `(관부가세 포함 ${cleanNumberFormat(totalPrice)}원)`
              : "";
          }

          // 입력값 표시 업데이트
          updateBidValueDisplay(this);
        });
      }
    });
  }

  /**
   * 타이머 업데이트 시작
   */
  function startTimerUpdates() {
    // 기존 타이머가 있으면 제거
    if (window.timerInterval) {
      clearInterval(window.timerInterval);
    }

    // 1초마다 타이머 업데이트
    window.timerInterval = setInterval(() => {
      document.querySelectorAll(".bid-timer").forEach((timerElement) => {
        const itemId =
          timerElement.closest(".product-card")?.dataset.itemId ||
          timerElement.closest(".modal-content")?.querySelector(".modal-title")
            ?.dataset.itemId;
        if (!itemId) return;

        const item = _state.currentData.find((item) => item.item_id === itemId);
        if (!item || !item.scheduled_date) return;

        const timer = getRemainingTime(item.scheduled_date);
        if (!timer) {
          // 타이머 종료 시 처리
          const remainingTimeEl = timerElement.querySelector(".remaining-time");
          if (remainingTimeEl) {
            remainingTimeEl.textContent = "[마감됨]";
          } else {
            timerElement.textContent = "입찰마감 [마감됨]";
          }
          timerElement.classList.remove("near-end");
          return;
        }

        // 타이머 텍스트 갱신
        const remainingTimeEl = timerElement.querySelector(".remaining-time");
        if (remainingTimeEl) {
          remainingTimeEl.textContent = `[${timer.text}]`;
        } else {
          timerElement.textContent = `입찰마감 남은시간 [${timer.text}]`;
        }

        // 마감 임박 표시
        if (timer.isNearEnd) {
          timerElement.classList.add("near-end");
        } else {
          timerElement.classList.remove("near-end");
        }
      });
    }, 1000);
  }

  /**
   * 모듈 초기화
   * @param {boolean} isAuthenticated - 인증 상태
   * @param {Array} currentData - 현재 상품 데이터
   */
  function initialize(isAuthenticated, currentData = []) {
    _state.isAuthenticated = isAuthenticated;
    _state.currentData = currentData;

    // 이벤트 리스너 등록
    window.addEventListener("bidSuccess", function (e) {
      // 입찰 성공 후 데이터 새로고침 이벤트
      // products.js에서 이 이벤트를 받아 fetchData()를 호출
    });
  }

  /**
   * 입찰 데이터 업데이트
   * @param {Array} liveBids - 현장 경매 입찰 데이터
   * @param {Array} directBids - 직접 경매 입찰 데이터
   */
  function updateBidData(liveBids, directBids) {
    _state.liveBidData = liveBids || [];
    _state.directBidData = directBids || [];
  }

  /**
   * 현재 표시 중인 상품 데이터 업데이트
   * @param {Array} data - 현재 표시 중인 상품 데이터
   */
  function updateCurrentData(data) {
    _state.currentData = data || [];
  }

  /**
   * 인증 상태 설정
   * @param {boolean} isAuthenticated - 인증 상태
   */
  function setAuthStatus(isAuthenticated) {
    _state.isAuthenticated = isAuthenticated;
  }

  // 공개 API
  return {
    // 상태 조회
    getLiveBidData: () => _state.liveBidData,
    getDirectBidData: () => _state.directBidData,

    // 초기화
    initialize,
    updateBidData,
    updateCurrentData,
    setAuthStatus,

    // 타이머 관련
    getRemainingTime,
    startTimerUpdates,

    // UI 생성 함수
    getLiveBidSectionHTML,
    getDirectBidSectionHTML,
    getLiveBidInfoHTML,
    getDirectBidInfoHTML,
    getBidInputHTML,
    getBidInfoForCard,

    // 입찰 처리 함수
    handleLiveBidSubmit,
    handleDirectBidSubmit,
    quickAddBid,

    // 기타 유틸리티
    initializePriceCalculators,
    updateBidValueDisplay,
  };
})();

// DOM 로드 완료 시 초기화
document.addEventListener("DOMContentLoaded", function () {
  // 인증 상태는 products.js에서 설정됨
  // BidManager.initialize()는 products.js에서 호출됨
});
