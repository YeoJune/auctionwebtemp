// public/js/my-page.js

// 마이페이지 관리 클래스
class MyPageManager {
  constructor() {
    this.currentSection = "dashboard";
    this.bidsData = [];
    this.userData = null;
    this.filters = {
      process: "all",
      type: "all",
      dateRange: 30,
    };
    this.pagination = {
      currentPage: 1,
      itemsPerPage: 10,
      totalItems: 0,
      totalPages: 0,
    };
  }

  // 초기화
  async initialize() {
    try {
      // 인증 상태 확인
      const isAuth = await window.AuthManager.checkAuthStatus();
      if (!isAuth) {
        window.AuthManager.redirectToSignin();
        return;
      }

      // 환율 및 수수료율 정보 로드
      await fetchExchangeRate();
      await fetchUserCommissionRate();

      // 기본 데이터 로드
      await Promise.all([this.loadUserData(), this.loadBidsData()]);

      // 이벤트 리스너 설정
      this.setupEventListeners();

      // URL 해시에 따른 초기 섹션 표시
      const hash = window.location.hash.replace("#", "");
      const initialSection = ["dashboard", "bids", "account"].includes(hash)
        ? hash
        : "dashboard";
      this.showSection(initialSection);

      console.log("마이페이지 초기화 완료");
    } catch (error) {
      console.error("마이페이지 초기화 중 오류 발생:", error);
      alert("페이지를 불러오는 중 오류가 발생했습니다.");
    }
  }

  // 사용자 데이터 로드
  async loadUserData() {
    try {
      this.userData = await API.fetchAPI("/users/current");
      console.log("사용자 데이터 로드 완료:", this.userData.id);
    } catch (error) {
      console.error("사용자 데이터 로드 실패:", error);
      throw error;
    }
  }

  // 입찰 데이터 로드
  async loadBidsData() {
    try {
      toggleLoading(true);

      const [liveBidsResponse, directBidsResponse] = await Promise.all([
        API.fetchAPI("/live-bids?limit=0"),
        API.fetchAPI("/direct-bids?limit=0"),
      ]);

      // 데이터 통합 및 가공
      this.bidsData = this.processBidsData(
        liveBidsResponse.bids || [],
        directBidsResponse.bids || []
      );

      console.log(`입찰 데이터 로드 완료: 총 ${this.bidsData.length}건`);
    } catch (error) {
      console.error("입찰 데이터 로드 실패:", error);
      this.bidsData = [];
    } finally {
      toggleLoading(false);
    }
  }

  // 입찰 데이터 가공
  processBidsData(liveBids, directBids) {
    const allBids = [
      ...liveBids.map((bid) => ({ ...bid, type: "live" })),
      ...directBids.map((bid) => ({ ...bid, type: "direct" })),
    ];

    return allBids
      .map((bid) => ({
        ...bid,
        processStage: this.getProcessStage(bid),
        displayInfo: this.formatBidInfo(bid),
        displayPrice: this.getDisplayPrice(bid),
        winningInfo: this.getWinningInfo(bid),
      }))
      .sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));
  }

  // 프로세스 단계 판별
  getProcessStage(bid) {
    if (["active", "first", "second", "final"].includes(bid.status)) {
      return "bidding";
    }
    if (bid.status === "completed" && bid.winning_price && !bid.appr_id) {
      return "can_apply";
    }
    if (bid.appr_id) {
      return "completed";
    }
    return "cancelled";
  }

  // 입찰 정보 포맷팅
  formatBidInfo(bid) {
    const item = bid.item;
    if (!item) return null;

    return {
      brand: item.brand || "-",
      title: item.title || item.original_title || "제목 없음",
      image: API.validateImageUrl(item.image),
      category: item.category || "-",
      auc_num: item.auc_num || 1,
    };
  }

  // 표시 가격 계산
  getDisplayPrice(bid) {
    if (bid.type === "direct") {
      return bid.current_price || 0;
    } else {
      return bid.final_price || bid.second_price || bid.first_price || 0;
    }
  }

  // 낙찰 정보 계산
  getWinningInfo(bid) {
    if (!bid.winning_price) return null;

    const auctionId = bid.item?.auc_num || 1;
    const category = bid.item?.category || "기타";
    const koreanPrice = calculateTotalPrice(
      bid.winning_price,
      auctionId,
      category
    );

    return {
      winningPrice: bid.winning_price,
      koreanPrice: koreanPrice,
    };
  }

  // 섹션 전환
  showSection(sectionName) {
    // 네비게이션 업데이트
    document.querySelectorAll(".nav-item").forEach((item) => {
      item.classList.remove("active");
    });
    document
      .querySelector(`[data-section="${sectionName}"]`)
      ?.classList.add("active");

    // 섹션 표시
    document.querySelectorAll(".page-section").forEach((section) => {
      section.classList.remove("active");
    });
    document.getElementById(`${sectionName}-section`)?.classList.add("active");

    // URL 해시 업데이트
    window.location.hash = sectionName;
    this.currentSection = sectionName;

    // 섹션별 렌더링
    switch (sectionName) {
      case "dashboard":
        this.renderDashboard();
        break;
      case "bids":
        this.renderBidsSection();
        break;
      case "account":
        this.renderAccountSection();
        break;
    }

    console.log(`섹션 전환: ${sectionName}`);
  }

  // 대시보드 렌더링
  renderDashboard() {
    // 통계 계산
    const stats = this.calculateDashboardStats();

    // 통계 표시
    document.getElementById("active-count").textContent = formatNumber(
      stats.activeCount
    );
    document.getElementById("completed-count").textContent = formatNumber(
      stats.completedCount
    );
    document.getElementById("monthly-total").textContent = `₩${formatNumber(
      stats.monthlyTotal
    )}`;

    // 최근 입찰 표시
    this.renderRecentBids();
  }

  // 대시보드 통계 계산
  calculateDashboardStats() {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const activeCount = this.bidsData.filter(
      (bid) => bid.processStage === "bidding"
    ).length;
    const completedCount = this.bidsData.filter(
      (bid) =>
        bid.processStage === "completed" || bid.processStage === "can_apply"
    ).length;

    // 이번 달 낙찰 총액
    const monthlyTotal = this.bidsData
      .filter((bid) => {
        const updatedAt = new Date(bid.updated_at);
        return updatedAt >= monthStart && bid.winningInfo;
      })
      .reduce((sum, bid) => sum + bid.winningInfo.koreanPrice, 0);

    return { activeCount, completedCount, monthlyTotal };
  }

  // 최근 입찰 렌더링
  renderRecentBids() {
    const container = document.getElementById("recent-bids-list");
    const recentBids = this.bidsData.slice(0, 5);

    if (recentBids.length === 0) {
      container.innerHTML =
        '<div class="no-results">최근 입찰 내역이 없습니다.</div>';
      return;
    }

    container.innerHTML = recentBids
      .map(
        (bid) => `
      <div class="activity-item">
        <img src="${
          bid.displayInfo?.image
        }" alt="상품 이미지" class="activity-image">
        <div class="activity-content">
          <div class="activity-title">${bid.displayInfo?.brand} - ${
          bid.displayInfo?.title
        }</div>
          <div class="activity-details">
            <span class="activity-type">${
              bid.type === "live" ? "현장경매" : "직접경매"
            }</span>
            <span class="activity-price">￥${formatNumber(
              bid.displayPrice
            )}</span>
            <span class="activity-status ${
              bid.processStage
            }">${this.getStatusText(bid)}</span>
          </div>
          <div class="activity-date">${formatDateTime(bid.updated_at)}</div>
        </div>
      </div>
    `
      )
      .join("");
  }

  // 입찰 현황 섹션 렌더링
  renderBidsSection() {
    // 필터링된 데이터 가져오기
    const filteredBids = this.applyBidsFilters();

    // 페이지네이션 계산
    this.pagination.totalItems = filteredBids.length;
    this.pagination.totalPages = Math.ceil(
      filteredBids.length / this.pagination.itemsPerPage
    );

    // 현재 페이지 데이터
    const startIdx =
      (this.pagination.currentPage - 1) * this.pagination.itemsPerPage;
    const endIdx = startIdx + this.pagination.itemsPerPage;
    const currentPageBids = filteredBids.slice(startIdx, endIdx);

    // 결과 카운트 업데이트
    document.getElementById("bids-total-count").textContent =
      this.pagination.totalItems;

    // 로딩 숨기기
    document.getElementById("bids-loading").style.display = "none";

    // 입찰 목록 렌더링
    this.renderBidsList(currentPageBids);

    // 페이지네이션 렌더링
    this.renderBidsPagination();
  }

  // 입찰 필터 적용
  applyBidsFilters() {
    let filtered = [...this.bidsData];

    // 프로세스 단계 필터
    if (this.filters.process !== "all") {
      filtered = filtered.filter(
        (bid) => bid.processStage === this.filters.process
      );
    }

    // 경매 타입 필터
    if (this.filters.type !== "all") {
      filtered = filtered.filter((bid) => bid.type === this.filters.type);
    }

    // 날짜 필터
    const dateLimit = new Date();
    dateLimit.setDate(dateLimit.getDate() - this.filters.dateRange);
    filtered = filtered.filter((bid) => new Date(bid.updated_at) >= dateLimit);

    return filtered;
  }

  // 입찰 목록 렌더링
  renderBidsList(bids) {
    const container = document.getElementById("bids-list");

    if (bids.length === 0) {
      container.innerHTML =
        '<div class="no-results">조건에 맞는 입찰 내역이 없습니다.</div>';
      return;
    }

    container.innerHTML = bids
      .map((bid) => this.createBidItemHTML(bid))
      .join("");
  }

  // 입찰 아이템 HTML 생성
  createBidItemHTML(bid) {
    const info = bid.displayInfo;
    const status = this.getStatusText(bid);
    const statusClass = bid.processStage;

    let priceHTML = `
      <div class="bid-price">
        <span class="price-label">입찰가:</span>
        <span class="price-value">￥${formatNumber(bid.displayPrice)}</span>
      </div>
    `;

    // 낙찰 정보가 있으면 추가 표시
    if (bid.winningInfo) {
      priceHTML += `
        <div class="winning-price">
          <span class="price-label">낙찰가:</span>
          <span class="price-value">￥${formatNumber(
            bid.winningInfo.winningPrice
          )}</span>
        </div>
        <div class="korean-price">
          <span class="price-label">관부가세 포함:</span>
          <span class="price-value">₩${formatNumber(
            bid.winningInfo.koreanPrice
          )}</span>
        </div>
      `;
    }

    // 감정서 신청 버튼
    let actionHTML = "";
    if (bid.processStage === "can_apply") {
      actionHTML = `
        <button class="apply-appraisal-btn" 
                data-bid-id="${bid.id}" 
                data-bid-type="${bid.type}"
                data-brand="${info.brand}"
                data-title="${info.title}"
                data-image="${info.image}"
                data-winning-price="${bid.winningInfo?.winningPrice || 0}">
          감정서 신청
        </button>
      `;
    } else if (bid.appr_id) {
      actionHTML = '<span class="appraisal-completed">감정서 신청 완료</span>';
    }

    return `
      <div class="bid-item">
        <div class="item-info">
          <img src="${info.image}" alt="상품 이미지" class="item-image">
          <div class="item-details">
            <div class="item-brand">${info.brand}</div>
            <div class="item-title">${info.title}</div>
            <div class="item-meta">
              <span class="item-type">${
                bid.type === "live" ? "현장경매" : "직접경매"
              }</span>
              <span class="item-category">${info.category}</span>
            </div>
          </div>
        </div>
        <div class="price-info">
          ${priceHTML}
        </div>
        <div class="status-info">
          <div class="status-badge ${statusClass}">${status}</div>
          <div class="updated-date">${formatDateTime(bid.updated_at)}</div>
          ${actionHTML}
        </div>
      </div>
    `;
  }

  // 상태 텍스트 반환
  getStatusText(bid) {
    const statusMap = {
      bidding: "입찰중",
      can_apply: "감정서 신청 가능",
      completed: "완료",
      cancelled: "취소",
    };
    return statusMap[bid.processStage] || "알 수 없음";
  }

  // 입찰 페이지네이션 렌더링
  renderBidsPagination() {
    createPagination(
      this.pagination.currentPage,
      this.pagination.totalPages,
      (page) => this.handleBidsPageChange(page)
    );
  }

  // 입찰 페이지 변경 처리
  handleBidsPageChange(page) {
    this.pagination.currentPage = page;
    this.renderBidsSection();
    document.querySelector(".my-page-main").scrollTop = 0;
  }

  // 계정 관리 섹션 렌더링
  async renderAccountSection() {
    const loadingEl = document.getElementById("account-loading");
    const contentEl = document.getElementById("account-content");

    try {
      loadingEl.style.display = "block";
      contentEl.classList.add("hidden");

      // 사용자 데이터가 없으면 다시 로드
      if (!this.userData) {
        await this.loadUserData();
      }

      // 폼에 데이터 채우기
      this.populateAccountForm();

      loadingEl.style.display = "none";
      contentEl.classList.remove("hidden");
    } catch (error) {
      console.error("계정 정보 렌더링 실패:", error);
      loadingEl.innerHTML =
        '<div class="error-message">계정 정보를 불러오는데 실패했습니다.</div>';
    }
  }

  // 계정 폼에 데이터 채우기
  populateAccountForm() {
    const data = this.userData;

    // 기본 정보
    document.getElementById("user-id").value = data.id || "";
    document.getElementById("user-email").value = data.email || "";
    document.getElementById("user-phone").value = data.phone || "";
    document.getElementById("registration-date").value = data.registration_date
      ? formatDate(data.registration_date)
      : "";

    // 회사 정보
    document.getElementById("company-name").value = data.company_name || "";
    document.getElementById("business-number").value =
      data.business_number || "";
    document.getElementById("company-address").value = data.address || "";

    // 수수료 정보 (읽기 전용)
    document.getElementById("commission-rate").textContent =
      data.commission_rate !== null
        ? `${data.commission_rate}%`
        : "기본 수수료율";

    const statusEl = document.getElementById("account-status");
    statusEl.textContent = data.is_active ? "활성" : "비활성";
    statusEl.className = `status-badge ${
      data.is_active ? "active" : "inactive"
    }`;

    document.getElementById("created-date").textContent = data.created_at
      ? formatDate(data.created_at)
      : "-";
  }

  // 이벤트 리스너 설정
  setupEventListeners() {
    // 네비게이션 클릭
    document
      .querySelectorAll(".nav-item, .quick-btn[data-section]")
      .forEach((item) => {
        item.addEventListener("click", (e) => {
          e.preventDefault();
          const section = e.currentTarget.getAttribute("data-section");
          if (section) {
            this.showSection(section);
          }
        });
      });

    // 입찰 현황 필터
    document
      .getElementById("process-filter")
      ?.addEventListener("change", (e) => {
        this.filters.process = e.target.value;
        this.pagination.currentPage = 1;
        this.renderBidsSection();
      });

    document.getElementById("type-filter")?.addEventListener("change", (e) => {
      this.filters.type = e.target.value;
      this.pagination.currentPage = 1;
      this.renderBidsSection();
    });

    document.getElementById("date-filter")?.addEventListener("change", (e) => {
      this.filters.dateRange = parseInt(e.target.value);
      this.pagination.currentPage = 1;
      this.renderBidsSection();
    });

    // 필터 버튼
    document.getElementById("apply-filters")?.addEventListener("click", () => {
      this.pagination.currentPage = 1;
      this.renderBidsSection();
    });

    document.getElementById("reset-filters")?.addEventListener("click", () => {
      this.resetBidsFilters();
    });

    // 감정서 신청 모달
    this.setupAppraisalModal();

    // 계정 관리 폼
    this.setupAccountForms();

    console.log("이벤트 리스너 설정 완료");
  }

  // 입찰 필터 초기화
  resetBidsFilters() {
    this.filters = {
      process: "all",
      type: "all",
      dateRange: 30,
    };
    this.pagination.currentPage = 1;

    // UI 업데이트
    document.getElementById("process-filter").value = "all";
    document.getElementById("type-filter").value = "all";
    document.getElementById("date-filter").value = "30";

    this.renderBidsSection();
  }

  // 감정서 신청 모달 설정
  setupAppraisalModal() {
    const modal = setupModal("appraisalModal");
    if (!modal) return;

    // 감정서 신청 버튼 클릭
    document.addEventListener("click", (e) => {
      if (e.target.classList.contains("apply-appraisal-btn")) {
        this.handleAppraisalClick(e.target);
      }
    });

    // 확인 버튼
    document
      .getElementById("confirmAppraisal")
      ?.addEventListener("click", () => {
        this.processAppraisalRequest();
      });

    // 취소 버튼
    document
      .getElementById("cancelAppraisal")
      ?.addEventListener("click", () => {
        modal.hide();
      });
  }

  // 감정서 신청 버튼 클릭 처리
  handleAppraisalClick(button) {
    const bidId = button.dataset.bidId;
    const bidType = button.dataset.bidType;
    const brand = button.dataset.brand;
    const title = button.dataset.title;
    const image = button.dataset.image;
    const winningPrice = button.dataset.winningPrice;

    // 모달에 정보 설정
    document.getElementById("appraisal-product-image").src = image;
    document.getElementById("appraisal-brand").textContent = brand;
    document.getElementById("appraisal-title").textContent = title;
    document.getElementById("appraisal-price").textContent = `￥${formatNumber(
      winningPrice
    )}`;

    // 확인 버튼에 데이터 저장
    const confirmBtn = document.getElementById("confirmAppraisal");
    confirmBtn.dataset.bidId = bidId;
    confirmBtn.dataset.bidType = bidType;

    // 모달 표시
    const modal = setupModal("appraisalModal");
    modal.show();
  }

  // 감정서 신청 처리
  async processAppraisalRequest() {
    const confirmBtn = document.getElementById("confirmAppraisal");
    const bidId = confirmBtn.dataset.bidId;
    const bidType = confirmBtn.dataset.bidType;

    try {
      confirmBtn.disabled = true;
      confirmBtn.textContent = "처리 중...";

      const endpoint = bidType === "live" ? "live-bids" : "direct-bids";
      await API.fetchAPI(`/${endpoint}/${bidId}/request-appraisal`, {
        method: "POST",
      });

      alert("감정서 신청이 완료되었습니다.");

      // 모달 닫기
      const modal = setupModal("appraisalModal");
      modal.hide();

      // 데이터 새로고침
      await this.loadBidsData();
      if (this.currentSection === "bids") {
        this.renderBidsSection();
      } else if (this.currentSection === "dashboard") {
        this.renderDashboard();
      }
    } catch (error) {
      console.error("감정서 신청 실패:", error);
      alert("감정서 신청 중 오류가 발생했습니다.");
    } finally {
      confirmBtn.disabled = false;
      confirmBtn.textContent = "신청하기";
    }
  }

  // 계정 관리 폼 설정
  setupAccountForms() {
    // 기본 정보 수정
    document
      .getElementById("basic-info-form")
      ?.addEventListener("submit", async (e) => {
        e.preventDefault();
        await this.handleAccountUpdate("basic");
      });

    // 회사 정보 수정
    document
      .getElementById("company-info-form")
      ?.addEventListener("submit", async (e) => {
        e.preventDefault();
        await this.handleAccountUpdate("company");
      });

    // 비밀번호 변경
    document
      .getElementById("password-form")
      ?.addEventListener("submit", async (e) => {
        e.preventDefault();
        await this.handlePasswordChange();
      });
  }

  // 계정 정보 업데이트
  async handleAccountUpdate(formType) {
    try {
      let updateData = {};

      if (formType === "basic") {
        updateData = {
          email: document.getElementById("user-email").value,
          phone: document.getElementById("user-phone").value,
          registration_date: document.getElementById("registration-date").value,
        };
      } else if (formType === "company") {
        updateData = {
          company_name: document.getElementById("company-name").value,
          business_number: document.getElementById("business-number").value,
          address: document.getElementById("company-address").value,
        };
      }

      await API.fetchAPI(`/users/${this.userData.id}`, {
        method: "PUT",
        body: JSON.stringify(updateData),
      });

      alert("정보가 성공적으로 수정되었습니다.");

      // 사용자 데이터 새로고침
      await this.loadUserData();
      this.populateAccountForm();
    } catch (error) {
      console.error("계정 정보 수정 실패:", error);
      alert("정보 수정 중 오류가 발생했습니다.");
    }
  }

  // 비밀번호 변경
  async handlePasswordChange() {
    const currentPassword = document.getElementById("current-password").value;
    const newPassword = document.getElementById("new-password").value;
    const confirmPassword = document.getElementById("confirm-password").value;

    if (newPassword !== confirmPassword) {
      alert("새 비밀번호가 일치하지 않습니다.");
      return;
    }

    if (newPassword.length < 6) {
      alert("비밀번호는 6자 이상이어야 합니다.");
      return;
    }

    try {
      await API.fetchAPI(`/users/${this.userData.id}`, {
        method: "PUT",
        body: JSON.stringify({
          password: newPassword,
        }),
      });

      alert("비밀번호가 성공적으로 변경되었습니다.");

      // 폼 초기화
      document.getElementById("password-form").reset();
    } catch (error) {
      console.error("비밀번호 변경 실패:", error);
      alert("비밀번호 변경 중 오류가 발생했습니다.");
    }
  }
}

// 전역 변수
let myPageManager;

// DOM 로드 시 초기화
document.addEventListener("DOMContentLoaded", async () => {
  try {
    myPageManager = new MyPageManager();
    await myPageManager.initialize();
  } catch (error) {
    console.error("마이페이지 초기화 실패:", error);
    document.querySelector(".my-page-main").innerHTML =
      '<div class="error-message">페이지를 불러오는 중 오류가 발생했습니다. 새로고침 후 다시 시도해주세요.</div>';
  }
});

// 브라우저 뒤로가기/앞으로가기 처리
window.addEventListener("hashchange", () => {
  if (myPageManager) {
    const hash = window.location.hash.replace("#", "");
    const section = ["dashboard", "bids", "account"].includes(hash)
      ? hash
      : "dashboard";
    myPageManager.showSection(section);
  }
});
