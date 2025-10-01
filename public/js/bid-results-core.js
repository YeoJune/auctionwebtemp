// public/js/bid-results-core.js

// 입찰 결과 관리 - 공통 로직
window.BidResultsCore = (function () {
  // 상수 정의
  const MINIMUM_FEE = 10000; // 최소 수수료 (₩)

  // 내부 상태
  let _pageState = null;

  /**
   * 페이지 상태 설정
   */
  function setPageState(state) {
    _pageState = state;
  }

  /**
   * 결합된 결과를 일별로 그룹화하는 함수
   */
  function groupResultsByDate() {
    if (!_pageState) {
      console.error("페이지 상태가 설정되지 않았습니다.");
      return;
    }

    const groupedByDate = {};

    _pageState.combinedResults.forEach((item) => {
      const dateStr = formatDate(item.item?.scheduled_date);

      if (!groupedByDate[dateStr]) {
        groupedByDate[dateStr] = {
          date: dateStr,
          successItems: [],
          failedItems: [],
          pendingItems: [],
          itemCount: 0,
          totalJapanesePrice: 0,
          totalKoreanPrice: 0,
        };
      }

      // 상품 상태 분류
      const bidStatus = classifyBidStatus(item);

      // 이미지 경로 처리
      let imagePath = "/images/placeholder.png";
      if (item.item && item.item.image) {
        imagePath = item.item.image;
      }

      const itemData = {
        ...item,
        finalPrice: bidStatus.finalPrice,
        winningPrice: bidStatus.winningPrice,
        image: imagePath,
        appr_id: item.appr_id, // appr_id 추가
      };

      // 상태별로 분류
      if (bidStatus.status === "success") {
        const koreanPrice = Number(
          calculateTotalPrice(
            bidStatus.winningPrice,
            item.item?.auc_num || 1,
            item.item?.category || "기타"
          )
        );
        itemData.koreanPrice = koreanPrice;

        groupedByDate[dateStr].successItems.push(itemData);
        groupedByDate[dateStr].itemCount += 1;
        groupedByDate[dateStr].totalJapanesePrice += bidStatus.winningPrice;
        groupedByDate[dateStr].totalKoreanPrice += koreanPrice;
      } else if (bidStatus.status === "failed") {
        const koreanPrice = Number(
          calculateTotalPrice(
            bidStatus.winningPrice,
            item.item?.auc_num || 1,
            item.item?.category || "기타"
          )
        );
        itemData.koreanPrice = koreanPrice;
        groupedByDate[dateStr].failedItems.push(itemData);
      } else {
        groupedByDate[dateStr].pendingItems.push(itemData);
      }
    });

    // 객체를 배열로 변환
    _pageState.dailyResults = Object.values(groupedByDate);

    // 각 날짜별 totalItemCount 계산
    _pageState.dailyResults.forEach((day) => {
      day.totalItemCount =
        day.successItems.length +
        day.failedItems.length +
        day.pendingItems.length;

      // 일별 수수료 계산 (성공한 상품만)
      const calculatedFee = calculateFee(day.totalKoreanPrice);

      // 성공한 상품이 있는 경우만 최소 수수료 적용
      if (day.itemCount > 0) {
        day.feeAmount = Math.max(calculatedFee, MINIMUM_FEE);
      } else {
        day.feeAmount = 0; // 성공한 상품이 없으면 수수료 없음
      }

      day.vatAmount = Math.round((day.feeAmount / 1.1) * 0.1);

      // 일별 감정서 수수료 계산
      let dailyAppraisalCount = 0;
      day.successItems.forEach((item) => {
        if (item.appr_id) {
          dailyAppraisalCount++;
        }
      });

      day.appraisalFee = dailyAppraisalCount * 16500;
      day.appraisalVat = Math.round(day.appraisalFee / 11);
      day.appraisalCount = dailyAppraisalCount;

      // 총액에 감정서 수수료 포함
      day.grandTotal = day.totalKoreanPrice + day.feeAmount + day.appraisalFee;
    });

    sortDailyResults();
    updateTotalStats();
  }

  /**
   * 상품 상태 분류 함수
   */
  function classifyBidStatus(item) {
    const finalPrice =
      item.type === "direct"
        ? Number(item.current_price || 0)
        : Number(item.final_price || 0);
    const winningPrice = Number(item.winning_price || 0);

    if (!item.winning_price || winningPrice === 0) {
      return { status: "pending", finalPrice, winningPrice: null };
    }

    if (finalPrice >= winningPrice) {
      return { status: "success", finalPrice, winningPrice };
    } else {
      return { status: "failed", finalPrice, winningPrice };
    }
  }

  /**
   * 일별 결과 정렬
   */
  function sortDailyResults() {
    if (!_pageState) return;

    _pageState.dailyResults.sort((a, b) => {
      let valueA, valueB;

      // 정렬 기준에 따른 값 추출
      switch (_pageState.sortBy) {
        case "date":
          valueA = new Date(a.date);
          valueB = new Date(b.date);
          break;
        case "total_price":
          valueA = a.grandTotal;
          valueB = b.grandTotal;
          break;
        case "item_count":
          valueA = a.itemCount;
          valueB = b.itemCount;
          break;
        default:
          valueA = new Date(a.date);
          valueB = new Date(b.date);
          break;
      }

      // 정렬 방향 적용
      const direction = _pageState.sortOrder === "asc" ? 1 : -1;
      return direction * (valueA - valueB);
    });

    // 필터링된 결과 업데이트
    _pageState.filteredResults = [..._pageState.dailyResults];
    _pageState.totalItems = _pageState.filteredResults.length;
    _pageState.totalPages = Math.ceil(
      _pageState.totalItems / _pageState.itemsPerPage
    );
  }

  /**
   * 총 통계 업데이트 함수
   */
  function updateTotalStats() {
    if (!_pageState) return;

    // 초기화
    _pageState.totalStats = {
      itemCount: 0,
      totalItemCount: 0,
      japaneseAmount: 0,
      koreanAmount: 0,
      feeAmount: 0,
      vatAmount: 0,
      grandTotalAmount: 0,
      appraisalFee: 0,
      appraisalVat: 0,
      appraisalCount: 0,
    };

    // 데일리 합계의 정확한 합산
    _pageState.dailyResults.forEach((day) => {
      _pageState.totalStats.itemCount += Number(day.itemCount || 0);
      _pageState.totalStats.totalItemCount += Number(day.totalItemCount || 0);
      _pageState.totalStats.japaneseAmount += Number(
        day.totalJapanesePrice || 0
      );
      _pageState.totalStats.koreanAmount += Number(day.totalKoreanPrice || 0);
      _pageState.totalStats.feeAmount += Number(day.feeAmount || 0);
      _pageState.totalStats.vatAmount += Number(day.vatAmount || 0);
      _pageState.totalStats.appraisalFee += Number(day.appraisalFee || 0);
      _pageState.totalStats.appraisalVat += Number(day.appraisalVat || 0);
      _pageState.totalStats.appraisalCount += Number(day.appraisalCount || 0);
    });

    // 총액 계산 (상품 총액 + 총 수수료 + 총 감정서 수수료)
    _pageState.totalStats.grandTotalAmount =
      _pageState.totalStats.koreanAmount +
      _pageState.totalStats.feeAmount +
      _pageState.totalStats.appraisalFee;

    // 관리자만 총 합계 표시, 일반 사용자는 숨김
    updateSummaryStatsVisibility();

    if (document.getElementById("totalItemCount") === null) {
      return;
    }

    // UI 업데이트
    document.getElementById("totalItemCount").textContent = `${formatNumber(
      _pageState.totalStats.itemCount
    )}/${formatNumber(_pageState.totalStats.totalItemCount)}`;
    document.getElementById("totalJapaneseAmount").textContent =
      formatNumber(_pageState.totalStats.japaneseAmount) + " ¥";
    document.getElementById("totalKoreanAmount").textContent =
      formatNumber(_pageState.totalStats.koreanAmount) + " ₩";
    document.getElementById("totalFeeAmount").textContent =
      formatNumber(_pageState.totalStats.feeAmount) + " ₩";
    document.getElementById("totalVatAmount").textContent =
      formatNumber(_pageState.totalStats.vatAmount) + " ₩";

    // 감정서 수수료 UI 업데이트
    document.getElementById("totalAppraisalFee").textContent =
      formatNumber(_pageState.totalStats.appraisalFee) + " ₩";
    document.getElementById("totalAppraisalVat").textContent =
      formatNumber(_pageState.totalStats.appraisalVat) + " ₩";

    document.getElementById("grandTotalAmount").textContent =
      formatNumber(_pageState.totalStats.grandTotalAmount) + " ₩";
  }

  /**
   * 총 합계 표시/숨김 제어 - CSS 클래스 사용
   */
  function updateSummaryStatsVisibility() {
    if (!_pageState) return;

    const summaryStats = document.querySelector(".summary-stats");
    if (summaryStats) {
      if (_pageState.isAdmin) {
        summaryStats.classList.remove("hidden");
        summaryStats.classList.add("show-flex");
      } else {
        summaryStats.classList.remove("show-flex");
        summaryStats.classList.add("hidden");
      }
    }
  }

  /**
   * 결과 표시 (컨테이너 독립적)
   */
  function displayResults(containerId = "resultsList") {
    if (!_pageState) {
      console.error("페이지 상태가 설정되지 않았습니다.");
      return;
    }

    const container = document.getElementById(containerId);
    if (!container) return;

    container.innerHTML = "";
    const totalResultsElement = document.getElementById("totalResults");
    if (totalResultsElement) {
      totalResultsElement.textContent = _pageState.totalItems;
    }

    if (_pageState.filteredResults.length === 0) {
      container.innerHTML =
        '<div class="no-results">표시할 결과가 없습니다.</div>';
      return;
    }

    // 현재 페이지에 해당하는 결과만 표시
    const startIdx = (_pageState.currentPage - 1) * _pageState.itemsPerPage;
    const endIdx = Math.min(
      startIdx + _pageState.itemsPerPage,
      _pageState.filteredResults.length
    );

    for (let i = startIdx; i < endIdx; i++) {
      const dayResult = _pageState.filteredResults[i];
      const dateRow = createDailyResultRow(dayResult);
      container.appendChild(dateRow);
    }
  }

  /**
   * 일별 결과 행 생성
   */
  function createDailyResultRow(dayResult) {
    const dateRow = createElement("div", "daily-result-item");

    // 날짜 헤더
    const dateHeader = createElement("div", "date-header");
    const dateLabel = createElement(
      "h3",
      "",
      formatDisplayDate(dayResult.date)
    );
    const toggleButton = createElement("button", "toggle-details");
    toggleButton.innerHTML = '<i class="fas fa-chevron-down"></i>';

    dateHeader.appendChild(dateLabel);
    dateHeader.appendChild(toggleButton);

    // 요약 정보
    const summary = createSummarySection(dayResult);

    // 상세 정보 (접혀있는 상태)
    const details = createElement("div", "date-details hidden");
    const detailsTable = createDetailsTable(dayResult);
    details.appendChild(detailsTable);

    // 토글 버튼 이벤트
    toggleButton.addEventListener("click", function () {
      const isExpanded = !details.classList.contains("hidden");
      if (isExpanded) {
        // 닫기: show 제거하고 hidden 추가
        details.classList.remove("show");
        details.classList.add("hidden");
      } else {
        // 열기: hidden 제거하고 show 추가
        details.classList.remove("hidden");
        details.classList.add("show");
      }
      this.innerHTML = isExpanded
        ? '<i class="fas fa-chevron-down"></i>'
        : '<i class="fas fa-chevron-up"></i>';
    });

    // 모두 조합
    dateRow.appendChild(dateHeader);
    dateRow.appendChild(summary);
    dateRow.appendChild(details);

    return dateRow;
  }

  /**
   * 요약 섹션 생성
   */
  function createSummarySection(dayResult) {
    const summary = createElement("div", "date-summary");

    const summaryItems = [
      {
        label: "상품 수",
        value: `${formatNumber(dayResult.itemCount)}/${formatNumber(
          dayResult.totalItemCount || 0
        )}개`,
      },
      {
        label: "총액 (¥)",
        value: `${formatNumber(dayResult.totalJapanesePrice)} ¥`,
      },
      {
        label: "관부가세 포함 (₩)",
        value: `${formatNumber(dayResult.totalKoreanPrice)} ₩`,
      },
      {
        label: "수수료 (₩)",
        value: `${formatNumber(dayResult.feeAmount)} ₩`,
        note: `VAT ${formatNumber(dayResult.vatAmount)} ₩`,
      },
      {
        label: "감정서 수수료 (₩)",
        value: `${formatNumber(dayResult.appraisalFee || 0)} ₩`,
        note: `VAT ${formatNumber(dayResult.appraisalVat || 0)} ₩`,
      },
      {
        label: "총액 (₩)",
        value: `${formatNumber(dayResult.grandTotal)} ₩`,
      },
    ];

    summaryItems.forEach((item) => {
      const summaryItem = createElement("div", "summary-item");
      const label = createElement("span", "summary-label", item.label + ":");
      const value = createElement("span", "summary-value", item.value);

      summaryItem.appendChild(label);
      summaryItem.appendChild(value);

      if (item.note) {
        const note = createElement("span", "vat-note", item.note);
        summaryItem.appendChild(note);
      }

      summary.appendChild(summaryItem);
    });

    return summary;
  }

  /**
   * 상세 테이블 생성
   */
  function createDetailsTable(dayResult) {
    const detailsTable = createElement("table", "details-table");

    const tableHeader = createElement("thead");
    tableHeader.innerHTML = `
    <tr>
      <th>이미지</th>
      <th>브랜드</th>
      <th>상품명</th>
      <th>최종입찰금액 (¥)</th>
      <th>실제낙찰금액 (¥)</th>
      <th>관부가세 포함 (₩)</th>
      <th>출고 여부</th>
      <th>감정서</th>
    </tr>
    `;
    detailsTable.appendChild(tableHeader);

    const tableBody = createElement("tbody");

    // 낙찰 성공 상품들 먼저 표시 (연한 초록 배경)
    dayResult.successItems?.forEach((item) => {
      const row = createItemRow(item, "success");
      tableBody.appendChild(row);
    });

    // 낙찰 실패 상품들 표시 (연한 빨간 배경)
    dayResult.failedItems?.forEach((item) => {
      const row = createItemRow(item, "failed");
      tableBody.appendChild(row);
    });

    // 집계중 상품들 표시 (기본 배경)
    dayResult.pendingItems?.forEach((item) => {
      const row = createItemRow(item, "pending");
      tableBody.appendChild(row);
    });

    detailsTable.appendChild(tableBody);
    return detailsTable;
  }

  /**
   * 상품 행 생성 함수
   */
  function createItemRow(item, status) {
    const row = createElement("tr");
    row.classList.add(`bid-${status}`);

    // 이미지 셀
    const imageCell = createElement("td");
    if (item.image && item.image !== "/images/placeholder.png") {
      const imageElement = createElement("img");
      imageElement.src = item.image;
      imageElement.alt = item.item?.title || "상품 이미지";
      imageElement.classList.add("product-thumbnail");
      imageElement.onerror = function () {
        const placeholder = createElement(
          "div",
          "product-thumbnail-placeholder",
          "No Image"
        );
        this.parentNode.replaceChild(placeholder, this);
      };
      imageCell.appendChild(imageElement);
    } else {
      const placeholder = createElement(
        "div",
        "product-thumbnail-placeholder",
        "No Image"
      );
      imageCell.appendChild(placeholder);
    }

    // 다른 셀들
    const brandCell = createElement("td", "", item.item?.brand || "-");
    const titleCell = createElement("td", "", item.item?.title || "제목 없음");
    const finalPriceCell = createElement(
      "td",
      "",
      `${formatNumber(item.finalPrice)} ¥`
    );

    const winningPriceCell = createElement("td");
    if (status === "pending") {
      winningPriceCell.textContent = "집계중";
      winningPriceCell.classList.add("pending-text");
    } else {
      winningPriceCell.textContent = `${formatNumber(item.winningPrice)} ¥`;
    }

    const koreanCell = createElement("td");
    if (status === "success") {
      koreanCell.textContent = `${formatNumber(item.koreanPrice)} ₩`;
    } else if (status === "failed") {
      koreanCell.textContent = `${formatNumber(item.koreanPrice)} ₩`;
    } else {
      koreanCell.textContent = "-";
    }

    // 출고 여부 셀
    const shippingCell = createElement("td");
    if (status === "success") {
      const shippingStatus = createShippingStatus(item);
      shippingCell.appendChild(shippingStatus);
    } else {
      shippingCell.textContent = "-";
    }

    // 감정서 셀
    const appraisalCell = createElement("td");
    if (status === "success") {
      const appraisalBtn = createAppraisalButton(item);
      appraisalCell.appendChild(appraisalBtn);
    } else {
      appraisalCell.textContent = "-";
    }

    // 모든 셀 추가
    [
      imageCell,
      brandCell,
      titleCell,
      finalPriceCell,
      winningPriceCell,
      koreanCell,
      shippingCell,
      appraisalCell,
    ].forEach((cell) => {
      row.appendChild(cell);
    });

    return row;
  }

  /**
   * 감정서 버튼 생성
   */
  function createAppraisalButton(item) {
    const button = createElement("button", "appraisal-btn small-button");

    if (item.appr_id) {
      button.textContent = "요청 완료";
      button.classList.add("success-button");
      button.onclick = () => {};
    } else {
      button.textContent = "감정서 신청";
      button.classList.add("primary-button");
      button.onclick = () => {
        // 페이지별 함수를 전역에서 찾아서 호출
        if (window.requestAppraisal) {
          window.requestAppraisal(item);
        }
      };
    }

    return button;
  }

  /**
   * 출고 상태 생성
   */
  function createShippingStatus(item) {
    const statusSpan = createElement("span", "shipping-status");

    if (item.status === "shipped") {
      statusSpan.textContent = "출고됨";
      statusSpan.classList.add("status-shipped");
    } else if (item.status === "completed") {
      statusSpan.textContent = "출고 대기";
      statusSpan.classList.add("status-waiting");
    } else {
      statusSpan.textContent = "-";
      statusSpan.classList.add("status-none");
    }

    return statusSpan;
  }

  /**
   * 표시용 날짜 포맷
   */
  function formatDisplayDate(dateStr) {
    const date = new Date(dateStr);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    const weekday = ["일", "월", "화", "수", "목", "금", "토"][date.getDay()];

    return `${year}년 ${month}월 ${day}일 (${weekday})`;
  }

  /**
   * 정렬 버튼 UI 업데이트
   */
  function updateSortButtonsUI() {
    if (!_pageState) return;

    const sortButtons = document.querySelectorAll(".sort-btn");

    sortButtons.forEach((btn) => {
      // 모든 버튼에서 active 클래스와 방향 표시 제거
      btn.classList.remove("active", "asc", "desc");

      // 현재 정렬 기준인 버튼에 클래스 추가
      if (btn.dataset.sort === _pageState.sortBy) {
        btn.classList.add("active", _pageState.sortOrder);
      }
    });
  }

  /**
   * 페이지 변경 처리
   */
  function handlePageChange(page, updateURLFunction) {
    if (!_pageState) return;

    page = parseInt(page, 10);

    if (page === _pageState.currentPage) return;

    _pageState.currentPage = page;
    displayResults();
    window.scrollTo(0, 0);

    if (updateURLFunction) {
      updateURLFunction();
    }
  }

  /**
   * 로딩 표시 토글
   */
  function toggleLoading(show) {
    const loadingMsg = document.getElementById("loadingMsg");
    if (loadingMsg) {
      if (show) {
        loadingMsg.classList.remove("loading-hidden");
        loadingMsg.classList.add("loading-visible");
      } else {
        loadingMsg.classList.remove("loading-visible");
        loadingMsg.classList.add("loading-hidden");
      }
    }
  }

  // 공개 API
  return {
    // 상수
    MINIMUM_FEE,

    // 상태 관리
    setPageState,

    // 데이터 처리
    groupResultsByDate,
    classifyBidStatus,
    sortDailyResults,
    updateTotalStats,
    updateSummaryStatsVisibility,

    // UI 생성
    createDailyResultRow,
    createSummarySection,
    createDetailsTable,
    createItemRow,
    createAppraisalButton,
    createShippingStatus,

    // 표시 함수
    displayResults,

    // 유틸리티
    formatDisplayDate,
    updateSortButtonsUI,
    handlePageChange,
    toggleLoading,
  };
})();
