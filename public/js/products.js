// public/js/products.js

// 상태 관리
window.state = {
  selectedBrands: [],
  selectedCategories: [],
  selectedDates: [],
  selectedRanks: [],
  selectedAucNums: [],
  selectedAuctionTypes: [], // 경매 유형 필터
  sortBy: "scheduled_date", // 정렬 기준 필드 (기본값: 마감일)
  sortOrder: "asc", // 정렬 방향 (기본값: 오름차순)
  currentPage: 1,
  itemsPerPage: 20,
  totalItems: 0,
  totalPages: 0,
  searchTerm: "",
  wishlist: [], // [{ item_id: "123", favorite_number: 1 }, ...]
  liveBidData: [], // 현장 경매 입찰 데이터
  directBidData: [], // 직접 경매 입찰 데이터
  currentData: [],
  images: [],
  currentImageIndex: 0,
  isAuthenticated: false,
  selectedFavoriteNumbers: [], // 선택된 즐겨찾기 번호 [1, 2, 3]
  showBidItemsOnly: false, // 입찰 항목만 표시 여부
};

/**
 * 현지 수수료 계산 함수
 * @param {number} price - 상품 가격 (P291)
 * @param {number} auctionId - 플랫폼 구분 (1: ecoauc, 2: brand, 3: starbuyers)
 * @param {string} category - 상품 카테고리
 * @returns {number} 계산된 현지 수수료
 */
function calculateLocalFee(price, auctionId, category) {
  if (!price) return 0;
  price = Number(price);

  // ecoauc (auctionId: 1)
  if (auctionId == 1) {
    if (price < 10000) return 1800;
    if (price < 50000) return 2800;
    if (price < 100000) return 4800;
    if (price < 1000000) return 8800;
    return 10800;
  }

  // brand auction (auctionId: 2)
  if (auctionId == 2) {
    if (price < 100000) {
      return Math.round(price * 0.11 + 1990);
    }
    return Math.round(price * 0.077 + 1990);
  }

  // starbuyers (auctionId: 3)
  if (auctionId == 3) {
    // 1. 기본 수수료 계산
    const baseFee = price * 0.05;
    const vat = baseFee * 0.1;
    const insurance = (baseFee + vat) * 0.005;

    // 2. 카테고리별 추가 수수료
    let categoryFee = 0;
    switch (category) {
      case "가방":
        categoryFee = 2900;
        break;
      case "시계":
        categoryFee = 2700;
        break;
      case "쥬얼리":
      case "보석":
        categoryFee = 500 + price * 0.05;
        break;
      case "악세서리":
      case "의류":
        categoryFee = 2000 + price * 0.05;
        break;
    }

    // 3. 최종 수수료 (전체 합계 + 10%)
    return Math.round((baseFee + vat + insurance + categoryFee) * 1.1);
  }

  return 0;
}

/**
 * 관세 계산 함수 (부가세 제외)
 * @param {number} amountKRW - 원화 금액 (R291)
 * @param {string} category - 상품 카테고리
 * @returns {number} 계산된 관세 (부가세 제외)
 */
function calculateCustomsDuty(amountKRW, category) {
  if (!amountKRW || !category) return 0;

  // 의류/신발: 13% 관세
  if (["의류", "신발"].includes(category)) {
    return Math.round(amountKRW * 0.23);
  }

  // 그 외 카테고리 (가방/악세서리/소품/귀금속/시계 등)
  if (amountKRW <= 2000000) {
    // 200만원 이하: 8% 관세
    return Math.round(amountKRW * 0.08);
  } else if (amountKRW < 1000000000) {
    // 200만원 초과 10억 미만에 대한 복합 관세 계산
    const baseCustoms = amountKRW * 0.08; // 기본 관세 8%
    const amount = amountKRW; // 원금
    const excess = (baseCustoms + amount - 2000000) * 0.2; // 200만원 초과분에 대한 20%
    const superExcess = excess * 0.3; // 추가세에 대한 30%

    // (기본관세 + 원금 + 추가세 + 할증) * 1.1 - 원금
    return Math.round(
      (baseCustoms + amount + excess + superExcess) * 1.1 - amount
    );
  }

  return 0; // 10억 이상
}

/**
 * 최종 가격 계산 함수
 * @param {number} price - 상품 가격
 * @param {number} auctionId - 플랫폼 구분 (1: ecoauc, 2: brand, 3: starbuyers)
 * @param {string} category - 상품 카테고리
 * @returns {number} 최종 계산된 가격
 */
function calculateTotalPrice(price, auctionId, category) {
  price = parseFloat(price) || 0;

  // 1. 현지 수수료 계산
  const localFee = calculateLocalFee(price, auctionId, category);

  // 2. 원화 환산 (현지가격 + 현지수수료)
  const totalAmountKRW = (price + localFee) * API.exchangeRate;

  // 3. 관세 계산 (부가세 제외)
  const customsDuty = calculateCustomsDuty(totalAmountKRW, category);

  // 4. 서비스 수수료 5%
  const serviceFee = (totalAmountKRW + customsDuty) * 0.05;

  // 5. 최종 금액 반환 (반올림)
  return Math.round(totalAmountKRW + customsDuty + serviceFee);
}

// 남은 시간 계산 함수
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

// 입찰 섹션 HTML 생성 - 현장 경매용
function getLiveBidSectionHTML(bidInfo, itemId, aucNum, category) {
  const item = state.currentData.find((item) => item.item_id === itemId);
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
            세금, 수수료포함 ${cleanNumberFormat(
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
      <p>실시간 금액: ${cleanNumberFormat(startingPrice)} ¥</p>
      <div class="price-details-container">
        세금, 수수료포함 ${cleanNumberFormat(
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
            세금, 수수료포함 ${cleanNumberFormat(
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
            세금, 수수료포함 ${cleanNumberFormat(
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
        <span class="bid-currency">¥</span>
        <button class="bid-button" onclick="event.stopPropagation(); handleLiveBidSubmit(this.parentElement.querySelector('.bid-input').value, '${itemId}')">입찰</button>
      </div>
      <div class="price-details-container"></div>
      <div class="quick-bid-buttons">
        <button class="quick-bid-btn" onclick="event.stopPropagation(); quickAddBid('${itemId}', 1, 'live')">+1,000¥</button>
        <button class="quick-bid-btn" onclick="event.stopPropagation(); quickAddBid('${itemId}', 5, 'live')">+5,000¥</button>
        <button class="quick-bid-btn" onclick="event.stopPropagation(); quickAddBid('${itemId}', 10, 'live')">+10,000¥</button>
      </div>
    </div>
  </div>`;

  return html;
}

// 입찰 섹션 HTML 생성 - 직접 경매용
function getDirectBidSectionHTML(bidInfo, itemId, aucNum, category) {
  const item = state.currentData.find((item) => item.item_id === itemId);
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
    ${timerHTML}
    <div class="real-time-price">
      <p>실시간 금액: ${cleanNumberFormat(live_price)} ¥</p>
      <div class="price-details-container">
        세금, 수수료 포함 ${cleanNumberFormat(
          calculateTotalPrice(live_price, aucNum, category)
        )}원
      </div>
    </div>`;

  if (currentPrice > 0) {
    html += `
      <div class="bid-price-info">
        <p>나의 입찰 금액: ${cleanNumberFormat(currentPrice)} ¥</p>
        <div class="price-details-container my-price">
          세금, 수수료 포함 ${cleanNumberFormat(
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
        <span class="bid-currency">¥</span>
        <button class="bid-button" onclick="event.stopPropagation(); handleDirectBidSubmit(this.parentElement.querySelector('.bid-input').value, '${itemId}')">입찰</button>
      </div>
      <div class="price-details-container"></div>
      <div class="quick-bid-buttons">
        <button class="quick-bid-btn" onclick="event.stopPropagation(); quickAddBid('${itemId}', 1, 'direct')">+1,000¥</button>
        <button class="quick-bid-btn" onclick="event.stopPropagation(); quickAddBid('${itemId}', 5, 'direct')">+5,000¥</button>
        <button class="quick-bid-btn" onclick="event.stopPropagation(); quickAddBid('${itemId}', 10, 'direct')">+10,000¥</button>
      </div>
    </div>
  </div>`;

  return html;
}

function updateBidValueDisplay(inputElement) {
  const valueDisplay =
    inputElement.parentElement.querySelector(".bid-value-display");
  if (valueDisplay) {
    valueDisplay.textContent = "000";
  }
}

// 현장 경매 입찰 제출 처리
async function handleLiveBidSubmit(value, itemId) {
  if (!state.isAuthenticated) {
    alert("입찰하려면 로그인이 필요합니다.");
    return;
  }

  if (!value) {
    alert("입찰 금액을 입력해주세요.");
    return;
  }

  const numericValue = parseFloat(value) * 1000; // 1000 곱하기
  const item = state.currentData.find((item) => item.item_id === itemId);
  const bidInfo = state.liveBidData.find((bid) => bid.item_id === itemId);

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

    await fetchData(); // 데이터 새로고침
  } catch (error) {
    alert(`입찰 신청 중 오류가 발생했습니다: ${error.message}`);
  }
}

// 직접 경매 입찰 제출 처리
async function handleDirectBidSubmit(value, itemId) {
  if (!state.isAuthenticated) {
    alert("입찰하려면 로그인이 필요합니다.");
    return;
  }

  if (!value) {
    alert("입찰 금액을 입력해주세요.");
    return;
  }

  const numericValue = parseFloat(value) * 1000; // 1000 곱하기
  const item = state.currentData.find((item) => item.item_id === itemId);

  try {
    await API.fetchAPI("/direct-bids", {
      method: "POST",
      body: JSON.stringify({
        itemId,
        currentPrice: numericValue,
      }),
    });

    alert("입찰 금액이 등록되었습니다.");
    await fetchData(); // 데이터 새로고침
  } catch (error) {
    alert(`입찰 신청 중 오류가 발생했습니다: ${error.message}`);
  }
}

// 데이터 표시 함수
function displayData(data) {
  const dataBody = document.getElementById("dataBody");
  if (!dataBody) return;

  state.currentData = data;
  dataBody.innerHTML = "";

  if (!data || data.length === 0) {
    dataBody.innerHTML = "<p>선택한 필터에 맞는 항목이 없습니다.</p>";
    return;
  }

  data.forEach((item) => {
    const card = createProductCard(item);
    dataBody.appendChild(card);
  });

  initializePriceCalculators();
  startTimerUpdates();
}

// 타이머 업데이트 시작
function startTimerUpdates() {
  // 기존 타이머가 있으면 제거
  if (window.timerInterval) {
    clearInterval(window.timerInterval);
  }

  // 1초마다 타이머 업데이트
  window.timerInterval = setInterval(() => {
    document.querySelectorAll(".bid-timer").forEach((timerElement) => {
      const itemId = timerElement.closest(".product-card")?.dataset.itemId;
      if (!itemId) return;

      const item = state.currentData.find((item) => item.item_id === itemId);
      if (!item || !item.scheduled_date) return;

      const timer = getRemainingTime(item.scheduled_date);
      if (!timer) {
        timerElement.querySelector(".remaining-time").textContent = "[마감됨]";
        timerElement.classList.remove("near-end");
        return;
      }

      timerElement.querySelector(
        ".remaining-time"
      ).textContent = `[${timer.text}]`;

      if (timer.isNearEnd) {
        timerElement.classList.add("near-end");
      } else {
        timerElement.classList.remove("near-end");
      }
    });
  }, 1000);
}

// 제품 카드 생성
function createProductCard(item) {
  const card = createElement("div", "product-card");
  card.dataset.itemId = item.item_id;
  card.dataset.bidType = item.bid_type || "live"; // 기본값은 live

  // 위시리스트 확인 (번호별)
  const wishlistItem = state.wishlist.find((w) => w.item_id == item.item_id);
  const favoriteNumber = wishlistItem ? wishlistItem.favorite_number : null;

  // 입찰 데이터 찾기
  const liveBidInfo = state.liveBidData.find((b) => b.item_id == item.item_id);
  const directBidInfo = state.directBidData.find(
    (b) => b.item_id == item.item_id
  );

  // 경매 타입에 따라 다른 템플릿 사용
  if (item.bid_type === "direct") {
    card.innerHTML = getDirectCardHTML(item, directBidInfo, favoriteNumber);
  } else {
    card.innerHTML = getLiveCardHTML(item, liveBidInfo, favoriteNumber);
  }

  card.addEventListener("click", (event) => {
    if (
      !event.target.closest(".bid-input-group") &&
      !event.target.closest(".quick-bid-buttons") &&
      !event.target.closest(".wishlist-btn") &&
      !event.target.classList.contains("bid-button") &&
      !event.target.classList.contains("quick-bid-btn")
    ) {
      showDetails(item.item_id);
    }
  });

  return card;
}

// 현장 경매 카드 HTML
function getLiveCardHTML(item, bidInfo, favoriteNumber) {
  // 타이머 정보
  const timer = getRemainingTime(item.scheduled_date);
  const isNearEnd = timer?.isNearEnd;
  const timerText = timer ? timer.text : "--:--:--";

  // 날짜 및 시간 표시
  const formattedDateTime = formatDateTime(item.scheduled_date);

  // direct이고 current_price가 starting_price보다 큰 경우에만 current_price 이외에는 starting_price 표시
  const live_price =
    item.bid_type == "direct" &&
    bidInfo?.current_price &&
    Number(bidInfo.current_price) > Number(item.starting_price)
      ? bidInfo.current_price
      : item.starting_price;

  return `
    <div class="product-header">
      <div class="product-brand">${item.brand}</div>
      <div class="product-title">${item.title}</div>
      <div class="auction-info">
      <div class="auction-number">
    ${item.auc_num}<span>번</span>
    <div class="auction-type-indicator">${
      item.bid_type === "direct" ? "직접" : "현장"
    }</div>
  </div>
      </div>
    </div>
    <div class="bid-timer ${isNearEnd ? "near-end" : ""}">
      <span class="scheduled-date">${formattedDateTime} 마감</span>
      <span class="remaining-time">[${timerText}]</span>
    </div>
    <div class="product-image-container">
      <img src="${API.validateImageUrl(item.image)}" alt="${
    item.title
  }" class="product-image">
      <div class="product-rank">${item.rank || "N"}</div>
    </div>
    
    <div class="wishlist-buttons">
  <button class="wishlist-btn ${
    favoriteNumber === 1 ? "active" : ""
  }" data-favorite="1" 
          onclick="event.stopPropagation(); toggleWishlist('${
            item.item_id
          }', 1)">
    즐겨찾기①
  </button>
  <button class="wishlist-btn ${
    favoriteNumber === 2 ? "active" : ""
  }" data-favorite="2" 
          onclick="event.stopPropagation(); toggleWishlist('${
            item.item_id
          }', 2)">
    즐겨찾기②
  </button>
  <button class="wishlist-btn ${
    favoriteNumber === 3 ? "active" : ""
  }" data-favorite="3" 
          onclick="event.stopPropagation(); toggleWishlist('${
            item.item_id
          }', 3)">
    즐겨찾기③
  </button>
</div>
    
    <!-- 3칸 정보 -->
    <div class="product-info-grid">
  <div class="info-cell">
    <div class="info-label">랭크</div>
    <div class="info-value">${item.rank || "N"}</div>
  </div>
  <div class="info-cell">
    <div class="info-label">실시간</div>
    <div class="info-value">${cleanNumberFormat(live_price || 0)}￥</div>
    <div class="info-price-detail">
      ${cleanNumberFormat(
        calculateTotalPrice(live_price, item.auc_num, item.category)
      )}원
    </div>
  </div>
  <div class="info-cell">
    <div class="info-label">${
      item.bid_type === "direct" ? "나의 입찰" : "2차 제안"
    }</div>
    <div class="info-value">${
      item.bid_type === "direct" && bidInfo?.current_price
        ? cleanNumberFormat(bidInfo.current_price) + "￥"
        : item.bid_type === "live" && bidInfo?.second_price
        ? cleanNumberFormat(bidInfo.second_price) + "￥"
        : "-"
    }</div>
    <div class="info-price-detail">
      ${
        item.bid_type === "direct" && bidInfo?.current_price
          ? cleanNumberFormat(
              calculateTotalPrice(
                bidInfo.current_price,
                item.auc_num,
                item.category
              )
            ) + "원"
          : item.bid_type === "live" && bidInfo?.second_price
          ? cleanNumberFormat(
              calculateTotalPrice(
                bidInfo.second_price,
                item.auc_num,
                item.category
              )
            ) + "원"
          : ""
      }
    </div>
  </div>
</div>
</div>
    <div class="bid-section">
      <div class="price-info">
        ${getBidInfoHTML(bidInfo, item)}
      </div>
      ${getBidInputHTML(bidInfo, item, "live")}
    </div>
  `;
}

// getBidInfoHTML 함수 수정
function getBidInfoHTML(bidInfo, item) {
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
        <span class="price-detail">세금, 수수료포함 ${cleanNumberFormat(
          calculateTotalPrice(bidInfo.first_price, item.auc_num, item.category)
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
        <span class="price-detail">세금, 수수료포함 ${cleanNumberFormat(
          calculateTotalPrice(bidInfo.final_price, item.auc_num, item.category)
        )}\\</span>
      </div>`;
  }

  return html;
}

function getDirectBidInfoHTML(bidInfo, item) {
  if (!bidInfo || !bidInfo.current_price) return "";

  return `
    <div class="my-bid-price">
      <span class="price-label">나의 입찰 금액</span>
      <span class="price-value">${cleanNumberFormat(
        bidInfo.current_price
      )}￥</span>
      <span class="price-detail">세금, 수수료포함 ${cleanNumberFormat(
        calculateTotalPrice(bidInfo.current_price, item.auc_num, item.category)
      )}\\</span>
    </div>
  `;
}

function quickAddBid(itemId, amount, bidType) {
  // 이벤트 버블링과 기본 동작 방지
  if (event) {
    event.stopPropagation();
    event.preventDefault();
  }

  const item = state.currentData.find((item) => item.item_id === itemId);
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

// 직접 경매 카드 HTML
function getDirectCardHTML(item, bidInfo, favoriteNumber) {
  // 타이머 정보
  const timer = getRemainingTime(item.scheduled_date);
  const isNearEnd = timer?.isNearEnd;
  const timerText = timer ? timer.text : "--:--:--";

  // 날짜 및 시간 표시
  const formattedDateTime = formatDateTime(item.scheduled_date);

  const live_price =
    item.bid_type == "direct" &&
    bidInfo?.current_price &&
    Number(bidInfo.current_price) > Number(item.starting_price)
      ? bidInfo.current_price
      : item.starting_price;

  return `
    <div class="product-header">
      <div class="product-brand">${item.brand}</div>
      <div class="product-title">${item.title}</div>
      <div class="auction-info">
        <div class="auction-number">
    ${item.auc_num}<span>번</span>
    <div class="auction-type-indicator">${
      item.bid_type === "direct" ? "직접" : "현장"
    }</div>
  </div>
      </div>
    </div>
    <div class="bid-timer ${isNearEnd ? "near-end" : ""}">
      <span class="scheduled-date">${formattedDateTime} 마감</span>
      <span class="remaining-time">[${timerText}]</span>
    </div>
    <div class="product-image-container">
      <img src="${API.validateImageUrl(item.image)}" alt="${
    item.title
  }" class="product-image">
      <div class="product-rank">${item.rank || "N"}</div>
    </div>
    <div class="wishlist-buttons">
  <button class="wishlist-btn ${
    favoriteNumber === 1 ? "active" : ""
  }" data-favorite="1" 
          onclick="event.stopPropagation(); toggleWishlist('${
            item.item_id
          }', 1)">
    즐겨찾기①
  </button>
  <button class="wishlist-btn ${
    favoriteNumber === 2 ? "active" : ""
  }" data-favorite="2" 
          onclick="event.stopPropagation(); toggleWishlist('${
            item.item_id
          }', 2)">
    즐겨찾기②
  </button>
  <button class="wishlist-btn ${
    favoriteNumber === 3 ? "active" : ""
  }" data-favorite="3" 
          onclick="event.stopPropagation(); toggleWishlist('${
            item.item_id
          }', 3)">
    즐겨찾기③
  </button>
</div>
    
    <!-- 3칸 정보 -->
    <div class="product-info-grid">
  <div class="info-cell">
    <div class="info-label">랭크</div>
    <div class="info-value">${item.rank || "N"}</div>
  </div>
  <div class="info-cell">
    <div class="info-label">실시간</div>
    <div class="info-value">${cleanNumberFormat(live_price || 0)}￥</div>
    <div class="info-price-detail">
      ${cleanNumberFormat(
        calculateTotalPrice(live_price, item.auc_num, item.category)
      )}원
    </div>
  </div>
  <div class="info-cell">
    <div class="info-label">${
      item.bid_type === "direct" ? "나의 입찰" : "2차 제안"
    }</div>
    <div class="info-value">${
      item.bid_type === "direct" && bidInfo?.current_price
        ? cleanNumberFormat(bidInfo.current_price) + "￥"
        : item.bid_type === "live" && bidInfo?.second_price
        ? cleanNumberFormat(bidInfo.second_price) + "￥"
        : "-"
    }</div>
    <div class="info-price-detail">
      ${
        item.bid_type === "direct" && bidInfo?.current_price
          ? cleanNumberFormat(
              calculateTotalPrice(
                bidInfo.current_price,
                item.auc_num,
                item.category
              )
            ) + "원"
          : item.bid_type === "live" && bidInfo?.second_price
          ? cleanNumberFormat(
              calculateTotalPrice(
                bidInfo.second_price,
                item.auc_num,
                item.category
              )
            ) + "원"
          : ""
      }
    </div>
  </div>
</div>
    
    <div class="bid-section">
      <div class="price-info">
        <div class="real-time-price">
          <span class="price-label">실시간 금액</span>
          <span class="price-value">${cleanNumberFormat(
            live_price || 0
          )}￥</span>
          <span class="price-detail">세금, 수수료 포함 ${cleanNumberFormat(
            calculateTotalPrice(live_price, item.auc_num, item.category)
          )}\\</span>
        </div>
        ${getDirectBidInfoHTML(bidInfo, item)}
      </div>
      ${getBidInputHTML(bidInfo, item, "direct")}
    </div>
  `;
}

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
        <button class="bid-button" onclick="event.stopPropagation(); handle${
          bidType === "live" ? "Live" : "Direct"
        }BidSubmit(this.parentElement.querySelector('.bid-input').value, '${
    item.item_id
  }')">입찰</button>
      </div>
      <div class="price-details-container"></div>
      </div>
      <div class="quick-bid-buttons">
        <button class="quick-bid-btn" onclick="event.stopPropagation(); quickAddBid('${
          item.item_id
        }', 1, '${bidType}')">+1,000￥</button>
        <button class="quick-bid-btn" onclick="event.stopPropagation(); quickAddBid('${
          item.item_id
        }', 5, '${bidType}')">+5,000￥</button>
        <button class="quick-bid-btn" onclick="event.stopPropagation(); quickAddBid('${
          item.item_id
        }', 10, '${bidType}')">+10,000￥</button>
      </div>
    </div>
  `;
}

// 인증 관련 함수들
async function checkAuthStatus() {
  try {
    const response = await API.fetchAPI("/auth/user");
    state.isAuthenticated = !!response.user;
    updateAuthUI();
  } catch (error) {
    state.isAuthenticated = false;
    updateAuthUI();
  }
}

function updateAuthUI() {
  const signinBtn = document.getElementById("signinBtn");
  const signoutBtn = document.getElementById("signoutBtn");

  if (!signinBtn || !signoutBtn) return;

  if (state.isAuthenticated) {
    signinBtn.style.display = "none";
    signoutBtn.style.display = "inline-block";
  } else {
    signinBtn.style.display = "inline-block";
    signoutBtn.style.display = "none";
  }
}

// 위시리스트 관련 함수
async function toggleWishlist(itemId, favoriteNumber) {
  if (!state.isAuthenticated) {
    alert("위시리스트 기능을 사용하려면 로그인이 필요합니다.");
    return;
  }

  try {
    const existingItem = state.wishlist.find(
      (w) => w.item_id === itemId && w.favorite_number === favoriteNumber
    );

    if (existingItem) {
      // 삭제
      await API.fetchAPI("/wishlist", {
        method: "DELETE",
        body: JSON.stringify({
          itemId: itemId.toString(),
          favoriteNumber,
        }),
      });

      // 상태 업데이트
      state.wishlist = state.wishlist.filter(
        (w) => w.item_id !== itemId || w.favorite_number !== favoriteNumber
      );
    } else {
      // 추가
      await API.fetchAPI("/wishlist", {
        method: "POST",
        body: JSON.stringify({
          itemId: itemId.toString(),
          favoriteNumber,
        }),
      });

      // 같은 아이템의 같은 번호가 있으면 제거 (중복 방지)
      state.wishlist = state.wishlist.filter(
        (w) => w.item_id !== itemId || w.favorite_number !== favoriteNumber
      );

      // 새 항목 추가
      state.wishlist.push({
        item_id: itemId,
        favorite_number: favoriteNumber,
      });
    }

    updateWishlistUI(itemId);
  } catch (error) {
    alert(`위시리스트 업데이트 중 오류가 발생했습니다: ${error.message}`);
  }
}

// 데이터 가져오기
async function fetchData() {
  toggleLoading(true);
  try {
    const params = {
      page: state.currentPage,
      limit: state.itemsPerPage,
      brands: state.selectedBrands,
      categories: state.selectedCategories,
      scheduledDates: state.selectedDates.map((date) =>
        date === "NO_DATE" ? "null" : date
      ),
      search: state.searchTerm,
      ranks: state.selectedRanks,
      favoriteNumbers:
        state.selectedFavoriteNumbers.length > 0
          ? state.selectedFavoriteNumbers.join(",")
          : undefined,
      auctionTypes:
        state.selectedAuctionTypes.length > 0
          ? state.selectedAuctionTypes.join(",")
          : undefined,
      aucNums: state.selectedAucNums.join(","),
      withDetails: "false",
      bidsOnly: state.showBidItemsOnly, // 파라미터 수정
      sortBy: state.sortBy, // 정렬 기준 필드 추가
      sortOrder: state.sortOrder, // 정렬 방향 추가
    };

    const queryString = API.createURLParams(params);
    const data = await API.fetchAPI(`/data?${queryString}`);

    // 위시리스트 정보 추출
    state.wishlist = data.wishlist.map((w) => ({
      item_id: w.item_id,
      favorite_number: w.favorite_number,
    }));

    state.totalItems = data.totalItems;
    state.totalPages = data.totalPages;

    // 입찰 데이터 분리
    state.liveBidData = [];
    state.directBidData = [];

    // 각 아이템에 입찰 정보 추가
    data.data.forEach((item) => {
      if (item.bids) {
        if (item.bids.live) {
          state.liveBidData.push(item.bids.live);
        }
        if (item.bids.direct) {
          state.directBidData.push(item.bids.direct);
        }
      }
    });

    displayData(data.data);
    createPagination(state.currentPage, state.totalPages, handlePageChange);
  } catch (error) {
    console.error("데이터를 불러오는 데 실패했습니다:", error);
    alert("데이터를 불러오는 데 실패했습니다.");
  } finally {
    toggleLoading(false);
  }
}

function handleSortOptionChange() {
  const sortOption = document.getElementById("sortOption");
  if (!sortOption) return;

  sortOption.addEventListener("change", function () {
    const [sortBy, sortOrder] = this.value.split("-");
    state.sortBy = sortBy;
    state.sortOrder = sortOrder;
    state.currentPage = 1; // Reset to first page when sorting changes
    fetchData();
  });
}

function initializeSortOptions() {
  const sortOption = document.getElementById("sortOption");
  if (!sortOption) return;

  // Set the default value
  sortOption.value = `${state.sortBy}-${state.sortOrder}`;
}

// 이벤트 핸들러들
function handlePageChange(page) {
  state.currentPage = page;
  fetchData();
}

function handleSearch() {
  const searchInput = document.getElementById("searchInput");
  state.searchTerm = searchInput.value;
  state.currentPage = 1;
  fetchData();
}

async function handleSignout() {
  try {
    await API.fetchAPI("/auth/logout", { method: "POST" });
    state.isAuthenticated = false;
    location.reload();
  } catch (error) {
    alert("로그아웃 중 오류가 발생했습니다.");
  }
}

function initializePriceCalculators() {
  document.querySelectorAll(".bid-input").forEach((input) => {
    const container = input.closest(".bid-input-group").nextElementSibling;
    const itemId = input.getAttribute("data-item-id");
    const bidType = input.getAttribute("data-bid-type");
    const item = state.currentData.find((item) => item.item_id == itemId);

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
            ? `(세금, 수수료포함 ${cleanNumberFormat(totalPrice)}원)`
            : "";
        }
      });
    }
  });
}

// 상세 정보 표시
async function showDetails(itemId) {
  const modalManager = setupModal("detailModal");
  if (!modalManager) return;

  const item = state.currentData.find((data) => data.item_id == itemId);
  if (!item) return;

  // 기본 정보로 모달 초기화
  initializeModal(item);
  modalManager.show();

  // 로딩 표시
  showLoadingInModal();

  try {
    // 상세 정보 가져오기
    const updatedItem = await API.fetchAPI(`/detail/item-details/${itemId}`, {
      method: "POST",
    });

    // 상세 정보 업데이트
    updateModalWithDetails(updatedItem);

    // 추가 이미지가 있다면 업데이트
    if (updatedItem.additional_images) {
      initializeImages(JSON.parse(updatedItem.additional_images));
    }
  } catch (error) {
    console.error("Failed to fetch item details:", error);
  } finally {
    hideLoadingInModal();
  }
}

function initializeModal(item) {
  document.querySelector(".modal-brand").textContent = item.brand;
  document.querySelector(".modal-title").textContent = item.title;
  document.querySelector(".main-image").src = API.validateImageUrl(item.image);
  document.querySelector(".modal-description").textContent = "로딩 중...";
  document.querySelector(".modal-category").textContent =
    item.category || "로딩 중...";
  document.querySelector(".modal-brand2").textContent = item.brand;
  document.querySelector(".modal-accessory-code").textContent =
    item.accessory_code || "로딩 중...";
  document.querySelector(".modal-scheduled-date").textContent =
    formatDateTime(item.scheduled_date) || "로딩 중...";
  document.querySelector(".modal-rank").textContent = item.rank || "N";

  // 입찰 정보 초기화
  initializeBidInfo(item.item_id);

  // 이미지 초기화
  initializeImages([item.image]);
}

function updateModalWithDetails(item) {
  document.querySelector(".modal-description").textContent =
    item.description || "설명 없음";
  document.querySelector(".modal-category").textContent =
    item.category || "카테고리 없음";
  document.querySelector(".modal-accessory-code").textContent =
    item.accessory_code || "액세서리 코드 없음";
  document.querySelector(".modal-scheduled-date").textContent =
    item.scheduled_date
      ? formatDateTime(item.scheduled_date)
      : "날짜 정보 없음";
  document.querySelector(".modal-brand").textContent = item.brand;
  document.querySelector(".modal-brand2").textContent = item.brand;
  document.querySelector(".modal-title").textContent =
    item.title || "제목 없음";
  document.querySelector(".modal-rank").textContent = item.rank || "N";
}

function initializeBidInfo(itemId) {
  const item = state.currentData.find((i) => i.item_id == itemId);
  const bidSection = document.querySelector(".modal-content .bid-info-holder");

  if (!bidSection || !item) return;

  // 경매 타입에 따라 다른 입찰 섹션 표시
  if (item.bid_type === "direct") {
    const directBidInfo = state.directBidData.find((b) => b.item_id == itemId);
    bidSection.innerHTML = getDirectBidSectionHTML(
      directBidInfo,
      itemId,
      item.auc_num,
      item.category
    );
  } else {
    const liveBidInfo = state.liveBidData.find((b) => b.item_id == itemId);
    bidSection.innerHTML = getLiveBidSectionHTML(
      liveBidInfo,
      itemId,
      item.auc_num,
      item.category
    );
  }

  // 가격 계산기 초기화
  initializePriceCalculators();
}

function initializeImages(imageUrls) {
  state.images = imageUrls.filter((url) => url); // 유효한 URL만 필터링
  state.currentImageIndex = 0;

  const mainImage = document.querySelector(".main-image");
  const thumbnailContainer = document.querySelector(".thumbnail-container");

  if (!mainImage || !thumbnailContainer) return;

  // 메인 이미지 설정
  mainImage.src = API.validateImageUrl(state.images[0]);

  // 썸네일 초기화
  thumbnailContainer.innerHTML = "";
  state.images.forEach((img, index) => {
    const thumbnailWrapper = createElement("div", "thumbnail");
    thumbnailWrapper.classList.toggle("active", index === 0);

    const thumbnail = createElement("img");
    thumbnail.src = API.validateImageUrl(img);
    thumbnail.alt = `Thumbnail ${index + 1}`;
    thumbnail.loading = "lazy";

    thumbnail.addEventListener("click", () => changeMainImage(index));
    thumbnailWrapper.appendChild(thumbnail);
    thumbnailContainer.appendChild(thumbnailWrapper);
  });

  // 네비게이션 버튼 상태 업데이트
  updateNavigationButtons();
}

function changeMainImage(index) {
  if (index < 0 || index >= state.images.length) return;

  state.currentImageIndex = index;
  const mainImage = document.querySelector(".main-image");
  if (!mainImage) return;

  mainImage.src = API.validateImageUrl(state.images[index]);

  // 썸네일 active 상태 업데이트
  const thumbnails = document.querySelectorAll(".thumbnail");
  thumbnails.forEach((thumb, i) => {
    thumb.classList.toggle("active", i === index);
  });

  updateNavigationButtons();
}

function updateNavigationButtons() {
  const prevBtn = document.querySelector(".image-nav.prev");
  const nextBtn = document.querySelector(".image-nav.next");

  if (!prevBtn || !nextBtn) return;

  prevBtn.disabled = state.currentImageIndex === 0;
  nextBtn.disabled = state.currentImageIndex === state.images.length - 1;
}

// 모달 로딩 관련 함수들
function showLoadingInModal() {
  const existingLoader = document.getElementById("modal-loading");
  if (existingLoader) return;

  const loadingElement = createElement("div", "modal-loading");
  loadingElement.id = "modal-loading";
  loadingElement.textContent = "상세 정보를 불러오는 중...";

  document.querySelector(".modal-content")?.appendChild(loadingElement);
}

function hideLoadingInModal() {
  document.getElementById("modal-loading")?.remove();
}

// 위시리스트 UI 업데이트
function updateWishlistUI(itemId) {
  // 카드의 위시리스트 버튼 업데이트
  const card = document.querySelector(
    `.product-card[data-item-id="${itemId}"]`
  );
  if (card) {
    const wishlistBtns = card.querySelectorAll(".wishlist-btn");

    wishlistBtns.forEach((btn) => {
      const favoriteNumber = parseInt(btn.dataset.favorite);
      const isActive = state.wishlist.some(
        (w) => w.item_id === itemId && w.favorite_number === favoriteNumber
      );

      btn.classList.toggle("active", isActive);
    });
  }
}

// 이미지 네비게이션 이벤트 리스너 설정
function setupImageNavigation() {
  document.querySelector(".prev")?.addEventListener("click", () => {
    changeMainImage(state.currentImageIndex - 1);
  });

  document.querySelector(".next")?.addEventListener("click", () => {
    changeMainImage(state.currentImageIndex + 1);
  });
}

// 필터 설정 함수
function setupFilters() {
  // 출품사 필터 설정
  document
    .getElementById("aucNumFilters")
    ?.addEventListener("change", function (e) {
      if (e.target.type === "checkbox") {
        if (e.target.checked) {
          state.selectedAucNums.push(e.target.value);
        } else {
          const index = state.selectedAucNums.indexOf(e.target.value);
          if (index > -1) state.selectedAucNums.splice(index, 1);
        }
      }
    });

  // 경매 유형 필터 설정
  document
    .getElementById("auctionTypeFilters")
    ?.addEventListener("change", function (e) {
      if (e.target.type === "checkbox") {
        if (e.target.checked) {
          state.selectedAuctionTypes.push(e.target.value);
        } else {
          const index = state.selectedAuctionTypes.indexOf(e.target.value);
          if (index > -1) state.selectedAuctionTypes.splice(index, 1);
        }
      }
    });

  // 즐겨찾기 필터 설정
  document
    .getElementById("favoriteFilters")
    ?.addEventListener("change", function (e) {
      if (e.target.type === "checkbox") {
        const favoriteNum = parseInt(e.target.value);
        if (e.target.checked) {
          if (!state.selectedFavoriteNumbers.includes(favoriteNum)) {
            state.selectedFavoriteNumbers.push(favoriteNum);
          }
        } else {
          state.selectedFavoriteNumbers = state.selectedFavoriteNumbers.filter(
            (num) => num !== favoriteNum
          );
        }
      }
    });

  // 입찰항목만 표기 체크박스
  document
    .getElementById("bid-items-only")
    ?.addEventListener("change", function () {
      state.showBidItemsOnly = this.checked;
    });

  // 필터 적용 버튼
  document
    .getElementById("applyFiltersBtn")
    ?.addEventListener("click", function () {
      state.currentPage = 1;
      fetchData();
    });

  // 필터 리셋 버튼
  document
    .getElementById("resetFiltersBtn")
    ?.addEventListener("click", function () {
      state.selectedBrands = [];
      state.selectedCategories = [];
      state.selectedDates = [];
      state.selectedRanks = [];
      state.selectedAucNums = [];
      state.selectedAuctionTypes = [];
      state.selectedFavoriteNumbers = [];
      state.showBidItemsOnly = false;

      // 체크박스 초기화
      document
        .querySelectorAll('.filter-options input[type="checkbox"]')
        .forEach((checkbox) => (checkbox.checked = false));

      // 입찰항목만 표기 체크박스 초기화
      document.getElementById("bid-items-only").checked = false;

      document
        .querySelectorAll("#brandCheckboxes input[type='checkbox']")
        .forEach((checkbox) => {
          checkbox.checked = false;
        });

      document
        .querySelectorAll("#categoryCheckboxes input[type='checkbox']")
        .forEach((checkbox) => {
          checkbox.checked = false;
        });

      // 선택된 항목 수 업데이트
      updateSelectedCount("brand");
      updateSelectedCount("category");

      // 데이터 다시 가져오기
      state.currentPage = 1;
      fetchData();
    });

  // 표시 개수 변경
  document
    .getElementById("itemsPerPage")
    ?.addEventListener("change", function () {
      state.itemsPerPage = parseInt(this.value);
      state.currentPage = 1;
      fetchData();
    });

  // 뷰 타입 변경
  document
    .getElementById("cardViewBtn")
    ?.addEventListener("click", function () {
      document.getElementById("listViewBtn").classList.remove("active");
      this.classList.add("active");
      document.getElementById("dataBody").classList.remove("list-view");
    });

  document
    .getElementById("listViewBtn")
    ?.addEventListener("click", function () {
      document.getElementById("cardViewBtn").classList.remove("active");
      this.classList.add("active");
      document.getElementById("dataBody").classList.add("list-view");
    });

  // 상단 메뉴 버튼들
  document
    .getElementById("allProductsBtn")
    ?.addEventListener("click", function () {
      state.selectedAuctionTypes = [];
      updateFilterUI();
      fetchData();
    });

  document
    .getElementById("liveAuctionBtn")
    ?.addEventListener("click", function () {
      state.selectedAuctionTypes = ["live"];
      updateFilterUI();
      fetchData();
    });

  document
    .getElementById("directAuctionBtn")
    ?.addEventListener("click", function () {
      state.selectedAuctionTypes = ["direct"];
      updateFilterUI();
      fetchData();
    });
}

function updateFilterUI() {
  // 경매 타입 체크박스 업데이트
  const liveCheckbox = document.getElementById("auction-type-live");
  const directCheckbox = document.getElementById("auction-type-direct");

  if (liveCheckbox) {
    liveCheckbox.checked = state.selectedAuctionTypes.includes("live");
  }

  if (directCheckbox) {
    directCheckbox.checked = state.selectedAuctionTypes.includes("direct");
  }
}

function setupItemsPerPage() {
  const itemsPerPage = document.getElementById("itemsPerPage");
  if (itemsPerPage) {
    // 기존 옵션 제거
    itemsPerPage.innerHTML = "";

    // 새 옵션 추가
    const options = [
      { value: 20, text: "20개씩 보기" },
      { value: 50, text: "50개씩 보기" },
      { value: 100, text: "100개씩 보기" },
    ];

    options.forEach((option) => {
      const optionElement = document.createElement("option");
      optionElement.value = option.value;
      optionElement.textContent = option.text;
      itemsPerPage.appendChild(optionElement);
    });

    // 기본값 설정
    itemsPerPage.value = state.itemsPerPage;
  }
}

function updateBidsOnlyFilter() {
  const bidsOnlyCheckbox = document.getElementById("bid-items-only");
  if (bidsOnlyCheckbox) {
    bidsOnlyCheckbox.addEventListener("change", function () {
      state.showBidItemsOnly = this.checked;
    });
  }
}

// 드롭다운 메뉴 설정
function setupDropdownMenus() {
  // 상품 리스트 드롭다운
  const productListBtn = document.getElementById("productListBtn");
  if (productListBtn) {
    const productListDropdown = document.createElement("div");
    productListDropdown.className = "dropdown-content";
    productListDropdown.innerHTML = `
      <a href="#" data-type="all">전체 상품</a>
      <a href="#" data-type="live">현장 경매</a>
      <a href="#" data-type="direct">직접 경매</a>
    `;

    productListBtn.parentNode.style.position = "relative";
    productListBtn.parentNode.appendChild(productListDropdown);

    productListBtn.addEventListener("click", function (e) {
      e.preventDefault();
      e.stopPropagation(); // 이벤트 전파 중지
      productListDropdown.classList.toggle("active");
    });

    // 드롭다운 아이템 클릭 이벤트
    productListDropdown.addEventListener("click", function (e) {
      if (e.target.tagName === "A") {
        e.preventDefault();
        e.stopPropagation(); // 이벤트 전파 중지
        const type = e.target.dataset.type;

        if (type === "all") {
          state.selectedAuctionTypes = [];
        } else {
          state.selectedAuctionTypes = [type];
        }

        updateFilterUI();
        fetchData();
        productListDropdown.classList.remove("active");
      }
    });

    // 다른 곳 클릭 시 드롭다운 닫기
    document.addEventListener("click", function (e) {
      if (!productListBtn.contains(e.target)) {
        productListDropdown.classList.remove("active");
      }
    });
  }

  // 즐겨찾기 드롭다운
  const favoritesBtn = document.getElementById("favoritesBtn");
  if (favoritesBtn) {
    const favoritesDropdown = document.createElement("div");
    favoritesDropdown.className = "dropdown-content";
    favoritesDropdown.innerHTML = `
      <a href="#" data-favorite="1">즐겨찾기 ①</a>
      <a href="#" data-favorite="2">즐겨찾기 ②</a>
      <a href="#" data-favorite="3">즐겨찾기 ③</a>
    `;

    favoritesBtn.parentNode.style.position = "relative";
    favoritesBtn.parentNode.appendChild(favoritesDropdown);

    favoritesBtn.addEventListener("click", function (e) {
      e.preventDefault();
      e.stopPropagation(); // 이벤트 전파 중지
      favoritesDropdown.classList.toggle("active");
    });

    // 드롭다운 아이템 클릭 이벤트
    favoritesDropdown.addEventListener("click", function (e) {
      if (e.target.tagName === "A") {
        e.preventDefault();
        e.stopPropagation(); // 이벤트 전파 중지
        const favoriteNum = parseInt(e.target.dataset.favorite);

        state.selectedFavoriteNumbers = [favoriteNum];
        updateFilterUI();
        fetchData();
        favoritesDropdown.classList.remove("active");
      }
    });

    // 다른 곳 클릭 시 드롭다운 닫기
    document.addEventListener("click", function (e) {
      if (!favoritesBtn.contains(e.target)) {
        favoritesDropdown.classList.remove("active");
      }
    });
  }
}

// 초기화 함수
function initialize() {
  state.itemsPerPage = 20; // 기본 20개씩 표시
  state.sortBy = "scheduled_date"; // 기본 정렬 필드: 마감일
  state.sortOrder = "asc"; // 기본 정렬 방향: 오름차순

  // DOM 완전히 로드된 후 실행
  document.addEventListener("DOMContentLoaded", function () {
    // 드롭다운 메뉴 설정
    setupDropdownMenus();
  });

  window.addEventListener("load", function () {
    // 기존 초기화 함수 호출
    API.initialize()
      .then(() => checkAuthStatus())
      .then(() => {
        // 필터 데이터 가져오기
        return Promise.all([
          API.fetchAPI("/data/brands-with-count"),
          API.fetchAPI("/data/categories"),
          API.fetchAPI("/data/scheduled-dates-with-count"),
          API.fetchAPI("/data/ranks"),
          API.fetchAPI("/data/auc-nums"),
          API.fetchAPI("/data/auction-types"),
        ]);
      })
      .then(
        ([
          brandsResponse,
          categoriesResponse,
          datesResponse,
          ranksResponse,
          aucNumsResponse,
          auctionTypesResponse,
        ]) => {
          // 필터 표시
          displayFilters(
            brandsResponse,
            categoriesResponse,
            datesResponse,
            ranksResponse,
            aucNumsResponse
          );
          displayFavoriteFilters(); // 즐겨찾기 필터 초기화
          setupItemsPerPage(); // 표시 개수 설정
          updateBidsOnlyFilter(); // 입찰항목만 표시 파라미터 수정
          initializeSortOptions(); // 정렬 옵션 초기화
          handleSortOptionChange(); // 정렬 변경 이벤트 리스너 설정

          // 필터 설정
          setupFilters();

          // 이벤트 리스너 설정
          document
            .getElementById("searchButton")
            ?.addEventListener("click", handleSearch);
          document
            .getElementById("searchInput")
            ?.addEventListener("keypress", (e) => {
              if (e.key === "Enter") handleSearch();
            });

          document
            .getElementById("applyFiltersBtn")
            ?.addEventListener("click", () => {
              state.currentPage = 1;
              fetchData();
            });

          document
            .getElementById("signinBtn")
            ?.addEventListener("click", () => {
              window.location.href = "./pages/signin.html";
            });

          document
            .getElementById("signoutBtn")
            ?.addEventListener("click", handleSignout);

          // 이미지 네비게이션 설정
          setupImageNavigation();

          // 공지사항 버튼 이벤트
          document
            .getElementById("showNoticesBtn")
            ?.addEventListener("click", showNoticeSection);

          // 초기 데이터 로드
          fetchData();
        }
      )
      .catch((error) => {
        console.error("Error initializing:", error);
        alert("초기화 중 오류가 발생했습니다.");
      });
  });
}

// 페이지 로드 시 초기화 실행
initialize();
