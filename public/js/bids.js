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
   * 남은 시간 계산 함수 (수정됨)
   * @param {string} scheduledDate - 마감 날짜/시간
   * @param {string} bidStage - 입찰 단계 ('first' 또는 'final')
   * @returns {object|null} 남은 시간 정보 객체 또는 null
   */
  function getRemainingTime(scheduledDate, bidStage = "first") {
    if (!scheduledDate) return null;

    const now = new Date();
    let endDate = new Date(scheduledDate);

    // 최종 입찰의 경우 scheduled_date 당일 저녁 10시까지
    if (bidStage === "final") {
      endDate.setHours(22, 0, 0, 0); // 22:00:00.000
    }

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
   * 경매장별 입찰 옵션 정보 가져오기
   * @param {string} itemId - 상품 ID
   * @param {number} auctionNum - 경매장 번호
   * @param {number} currentPrice - 현재 가격
   * @returns {Promise<Object>} 입찰 옵션 정보
   */
  async function getBidOptions(itemId, auctionNum, currentPrice) {
    try {
      const response = await API.fetchAPI(`/direct-bids/bid-options/${itemId}`);
      return response;
    } catch (error) {
      console.error("입찰 옵션 정보를 가져오는데 실패했습니다:", error);
      return null;
    }
  }

  /**
   * 브랜드옥션 입찰가 검증
   * @param {number} bidPrice - 입찰 가격 (실제 엔화)
   * @param {boolean} isFirstBid - 첫 입찰 여부
   * @returns {Object} 검증 결과
   */
  function validateBrandAuctionBid(bidPrice, isFirstBid) {
    if (isFirstBid) {
      if (bidPrice % 1000 !== 0) {
        return {
          valid: false,
          message: "첫 입찰은 1,000엔 단위로만 가능합니다.",
        };
      }
    } else {
      if (bidPrice % 500 !== 0) {
        return {
          valid: false,
          message: "이후 입찰은 500엔 단위로만 가능합니다.",
        };
      }
    }
    return { valid: true };
  }

  /**
   * 경매장별 빠른 입찰 버튼 HTML 생성
   * @param {string} itemId - 상품 ID
   * @param {number} auctionNum - 경매장 번호
   * @param {string} bidType - 입찰 타입
   * @param {boolean} isExpired - 마감 여부
   * @param {boolean} isFirstBid - 첫 입찰 여부 (브랜드옥션용)
   * @returns {string} 빠른 입찰 버튼 HTML
   */
  function getQuickBidButtonsHTML(
    itemId,
    auctionNum,
    bidType,
    isExpired,
    isFirstBid = false
  ) {
    if (isExpired) {
      return `<div class="quick-bid-buttons">
        <button class="quick-bid-btn" disabled>마감됨</button>
      </div>`;
    }

    switch (auctionNum) {
      case 1: // 에코옥션 - 기존 1000원 단위
        return `<div class="quick-bid-buttons">
          <button class="quick-bid-btn" onclick="event.stopPropagation(); BidManager.quickAddBid('${itemId}', 1, '${bidType}')">+1,000¥</button>
          <button class="quick-bid-btn" onclick="event.stopPropagation(); BidManager.quickAddBid('${itemId}', 5, '${bidType}')">+5,000¥</button>
          <button class="quick-bid-btn" onclick="event.stopPropagation(); BidManager.quickAddBid('${itemId}', 10, '${bidType}')">+10,000¥</button>
        </div>`;

      case 2: // 브랜드옥션 - 첫 입찰 1000엔 단위, 이후 500엔 단위
        const increment500Disabled = isFirstBid
          ? 'disabled title="첫 입찰은 1,000엔, 이후 입찰은 500엔 단위로 입찰 가능합니다."'
          : "";

        return `<div class="quick-bid-buttons brand-auction">
          <button class="quick-bid-btn increment-500" ${increment500Disabled} onclick="event.stopPropagation(); BidManager.quickAddBid('${itemId}', 0.5, '${bidType}')">+500¥</button>
          <button class="quick-bid-btn" onclick="event.stopPropagation(); BidManager.quickAddBid('${itemId}', 1, '${bidType}')">+1,000¥</button>
          <button class="quick-bid-btn" onclick="event.stopPropagation(); BidManager.quickAddBid('${itemId}', 2, '${bidType}')">+2,000¥</button>
          ${
            isFirstBid
              ? '<div class="bid-info-tooltip">첫 입찰은 1,000엔, 이후 입찰은 500엔 단위로 입찰 가능합니다.</div>'
              : ""
          }
        </div>`;

      case 3: // 스타옥션 - 자동 최소금액 입찰만
        return `<div class="quick-bid-buttons star-auction">
          <button class="auto-minimum-bid-btn" onclick="event.stopPropagation(); BidManager.handleStarAuctionBid('${itemId}')">최소금액 입찰</button>
        </div>`;

      default:
        return "";
    }
  }

  /**
   * 스타옥션 자동 최소금액 입찰 처리
   * @param {string} itemId - 상품 ID
   */
  async function handleStarAuctionBid(itemId) {
    if (!_state.isAuthenticated) {
      alert("입찰하려면 로그인이 필요합니다.");
      return;
    }

    // 마감 시간 확인
    const item = _state.currentData.find((item) => item.item_id === itemId);
    if (item) {
      const timer = getRemainingTime(item.scheduled_date, "first");
      if (!timer) {
        alert("마감된 상품입니다. 입찰이 불가능합니다.");
        return;
      }
    }

    try {
      // 서버에서 자동 계산된 최소금액으로 입찰
      const bidOptions = await getBidOptions(itemId, 3, item.starting_price);

      if (!bidOptions || !bidOptions.nextValidBid) {
        alert("입찰 가능한 금액을 계산할 수 없습니다.");
        return;
      }

      const autoCalculatedPrice = bidOptions.nextValidBid;

      // 직접 경매 입찰 제출
      await handleDirectBidSubmit(autoCalculatedPrice / 1000, itemId); // 1000으로 나눠서 전달 (UI 표시용)
    } catch (error) {
      alert(`자동 입찰 중 오류가 발생했습니다: ${error.message}`);
    }
  }

  /**
   * 현장 경매 입찰 섹션 HTML 생성 (전체)
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

    // 입찰 단계에 따른 마감시간 계산
    let bidStage = "first";
    let isExpired = false;
    let timer = null;
    let timerHTML = "";

    if (bidInfo?.first_price && !bidInfo?.final_price) {
      // 1차 입찰 완료, 최종 입찰 대기 중 - 저녁 10시까지
      bidStage = "final";
      timer = getRemainingTime(item.scheduled_date, "final");
      isExpired = !timer;

      timerHTML = timer
        ? `<div class="bid-timer ${timer.isNearEnd ? "near-end" : ""}">
          최종입찰마감 남은시간 [${timer.text}]
        </div>`
        : `<div class="bid-timer expired">
          최종입찰마감 [마감됨]
        </div>`;
    } else if (!bidInfo?.first_price) {
      // 1차 입찰 전 - scheduled_date까지
      timer = getRemainingTime(item.scheduled_date, "first");
      isExpired = !timer;

      timerHTML = timer
        ? `<div class="bid-timer ${timer.isNearEnd ? "near-end" : ""}">
          1차입찰마감 남은시간 [${timer.text}]
        </div>`
        : `<div class="bid-timer expired">
          1차입찰마감 [마감됨]
        </div>`;
    } else {
      // 최종 입찰 완료
      timerHTML = `<div class="bid-timer completed">
      입찰완료
    </div>`;
    }

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

    // 1차/최종 입찰 진행 중인 경우
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

    // 입찰 입력 UI - 마감 여부에 따라 버튼 상태 변경
    html += `
    <div class="bid-input-container">
      <div class="bid-input-group">
        <span class="bid-input-label">${
          bidInfo?.first_price ? "최종입찰 금액" : "1차금액 입력"
        }</span>
        <input type="number" placeholder="" class="bid-input" data-item-id="${itemId}" data-bid-type="live">
        <span class="bid-value-display">000</span>
        <span class="bid-currency">¥</span>
        <button class="bid-button" ${
          isExpired ? "disabled" : ""
        } onclick="event.stopPropagation(); ${
      isExpired
        ? ""
        : `BidManager.handleLiveBidSubmit(this.parentElement.querySelector('.bid-input').value, '${itemId}')`
    }">${isExpired ? "마감됨" : "입찰"}</button>
      </div>
      <div class="price-details-container"></div>
      ${getQuickBidButtonsHTML(itemId, aucNum, "live", isExpired)}
    </div>
  </div>`;

    return html;
  }

  /**
   * 직접 경매 입찰 섹션 HTML 생성 (전체)
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

    // 첫 입찰 여부 확인 (브랜드옥션에서 사용)
    const isFirstBid = !bidInfo || !bidInfo.current_price;

    // 나의 입찰가와 실시간 가격 비교
    const hasHigherBid =
      Number(live_price) > Number(currentPrice) && currentPrice > 0;

    // 타이머 HTML (직접 경매는 scheduled_date까지만)
    const timer = getRemainingTime(item.scheduled_date, "first");
    const isExpired = !timer; // 마감 여부 확인

    const timerHTML = timer
      ? `
      <div class="bid-timer ${timer.isNearEnd ? "near-end" : ""}">
        입찰마감 남은시간 [${timer.text}]
      </div>
    `
      : `
      <div class="bid-timer expired">
        입찰마감 [마감됨]
      </div>
    `;

    let html = `<div class="bid-info direct">
      ${
        hasHigherBid && !isExpired
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

    // 입찰 입력 UI - 마감 여부에 따라 버튼 상태 변경
    html += `
      <div class="bid-input-container">
        <div class="bid-input-group">
          <input type="number" placeholder="나의 입찰 금액" class="bid-input" data-item-id="${itemId}" data-bid-type="direct">
          <span class="bid-value-display">000</span>
          <span class="bid-currency">¥</span>
          <button class="bid-button" ${
            isExpired ? "disabled" : ""
          } onclick="event.stopPropagation(); ${
      isExpired
        ? ""
        : `BidManager.handleDirectBidSubmit(this.parentElement.querySelector('.bid-input').value, '${itemId}')`
    }">${isExpired ? "마감됨" : "입찰"}</button>
        </div>
        <div class="price-details-container"></div>
        ${getQuickBidButtonsHTML(
          itemId,
          aucNum,
          "direct",
          isExpired,
          isFirstBid
        )}
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

    // 마감 시간 확인 - 입찰 단계에 따라 다른 마감시간 적용
    const item = _state.currentData.find((item) => item.item_id === itemId);
    const bidInfo = _state.liveBidData.find((bid) => bid.item_id === itemId);

    if (item) {
      let bidStage = "first";

      // 1차 입찰이 있고 최종 입찰이 없는 경우 = 최종 입찰 단계
      if (bidInfo?.first_price && !bidInfo?.final_price) {
        bidStage = "final";
      }

      const timer = getRemainingTime(item.scheduled_date, bidStage);
      if (!timer) {
        const stageText = bidStage === "final" ? "최종입찰" : "1차입찰";
        alert(`${stageText} 마감된 상품입니다. 입찰이 불가능합니다.`);
        return;
      }
    }

    if (!value) {
      alert("입찰 금액을 입력해주세요.");
      return;
    }

    // 입찰 버튼 찾기
    const buttonElement =
      event?.target ||
      document
        .querySelector(
          `.bid-input[data-item-id="${itemId}"][data-bid-type="live"]`
        )
        ?.closest(".bid-input-group")
        ?.querySelector(".bid-button");

    // 전역 로딩 UI 사용
    if (window.bidLoadingUI && buttonElement) {
      window.bidLoadingUI.showBidLoading(buttonElement);
    }

    const numericValue = parseFloat(value) * 1000; // 1000 곱하기

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
    } finally {
      // 로딩 UI 숨기기
      if (window.bidLoadingUI && buttonElement) {
        window.bidLoadingUI.hideBidLoading(buttonElement);
      }
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

    const item = _state.currentData.find((item) => item.item_id === itemId);
    if (item) {
      const timer = getRemainingTime(item.scheduled_date, "first");
      if (!timer) {
        alert("마감된 상품입니다. 입찰이 불가능합니다.");
        return;
      }
    }

    if (!value) {
      alert("입찰 금액을 입력해주세요.");
      return;
    }

    // 입찰 버튼 찾기
    const buttonElement =
      event?.target ||
      document
        .querySelector(
          `.bid-input[data-item-id="${itemId}"][data-bid-type="direct"]`
        )
        ?.closest(".bid-input-group")
        ?.querySelector(".bid-button");

    // 전역 로딩 UI 사용
    if (window.bidLoadingUI && buttonElement) {
      window.bidLoadingUI.showBidLoading(buttonElement);
    }

    const numericValue = parseFloat(value) * 1000; // 1000 곱하기

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
    } finally {
      // 로딩 UI 숨기기
      if (window.bidLoadingUI && buttonElement) {
        window.bidLoadingUI.hideBidLoading(buttonElement);
      }
    }
  }

  /**
   * 빠른 입찰 금액 추가
   * @param {string} itemId - 상품 ID
   * @param {number} amount - 추가할 금액 (천원 단위)
   * @param {string} bidType - 경매 유형 ('live' 또는 'direct')
   */
  async function quickAddBid(itemId, amount, bidType) {
    // 이벤트 버블링과 기본 동작 방지
    if (typeof event !== "undefined" && event) {
      event.stopPropagation();
      event.preventDefault();
    }

    const item = _state.currentData.find((item) => item.item_id === itemId);
    if (!item) return;

    // 브랜드옥션(2번)에서 500엔 버튼 클릭 시 첫 입찰 여부 확인
    if (item.auc_num === 2 && amount === 0.5) {
      try {
        const bidOptions = await getBidOptions(itemId, 2, item.starting_price);
        if (bidOptions && bidOptions.isFirstBid) {
          alert("첫 입찰은 1,000엔 단위로만 가능합니다.");
          return;
        }
      } catch (error) {
        console.error("입찰 옵션 확인 실패:", error);
      }
    }

    // 클릭된 버튼의 상위 컨테이너 찾기
    let container = null;
    if (typeof event !== "undefined" && event && event.target) {
      container =
        event.target.closest(".modal-content") ||
        event.target.closest(".product-card") ||
        event.target.closest(".bid-result-item");
    }

    // 컨테이너를 찾지 못했으면 document에서 해당 itemId를 가진 모든 컨테이너 검색
    if (!container) {
      const modalContainer = document
        .querySelector(
          `.modal-content .bid-input[data-item-id="${itemId}"][data-bid-type="${bidType}"]`
        )
        ?.closest(".modal-content");
      const cardContainer = document.querySelector(
        `.product-card[data-item-id="${itemId}"]`
      );
      const resultItemContainer = document.querySelector(
        `.bid-result-item[data-item-id="${itemId}"]`
      );

      container = modalContainer || cardContainer || resultItemContainer;
    }

    if (!container) return;

    // 해당 컨테이너 내에서만 입력 요소 찾기
    const inputElement = container.querySelector(
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
    // 마감 여부 확인 - 입찰 타입에 따라 다른 로직
    let timer, isExpired;

    if (bidType === "live" && bidInfo?.first_price && !bidInfo?.final_price) {
      // 현장 경매의 최종 입찰 단계
      timer = getRemainingTime(item.scheduled_date, "final");
      isExpired = !timer;
    } else {
      // 현장 경매의 1차 입찰 또는 직접 경매
      timer = getRemainingTime(item.scheduled_date, "first");
      isExpired = !timer;
    }

    // 최종 입찰가가 있으면 입력 UI를 표시하지 않음
    if (bidType === "live" && bidInfo?.final_price) {
      return "";
    }

    // 첫 입찰 여부 확인 (브랜드옥션용)
    let isFirstBid = false;
    if (bidType === "direct") {
      isFirstBid = !bidInfo || !bidInfo.current_price;
    } else if (bidType === "live") {
      isFirstBid = !bidInfo || !bidInfo.first_price;
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
          <button class="bid-button" ${
            isExpired ? "disabled" : ""
          } onclick="event.stopPropagation(); ${
      isExpired
        ? ""
        : `BidManager.handle${
            bidType === "live" ? "Live" : "Direct"
          }BidSubmit(this.parentElement.querySelector('.bid-input').value, '${
            item.item_id
          }')`
    }">${isExpired ? "마감됨" : "입찰"}</button>
        </div>
        <div class="price-details-container"></div>
        ${getQuickBidButtonsHTML(
          item.item_id,
          item.auc_num,
          bidType,
          isExpired,
          isFirstBid
        )}
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
      // 바로 다음 형제 요소를 찾는 대신 가장 가까운 price-details-container 찾기
      const container =
        input.closest(".bid-input-group")?.nextElementSibling ||
        input
          .closest(".bid-input-container")
          ?.querySelector(".price-details-container");

      if (!container) return; // 컨테이너가 없으면 건너뛰기

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
              ? `(관부가세 포함 ${cleanNumberFormat(totalPrice)}원)`
              : "";
          } else {
            container.innerHTML = price
              ? `(관부가세 포함 ${cleanNumberFormat(totalPrice)}원)`
              : "";
          }

          // 가격 표시 업데이트
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

        // 해당 아이템의 입찰 정보 확인
        const bidInfo = _state.liveBidData.find(
          (bid) => bid.item_id === itemId
        );

        let bidStage = "first";
        let stageText = "1차입찰마감";

        // 입찰 단계 결정
        if (bidInfo?.first_price && !bidInfo?.final_price) {
          bidStage = "final";
          stageText = "최종입찰마감";
        } else if (bidInfo?.final_price) {
          // 최종 입찰 완료된 경우
          timerElement.textContent = "입찰완료";
          timerElement.className = "bid-timer completed";
          return;
        }

        const timer = getRemainingTime(item.scheduled_date, bidStage);
        if (!timer) {
          // 타이머 종료 시 처리
          const remainingTimeEl = timerElement.querySelector(".remaining-time");
          if (remainingTimeEl) {
            remainingTimeEl.textContent = "[마감됨]";
          } else {
            timerElement.textContent = `${stageText} [마감됨]`;
          }
          timerElement.classList.remove("near-end");
          timerElement.classList.add("expired");
          return;
        }

        // 타이머 텍스트 갱신
        const remainingTimeEl = timerElement.querySelector(".remaining-time");
        if (remainingTimeEl) {
          remainingTimeEl.textContent = `[${timer.text}]`;
        } else {
          timerElement.textContent = `${stageText} 남은시간 [${timer.text}]`;
        }

        // 마감 임박 표시
        if (timer.isNearEnd) {
          timerElement.classList.add("near-end");
        } else {
          timerElement.classList.remove("near-end");
        }

        timerElement.classList.remove("expired");
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
    handleStarAuctionBid,
    quickAddBid,

    // 검증 및 옵션 함수
    getBidOptions,
    validateBrandAuctionBid,
    getQuickBidButtonsHTML,

    // 기타 유틸리티
    initializePriceCalculators,
    updateBidValueDisplay,
  };
})();

/**
 * 모바일 툴팁 기능 설정
 */
function setupMobileBidTooltips() {
  // 브랜드옥션 500엔 버튼 터치 이벤트
  document.addEventListener("touchstart", function (e) {
    if (e.target.classList.contains("increment-500") && e.target.disabled) {
      // 모바일에서는 물음표 아이콘 표시
      showMobileTooltip(
        e.target,
        "첫 입찰은 1,000엔, 이후 입찰은 500엔 단위로 입찰 가능합니다."
      );
    }
  });
}

function showMobileTooltip(element, message) {
  // 기존 툴팁 제거
  const existingTooltip = document.querySelector(".mobile-tooltip");
  if (existingTooltip) {
    existingTooltip.remove();
  }

  // 새 툴팁 생성
  const tooltip = document.createElement("div");
  tooltip.className = "mobile-tooltip";
  tooltip.innerHTML = `
    <div class="tooltip-content">
      <span class="tooltip-icon">❓</span>
      <span class="tooltip-message">${message}</span>
    </div>
  `;

  // 위치 계산 및 표시
  const rect = element.getBoundingClientRect();
  tooltip.style.position = "fixed";
  tooltip.style.top = rect.top - 60 + "px";
  tooltip.style.left = rect.left + rect.width / 2 + "px";
  tooltip.style.transform = "translateX(-50%)";

  document.body.appendChild(tooltip);

  // 3초 후 자동 제거
  setTimeout(() => {
    tooltip.remove();
  }, 3000);
}

// DOM 로드 완료 시 초기화
document.addEventListener("DOMContentLoaded", function () {
  // 인증 상태는 products.js에서 설정됨
  // BidManager.initialize()는 products.js에서 호출됨

  // 모바일 툴팁 설정
  setupMobileBidTooltips();
});
