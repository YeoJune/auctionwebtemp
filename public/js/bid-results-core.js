// public/js/bid-results-core.js

// 입찰 결과 관리 - 공통 로직
window.BidResultsCore = (function () {
  // 상수 정의
  const MINIMUM_FEE = 10000;

  // 내부 상태
  let _pageState = null;

  /**
   * 페이지 상태 설정
   */
  function setPageState(state) {
    _pageState = state;
    console.log("BidResultsCore: 상태 설정됨", _pageState);
  }

  /**
   * 총 합계 표시/숨김 제어
   */
  function updateSummaryStatsVisibility() {
    if (!_pageState) {
      console.warn("페이지 상태가 설정되지 않았습니다.");
      return;
    }

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
   * 결과 표시
   */
  function displayResults(containerId = "resultsList") {
    console.log("BidResultsCore: displayResults 시작");

    if (!_pageState) {
      console.error("페이지 상태가 설정되지 않았습니다.");
      return;
    }

    const container = document.getElementById(containerId);
    if (!container) {
      console.error(`Container not found: ${containerId}`);
      return;
    }

    // 컨테이너 초기화
    container.innerHTML = "";

    // totalResults 업데이트
    const totalResultsElement = document.getElementById("totalResults");
    if (totalResultsElement) {
      totalResultsElement.textContent = _pageState.totalItems || 0;
    }

    // dailyResults 검증
    if (!_pageState.dailyResults || !Array.isArray(_pageState.dailyResults)) {
      console.warn("dailyResults가 배열이 아닙니다:", _pageState.dailyResults);
      container.innerHTML =
        '<div class="no-results">표시할 결과가 없습니다.</div>';
      return;
    }

    if (_pageState.dailyResults.length === 0) {
      console.log("표시할 결과가 없습니다.");
      container.innerHTML =
        '<div class="no-results">표시할 결과가 없습니다.</div>';
      return;
    }

    console.log(
      `총 ${_pageState.dailyResults.length}개의 일별 결과를 표시합니다.`
    );

    // 각 일별 결과 표시
    _pageState.dailyResults.forEach((dayResult, index) => {
      try {
        console.log(`일별 결과 ${index + 1} 렌더링:`, dayResult.date);
        const dateRow = createDailyResultRow(dayResult);
        container.appendChild(dateRow);
      } catch (error) {
        console.error(`일별 결과 ${index + 1} 렌더링 실패:`, error, dayResult);
      }
    });

    console.log("BidResultsCore: displayResults 완료");
  }

  /**
   * 일별 결과 행 생성
   */
  function createDailyResultRow(dayResult) {
    if (!dayResult || typeof dayResult !== "object") {
      console.error("잘못된 dayResult:", dayResult);
      return createElement("div", "daily-result-item", "데이터 오류");
    }

    const dateRow = createElement("div", "daily-result-item");

    // 날짜 헤더
    const dateHeader = createElement("div", "date-header");
    const dateLabel = createElement(
      "h3",
      "",
      formatDisplayDate(dayResult.date || new Date())
    );
    const toggleButton = createElement("button", "toggle-details");
    toggleButton.innerHTML = '<i class="fas fa-chevron-down"></i>';

    dateHeader.appendChild(dateLabel);
    dateHeader.appendChild(toggleButton);

    // 요약 정보
    const summary = createSummarySection(dayResult);

    // 상세 정보
    const details = createElement("div", "date-details hidden");
    const detailsTable = createDetailsTable(dayResult);
    details.appendChild(detailsTable);

    // 토글 버튼 이벤트
    toggleButton.addEventListener("click", function () {
      const isExpanded = !details.classList.contains("hidden");
      if (isExpanded) {
        details.classList.remove("show");
        details.classList.add("hidden");
      } else {
        details.classList.remove("hidden");
        details.classList.add("show");
      }
      this.innerHTML = isExpanded
        ? '<i class="fas fa-chevron-down"></i>'
        : '<i class="fas fa-chevron-up"></i>';
    });

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
        value: `${formatNumber(dayResult.itemCount || 0)}/${formatNumber(
          dayResult.totalItemCount || 0
        )}개`,
      },
      {
        label: "총액 (¥)",
        value: `${formatNumber(dayResult.totalJapanesePrice || 0)} ¥`,
      },
      {
        label: "관부가세 포함 (₩)",
        value: `${formatNumber(dayResult.totalKoreanPrice || 0)} ₩`,
      },
      {
        label: "수수료 (₩)",
        value: `${formatNumber(dayResult.feeAmount || 0)} ₩`,
        note: `VAT ${formatNumber(dayResult.vatAmount || 0)} ₩`,
      },
      {
        label: "감정서 수수료 (₩)",
        value: `${formatNumber(dayResult.appraisalFee || 0)} ₩`,
        note: `VAT ${formatNumber(dayResult.appraisalVat || 0)} ₩`,
      },
      {
        label: "총액 (₩)",
        value: `${formatNumber(dayResult.grandTotal || 0)} ₩`,
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

    // 배열 검증
    const successItems = Array.isArray(dayResult.successItems)
      ? dayResult.successItems
      : [];
    const failedItems = Array.isArray(dayResult.failedItems)
      ? dayResult.failedItems
      : [];
    const pendingItems = Array.isArray(dayResult.pendingItems)
      ? dayResult.pendingItems
      : [];

    // 낙찰 성공
    successItems.forEach((item) => {
      const row = createItemRow(item, "success");
      tableBody.appendChild(row);
    });

    // 낙찰 실패
    failedItems.forEach((item) => {
      const row = createItemRow(item, "failed");
      tableBody.appendChild(row);
    });

    // 집계중
    pendingItems.forEach((item) => {
      const row = createItemRow(item, "pending");
      tableBody.appendChild(row);
    });

    if (tableBody.children.length === 0) {
      const emptyRow = createElement("tr");
      const emptyCell = createElement("td", "", "표시할 아이템이 없습니다.");
      emptyCell.setAttribute("colspan", "8");
      emptyCell.style.textAlign = "center";
      emptyRow.appendChild(emptyCell);
      tableBody.appendChild(emptyRow);
    }

    detailsTable.appendChild(tableBody);
    return detailsTable;
  }

  /**
   * 상품 행 생성
   */
  function createItemRow(item, status) {
    if (!item || typeof item !== "object") {
      console.error("잘못된 item:", item);
      const row = createElement("tr");
      row.innerHTML = '<td colspan="8">데이터 오류</td>';
      return row;
    }

    const row = createElement("tr");
    row.classList.add(`bid-${status}`);

    // 이미지 셀
    const imageCell = createElement("td");
    const itemImage = item.item?.image || item.image;
    if (itemImage && itemImage !== "/images/placeholder.png") {
      const imageElement = createElement("img");
      imageElement.src = window.API?.validateImageUrl
        ? window.API.validateImageUrl(itemImage)
        : itemImage;
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
    const brandCell = createElement(
      "td",
      "",
      item.item?.brand || item.brand || "-"
    );
    const titleCell = createElement(
      "td",
      "",
      item.item?.title || item.title || "제목 없음"
    );

    const finalPrice = item.final_price || item.finalPrice || 0;
    const finalPriceCell = createElement(
      "td",
      "",
      `${formatNumber(finalPrice)} ¥`
    );

    const winningPriceCell = createElement("td");
    if (status === "pending") {
      winningPriceCell.textContent = "집계중";
      winningPriceCell.classList.add("pending-text");
    } else {
      const winningPrice = item.winning_price || item.winningPrice || 0;
      winningPriceCell.textContent = `${formatNumber(winningPrice)} ¥`;
    }

    const koreanCell = createElement("td");
    if (status === "success") {
      const koreanPrice = item.korean_price || item.koreanPrice || 0;
      koreanCell.textContent = `${formatNumber(koreanPrice)} ₩`;
    } else if (status === "failed") {
      const koreanPrice = item.korean_price || item.koreanPrice || 0;
      koreanCell.textContent = `${formatNumber(koreanPrice)} ₩`;
    } else {
      koreanCell.textContent = "-";
    }

    // 출고 여부
    const shippingCell = createElement("td");
    if (status === "success") {
      const shippingStatus = createShippingStatus(item);
      shippingCell.appendChild(shippingStatus);
    } else {
      shippingCell.textContent = "-";
    }

    // 감정서
    const appraisalCell = createElement("td");
    if (status === "success") {
      const appraisalBtn = createAppraisalButton(item);
      appraisalCell.appendChild(appraisalBtn);
    } else {
      appraisalCell.textContent = "-";
    }

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
        if (window.requestAppraisal) {
          window.requestAppraisal(item);
        }
      };
    }

    return button;
  }

  // 수선 버튼 기능은 어드민에서만 사용
  // function createRepairButton(item) {
  //   const button = createElement("button", "repair-btn small-button");
  //   if (item.repair_requested_at) {
  //     button.textContent = "접수 완료";
  //     button.classList.add("success-button");
  //     button.onclick = () => {};
  //   } else {
  //     button.textContent = "수선 접수";
  //     button.classList.add("primary-button");
  //     button.onclick = () => {
  //       if (window.requestRepair) {
  //         window.requestRepair(item);
  //       }
  //     };
  //   }
  //   return button;
  // }

  /**
   * 출고 상태 생성
   */
  function createShippingStatus(item) {
    const statusSpan = createElement("span", "shipping-status");

    if (item.status === "shipped") {
      statusSpan.textContent = "출고됨";
      statusSpan.classList.add("status-shipped");
    } else if (item.status === "completed") {
      // completed_at이 있고 1일 이상 지났는지 확인
      if (item.completed_at) {
        const completedDate = new Date(item.completed_at);
        const now = new Date();
        const daysSinceCompleted =
          (now - completedDate) / (1000 * 60 * 60 * 24);

        if (daysSinceCompleted >= 1) {
          statusSpan.textContent = "해외배송중";
          statusSpan.classList.add("status-shipping");
        } else {
          statusSpan.textContent = "출고 대기";
          statusSpan.classList.add("status-waiting");
        }
      } else {
        // completed_at이 없으면 출고 대기로 표시
        statusSpan.textContent = "출고 대기";
        statusSpan.classList.add("status-waiting");
      }
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
    try {
      const date = new Date(dateStr);
      if (isNaN(date.getTime())) {
        return "날짜 오류";
      }
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, "0");
      const day = String(date.getDate()).padStart(2, "0");
      const weekday = ["일", "월", "화", "수", "목", "금", "토"][date.getDay()];

      return `${year}년 ${month}월 ${day}일 (${weekday})`;
    } catch (error) {
      console.error("날짜 포맷 오류:", error, dateStr);
      return "날짜 오류";
    }
  }

  /**
   * 정렬 버튼 UI 업데이트
   */
  function updateSortButtonsUI() {
    if (!_pageState) return;

    const sortButtons = document.querySelectorAll(".sort-btn");

    sortButtons.forEach((btn) => {
      btn.classList.remove("active", "asc", "desc");

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
    MINIMUM_FEE,
    setPageState,
    updateSummaryStatsVisibility,
    createDailyResultRow,
    createSummarySection,
    createDetailsTable,
    createItemRow,
    createAppraisalButton,
    createShippingStatus,
    displayResults,
    formatDisplayDate,
    updateSortButtonsUI,
    handlePageChange,
    toggleLoading,
  };
})();
