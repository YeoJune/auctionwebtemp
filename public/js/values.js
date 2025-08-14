// public/js/values.js

// 시세 페이지 설정
const valuePageConfig = {
  type: "values",
  apiEndpoint: "/values",
  detailEndpoint: "/detail/value-details/",
  template: "value-card-template",

  features: {
    bidding: false,
    wishlist: false,
    realtime: false,
    adminEdit: true, // 관리자 가격 수정 기능
    auctionTypes: false,
    scheduledDates: false,
    bidItemsOnly: false,
    excludeExpired: false,
  },

  filters: {
    brands: "/values/brands-with-count",
    categories: "/values/categories",
    ranks: "/values/ranks",
    aucNums: "/values/auc-nums",
  },

  initialState: {
    selectedBrands: [],
    selectedCategories: [],
    selectedRanks: [],
    selectedAucNums: [],
    sortBy: "scheduled_date",
    sortOrder: "asc",
    currentPage: 1,
    itemsPerPage: 20,
    totalItems: 0,
    totalPages: 0,
    searchTerm: "",
    currentData: [],
    images: [],
    currentImageIndex: 0,
  },
};

// 관리자 가격 수정 매니저
window.AdminPriceManager = (function () {
  /**
   * 가격 수정 처리
   */
  async function handlePriceEdit(itemId, priceSpan) {
    // 관리자 권한 체크 (비동기 인증 상태 확인)
    await window.AuthManager.checkAuthStatus();
    if (!window.AuthManager.requireAdmin()) {
      return;
    }

    const currentPrice = priceSpan.textContent.trim().replace(/[^0-9]/g, "");
    const originalContent = priceSpan.innerHTML;

    // 인라인 수정 UI로 변경
    priceSpan.innerHTML = `
      <input type="number" class="price-input" value="${currentPrice}" style="width: 80px; margin-right: 5px;" />
      <button class="save-price" style="padding: 3px 8px; margin-right: 5px;">저장</button>
      <button class="cancel-price" style="padding: 3px 8px; background-color: #f0f0f0; color: #333;">취소</button>
    `;

    const input = priceSpan.querySelector(".price-input");
    const saveBtn = priceSpan.querySelector(".save-price");
    const cancelBtn = priceSpan.querySelector(".cancel-price");

    input.focus();

    // 저장 버튼 이벤트
    saveBtn.onclick = async (e) => {
      e.stopPropagation();
      const newPrice = input.value;

      if (!newPrice || isNaN(newPrice)) {
        alert("올바른 가격을 입력해주세요.");
        return;
      }

      try {
        const response = await window.API.fetchAPI(
          `/admin/values/${itemId}/price`,
          {
            method: "PUT",
            body: JSON.stringify({ final_price: parseInt(newPrice) }),
          }
        );
        if (response && response.success) {
          // 성공 시 UI 업데이트
          priceSpan.innerHTML = `${formatNumber(
            parseInt(newPrice)
          )} ¥ <button class="edit-price-icon"><i class="fas fa-edit"></i></button>`;

          // 새로운 수정 버튼에 이벤트 리스너 다시 추가
          const newEditIcon = priceSpan.querySelector(".edit-price-icon");
          if (newEditIcon) {
            newEditIcon.addEventListener("click", (e) => {
              e.stopPropagation();
              handlePriceEdit(itemId, priceSpan);
            });
          }

          alert("가격이 성공적으로 수정되었습니다.");
        } else {
          throw new Error(response?.message || "서버 응답 오류");
        }
      } catch (error) {
        console.error("Error updating price:", error);
        priceSpan.innerHTML = originalContent;
        alert("가격 수정 중 오류가 발생했습니다.");
      }
    };

    // 취소 버튼 이벤트
    cancelBtn.onclick = (e) => {
      e.stopPropagation();
      priceSpan.innerHTML = originalContent;

      // 원래 수정 버튼에 이벤트 리스너 다시 추가
      const editIcon = priceSpan.querySelector(".edit-price-icon");
      if (editIcon) {
        editIcon.addEventListener("click", (e) => {
          e.stopPropagation();
          handlePriceEdit(itemId, priceSpan);
        });
      }
    };

    // Enter 키로 저장
    input.addEventListener("keypress", (e) => {
      if (e.key === "Enter") {
        saveBtn.click();
      }
    });

    // ESC 키로 취소
    input.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        cancelBtn.click();
      }
    });
  }

  return {
    handlePriceEdit,
  };
})();

// 시세 페이지 특화 렌더링
window.ValueRenderer = (function () {
  /**
   * 시세 카드 후처리 (템플릿 렌더링 후)
   */
  function postProcessCard(card, item) {
    // 관리자 수정 버튼 설정
    if (valuePageConfig.features.adminEdit && window.AuthManager.isAdmin()) {
      setupAdminEditButton(card, item);
    }

    // 가격 정보 설정
    setupPriceInfo(card, item);

    // 날짜 정보 설정
    setupDateInfo(card, item);
  }

  /**
   * 관리자 수정 버튼 설정
   */
  function setupAdminEditButton(card, item) {
    const editButton = card.querySelector(".edit-price-icon");
    if (!editButton) return;

    // 관리자가 아니면 버튼 제거
    if (!window.AuthManager.isAdmin()) {
      editButton.remove();
      return;
    }

    // 클릭 이벤트 추가
    editButton.addEventListener("click", (e) => {
      e.stopPropagation();
      const priceValue = editButton.closest(".info-value");
      window.AdminPriceManager.handlePriceEdit(item.item_id, priceValue);
    });
  }

  /**
   * 가격 정보 설정
   */
  function setupPriceInfo(card, item) {
    const priceValueEl = card.querySelector(
      ".info-cell:nth-child(3) .info-value"
    );

    if (priceValueEl && item.final_price) {
      // 관리자인 경우에만 수정 버튼 추가
      const editButtonHTML = window.AuthManager.isAdmin()
        ? ` <button class="edit-price-icon"><i class="fas fa-edit"></i></button>`
        : "";

      priceValueEl.innerHTML = `${formatNumber(
        parseInt(item.final_price)
      )} ¥${editButtonHTML}`;

      // 수정 버튼이 추가된 경우 이벤트 리스너 설정
      if (editButtonHTML) {
        setupAdminEditButton(card, item);
      }
    }
  }

  /**
   * 날짜 정보 설정
   */
  function setupDateInfo(card, item) {
    const dateValueEl = card.querySelector(
      ".info-cell:nth-child(2) .info-value"
    );

    if (dateValueEl && item.scheduled_date) {
      dateValueEl.textContent = formatDate(item.scheduled_date);
    }
  }

  return {
    postProcessCard,
  };
})();

// 시세 페이지 특화 기능 확장
const ValuePageExtensions = {
  /**
   * 커스텀 카드 렌더링 (템플릿 렌더링 후 호출됨)
   */
  customizeCard(card, item) {
    // ValueRenderer를 통한 후처리
    window.ValueRenderer.postProcessCard(card, item);

    return card;
  },

  /**
   * 커스텀 모달 초기화
   */
  customizeModal(item) {
    // 시세 페이지용 모달 초기화
    initializeValueModal(item);
  },

  /**
   * 페이지별 이벤트 설정
   */
  setupCustomEvents() {
    // 시세 페이지 특화 이벤트가 있다면 여기에 추가
    console.log("시세 페이지 커스텀 이벤트 설정 완료");
  },
};

/**
 * 시세 모달 초기화
 */
function initializeValueModal(item) {
  // 시세 페이지는 입찰 정보가 없으므로 기본 모달만 사용
  // 추가적인 시세 관련 정보가 필요하다면 여기에 구현

  // 최종 가격 정보 업데이트
  const finalPriceEl = document.querySelector(".modal-final-price");
  if (finalPriceEl && item.final_price) {
    finalPriceEl.textContent = `${formatNumber(parseInt(item.final_price))} ¥`;
  }
}

/**
 * 데이터 바인딩 확장 (main.js의 기본 바인딩에 추가)
 */
function extendDataBinding(card, item) {
  // 시세 페이지 특화 데이터 바인딩
  const formattedFields = card.querySelectorAll("[data-field]");

  formattedFields.forEach((element) => {
    const field = element.dataset.field;

    switch (field) {
      case "formatted_date":
        if (item.scheduled_date) {
          element.textContent = formatDate(item.scheduled_date);
        }
        break;
      case "formatted_price":
        if (item.final_price) {
          element.textContent = cleanNumberFormat(item.final_price);
        }
        break;
    }
  });
}

// 페이지 초기화
function initializeValuePage() {
  // 설정 확장
  valuePageConfig.customizeCard = ValuePageExtensions.customizeCard;
  valuePageConfig.customizeModal = ValuePageExtensions.customizeModal;

  // 관리자 권한 확인 후 UI 업데이트
  window.AuthManager.checkAuthStatus()
    .then(() => {
      // 관리자가 아니면 수정 버튼 숨기기
      if (!window.AuthManager.isAdmin()) {
        valuePageConfig.features.adminEdit = false;
      }

      // ProductListController 초기화 (인증 확인 후)
      window.ProductListController.init(valuePageConfig);
    })
    .catch((error) => {
      console.error("인증 상태 확인 실패:", error);
      valuePageConfig.features.adminEdit = false;
      // 에러가 있어도 기본 기능은 동작하도록
      window.ProductListController.init(valuePageConfig);
    });
}

// DOM 로드 완료 시 초기화
document.addEventListener("DOMContentLoaded", function () {
  initializeValuePage();
});

// 전역 함수로 노출 (HTML에서 호출용)
window.showDetails = function (itemId) {
  window.ProductListController.showDetails(itemId);
};

// 관리자 가격 수정 함수 전역 노출
window.handlePriceEdit = function (itemId, priceSpan) {
  window.AdminPriceManager.handlePriceEdit(itemId, priceSpan);
};
