// public/js/admin-transactions.js

// =====================================================
// 상태 관리
// =====================================================
const state = {
  currentTab: "deposits", // 'deposits' or 'settlements'

  deposits: {
    currentPage: 1,
    itemsPerPage: 20,
    statusFilter: "",
    keyword: "",
    results: [],
    totalItems: 0,
    totalPages: 0,
    pendingCount: 0,
  },

  settlements: {
    currentPage: 1,
    itemsPerPage: 20,
    statusFilter: "",
    keyword: "",
    results: [],
    totalItems: 0,
    totalPages: 0,
    pendingCount: 0,
  },
};

let currentTransaction = null;
let currentSettlement = null;

// =====================================================
// 초기화
// =====================================================
async function initialize() {
  console.log("관리자 거래 내역 페이지 초기화");

  await window.API.initialize();

  setupEventListeners();
  await loadDeposits(); // 기본 탭 로드

  console.log("초기화 완료");
}

// =====================================================
// 이벤트 리스너
// =====================================================
function setupEventListeners() {
  // 탭 전환
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const tab = btn.getAttribute("data-tab");
      switchTab(tab);
    });
  });

  // 예치금 탭
  document
    .getElementById("depositSearchBtn")
    ?.addEventListener("click", handleDepositSearch);
  document
    .getElementById("depositClearBtn")
    ?.addEventListener("click", handleDepositClear);
  document
    .getElementById("depositSearchInput")
    ?.addEventListener("keypress", (e) => {
      if (e.key === "Enter") handleDepositSearch();
    });

  document.querySelectorAll("#depositsTab .filter-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      document
        .querySelectorAll("#depositsTab .filter-tab")
        .forEach((t) => t.classList.remove("active"));
      tab.classList.add("active");
      state.deposits.statusFilter = tab.getAttribute("data-status");
      state.deposits.currentPage = 1;
      loadDeposits();
    });
  });

  // 정산 탭
  document
    .getElementById("settlementSearchBtn")
    ?.addEventListener("click", handleSettlementSearch);
  document
    .getElementById("settlementClearBtn")
    ?.addEventListener("click", handleSettlementClear);
  document
    .getElementById("settlementSearchInput")
    ?.addEventListener("keypress", (e) => {
      if (e.key === "Enter") handleSettlementSearch();
    });

  document.querySelectorAll("#settlementsTab .filter-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      document
        .querySelectorAll("#settlementsTab .filter-tab")
        .forEach((t) => t.classList.remove("active"));
      tab.classList.add("active");
      state.settlements.statusFilter = tab.getAttribute("data-status");
      state.settlements.currentPage = 1;
      loadSettlements();
    });
  });

  // 모달
  setupDepositModalEvents();
  setupSettlementModalEvents();

  // 로그아웃
  document.getElementById("logoutBtn")?.addEventListener("click", async () => {
    await window.API.fetchAPI("/auth/signout", { method: "POST" });
    window.location.href = "/signin.html";
  });
}

// =====================================================
// 탭 전환
// =====================================================
function switchTab(tab) {
  state.currentTab = tab;

  // 탭 버튼 활성화
  document
    .querySelectorAll(".tab-btn")
    .forEach((btn) => btn.classList.remove("active"));
  document.querySelector(`[data-tab="${tab}"]`).classList.add("active");

  // 탭 콘텐츠 표시
  document
    .querySelectorAll(".tab-content")
    .forEach((content) => content.classList.remove("active"));
  if (tab === "deposits") {
    document.getElementById("depositsTab").classList.add("active");
    if (state.deposits.results.length === 0) loadDeposits();
  } else {
    document.getElementById("settlementsTab").classList.add("active");
    if (state.settlements.results.length === 0) loadSettlements();
  }
}

// =====================================================
// 예치금 거래 데이터 로드
// =====================================================
async function loadDeposits() {
  toggleLoading("deposit", true);

  try {
    const params = {
      page: state.deposits.currentPage,
      limit: state.deposits.itemsPerPage,
      status: state.deposits.statusFilter,
      keyword: state.deposits.keyword,
    };

    const queryString = window.API.createURLParams(params);
    const response = await window.API.fetchAPI(
      `/deposits/admin/transactions?${queryString}`,
    );

    state.deposits.results = response.transactions || [];
    state.deposits.totalItems = response.pagination?.totalItems || 0;
    state.deposits.totalPages = response.pagination?.totalPages || 0;
    state.deposits.pendingCount = response.pendingCount || 0;

    renderDeposits();
    renderDepositPagination();
  } catch (error) {
    console.error("예치금 거래 로드 실패:", error);
    alert("데이터를 불러오는 중 오류가 발생했습니다.");
  } finally {
    toggleLoading("deposit", false);
  }
}

function handleDepositSearch() {
  const keyword = document.getElementById("depositSearchInput").value.trim();
  state.deposits.keyword = keyword;
  state.deposits.currentPage = 1;
  loadDeposits();
}

function handleDepositClear() {
  document.getElementById("depositSearchInput").value = "";
  state.deposits.keyword = "";
  state.deposits.currentPage = 1;
  loadDeposits();
}

function renderDeposits() {
  const tbody = document.getElementById("depositTableBody");
  const totalElement = document.getElementById("depositTotalCount");
  const pendingBadge = document.getElementById("depositPendingBadge");
  const pendingCount = document.getElementById("depositPendingCount");

  totalElement.textContent = state.deposits.totalItems;

  if (state.deposits.pendingCount > 0) {
    pendingBadge.style.display = "inline-block";
    pendingCount.textContent = state.deposits.pendingCount;
  } else {
    pendingBadge.style.display = "none";
  }

  if (state.deposits.results.length === 0) {
    tbody.innerHTML =
      '<tr><td colspan="10" class="text-center">결과가 없습니다.</td></tr>';
    return;
  }

  tbody.innerHTML = state.deposits.results
    .map((tx) => {
      const typeText = getDepositTypeText(tx.type);
      const statusBadge = getDepositStatusBadge(tx.status);

      // 발행 상태 배지 (충전 거래만)
      let docBadge = "-";
      if (tx.type === "charge") {
        if (tx.doc_id) {
          if (tx.doc_status === "issued") {
            docBadge = `<span class="badge badge-success" title="승인번호: ${tx.confirm_num || "-"}">현금영수증</span>`;
          } else if (tx.doc_status === "failed") {
            docBadge = `<span class="badge badge-danger" title="${tx.error_message || "발행 실패"}" style="cursor: pointer;" onclick="retryDepositDocument(${tx.doc_id})">발행 실패 (재시도)</span>`;
          } else {
            docBadge = `<span class="badge badge-secondary">${tx.doc_status}</span>`;
          }
        } else if (tx.status === "confirmed") {
          // 승인됐는데 발행 정보가 없는 경우
          docBadge = `<span class="badge badge-warning" style="cursor: pointer;" onclick="issueDepositDocument(${tx.id})">미발행 (수동 발행)</span>`;
        }
      }

      let actionBtn = "";
      if (tx.status === "pending") {
        actionBtn = `
        <button class="btn btn-sm btn-success" onclick="openDepositApprovalModal(${tx.id}, '${tx.login_id || tx.user_id}', '${tx.type}', ${tx.amount})">
          <i class="fas fa-check"></i> 승인
        </button>
        <button class="btn btn-sm btn-danger" onclick="openDepositRejectionModal(${tx.id}, '${tx.login_id || tx.user_id}', '${tx.type}', ${tx.amount})">
          <i class="fas fa-times"></i> 거절
        </button>
      `;
      } else {
        actionBtn = '<span class="text-muted">-</span>';
      }

      return `
      <tr>
        <td>${tx.id}</td>
        <td>${tx.login_id || tx.user_id}<br>(${tx.company_name || "-"})</td>
        <td>${typeText}</td>
        <td class="text-right">₩${tx.amount.toLocaleString()}</td>
        <td>${tx.depositor_name || "-"}</td>
        <td>${statusBadge}</td>
        <td>${docBadge}</td>
        <td>${formatDateTime(tx.created_at)}</td>
        <td>
          <small>${tx.description || "-"}</small>
          ${tx.admin_memo ? `<br/><span class="admin-memo">${tx.admin_memo}</span>` : ""}
        </td>
        <td>${actionBtn}</td>
      </tr>
    `;
    })
    .join("");
}

function renderDepositPagination() {
  renderPagination(
    "depositPagination",
    state.deposits.currentPage,
    state.deposits.totalPages,
    (page) => {
      state.deposits.currentPage = page;
      loadDeposits();
    },
  );
}

// =====================================================
// 정산 데이터 로드
// =====================================================
async function loadSettlements() {
  toggleLoading("settlement", true);

  try {
    const params = {
      page: state.settlements.currentPage,
      limit: state.settlements.itemsPerPage,
      status: state.settlements.statusFilter,
      keyword: state.settlements.keyword,
    };

    const queryString = window.API.createURLParams(params);
    const response = await window.API.fetchAPI(
      `/deposits/admin/settlements?${queryString}`,
    );

    state.settlements.results = response.settlements || [];
    state.settlements.totalItems = response.pagination?.totalItems || 0;
    state.settlements.totalPages = response.pagination?.totalPages || 0;
    state.settlements.pendingCount = response.pendingCount || 0;

    renderSettlements();
    renderSettlementPagination();
  } catch (error) {
    console.error("정산 내역 로드 실패:", error);
    alert("데이터를 불러오는 중 오류가 발생했습니다.");
  } finally {
    toggleLoading("settlement", false);
  }
}

function handleSettlementSearch() {
  const keyword = document.getElementById("settlementSearchInput").value.trim();
  state.settlements.keyword = keyword;
  state.settlements.currentPage = 1;
  loadSettlements();
}

function handleSettlementClear() {
  document.getElementById("settlementSearchInput").value = "";
  state.settlements.keyword = "";
  state.settlements.currentPage = 1;
  loadSettlements();
}
function renderSettlements() {
  const tbody = document.getElementById("settlementTableBody");
  const totalElement = document.getElementById("settlementTotalCount");
  const pendingBadge = document.getElementById("settlementPendingBadge");
  const pendingCount = document.getElementById("settlementPendingCount");

  totalElement.textContent = state.settlements.totalItems;

  if (state.settlements.pendingCount > 0) {
    pendingBadge.style.display = "inline-block";
    pendingCount.textContent = state.settlements.pendingCount;
  } else {
    pendingBadge.style.display = "none";
  }

  if (state.settlements.results.length === 0) {
    tbody.innerHTML =
      '<tr><td colspan="10" class="text-center">결과가 없습니다.</td></tr>';
    return;
  }

  tbody.innerHTML = state.settlements.results
    .map((st) => {
      const remaining = st.final_amount - (st.completed_amount || 0);
      const statusBadge = getPaymentStatusBadge(st.payment_status);

      // 발행 상태 배지
      let docBadge = "-";
      if (st.doc_id) {
        if (st.doc_status === "issued") {
          docBadge = `<span class="badge badge-success" title="승인번호: ${st.confirm_num || "-"}">${st.doc_type === "taxinvoice" ? "세금계산서" : "현금영수증"}</span>`;
        } else if (st.doc_status === "failed") {
          docBadge = `<span class="badge badge-danger" title="${st.error_message || "발행 실패"}" style="cursor: pointer;" onclick="retryDocumentIssue(${st.doc_id})">발행 실패 (재시도)</span>`;
        } else {
          docBadge = `<span class="badge badge-secondary">${st.doc_status}</span>`;
        }
      } else if (st.payment_status === "paid") {
        // 완납인데 발행 정보가 없는 경우
        const expectedDocType = st.business_number
          ? "세금계산서"
          : "현금영수증";
        docBadge = `<span class="badge badge-warning" style="cursor: pointer;" onclick="issueDocumentManually(${st.id}, '${st.business_number ? "taxinvoice" : "cashbill"}')">미발행 (수동 발행)</span>`;
      }

      // 모든 상태에서 수동 처리 버튼 표시
      const actionBtn = `
        <button 
          class="btn btn-sm btn-primary" 
          onclick="openSettlementApprovalModal(${st.id}, '${st.login_id || st.user_id}', '${st.settlement_date}', ${st.final_amount}, ${st.completed_amount || 0}, '${st.depositor_name || ""}', '${st.payment_status}')"
          title="정산 처리"
        >
          <i class="fas fa-hand-holding-usd"></i> 처리
        </button>
      `;

      return `
      <tr>
        <td>${st.id}</td>
        <td>${st.login_id || st.user_id}<br>(${st.company_name || "-"})</td>
        <td>${st.settlement_date}</td>
        <td class="text-right">₩${st.final_amount.toLocaleString()}</td>
        <td class="text-right">₩${(st.completed_amount || 0).toLocaleString()}</td>
        <td class="text-right text-danger">₩${remaining.toLocaleString()}</td>
        <td>${st.depositor_name || "-"}</td>
        <td>${statusBadge}</td>
        <td>${docBadge}</td>
        <td>${actionBtn}</td>
      </tr>
    `;
    })
    .join("");
}

function renderSettlementPagination() {
  renderPagination(
    "settlementPagination",
    state.settlements.currentPage,
    state.settlements.totalPages,
    (page) => {
      state.settlements.currentPage = page;
      loadSettlements();
    },
  );
}

// =====================================================
// 예치금 승인/거절 모달
// =====================================================
function setupDepositModalEvents() {
  document
    .getElementById("depositModalClose")
    ?.addEventListener("click", closeDepositModal);
  document
    .getElementById("depositActionCancel")
    ?.addEventListener("click", closeDepositModal);
  document
    .getElementById("depositApproveBtn")
    ?.addEventListener("click", approveDeposit);
  document
    .getElementById("depositRejectBtn")
    ?.addEventListener("click", rejectDeposit);
}

function openDepositApprovalModal(id, userId, type, amount) {
  currentTransaction = { id, userId, type, amount, action: "approve" };

  document.getElementById("depositActionTitle").textContent = "거래 승인";
  document.getElementById("txUserId").textContent = userId;
  document.getElementById("txType").textContent = getDepositTypeText(type);
  document.getElementById("txAmount").textContent =
    `₩${amount.toLocaleString()}`;

  document.getElementById("rejectReasonGroup").style.display = "none";
  document.getElementById("depositApproveBtn").style.display = "inline-block";
  document.getElementById("depositRejectBtn").style.display = "none";

  document.getElementById("depositActionModal").style.display = "flex";
}

function openDepositRejectionModal(id, userId, type, amount) {
  currentTransaction = { id, userId, type, amount, action: "reject" };

  document.getElementById("depositActionTitle").textContent = "거래 거절";
  document.getElementById("txUserId").textContent = userId;
  document.getElementById("txType").textContent = getDepositTypeText(type);
  document.getElementById("txAmount").textContent =
    `₩${amount.toLocaleString()}`;

  document.getElementById("rejectReasonGroup").style.display = "block";
  document.getElementById("depositApproveBtn").style.display = "none";
  document.getElementById("depositRejectBtn").style.display = "inline-block";

  document.getElementById("depositActionModal").style.display = "flex";
}

function closeDepositModal() {
  document.getElementById("depositActionModal").style.display = "none";
  document.getElementById("rejectReason").value = "";
  currentTransaction = null;
}

async function approveDeposit() {
  if (!currentTransaction) return;

  if (
    !confirm(
      `${currentTransaction.userId}의 ${getDepositTypeText(currentTransaction.type)} 요청을 승인하시겠습니까?`,
    )
  ) {
    return;
  }

  try {
    await window.API.fetchAPI(
      `/deposits/admin/approve/${currentTransaction.id}`,
      { method: "POST" },
    );

    alert("승인되었습니다.");
    closeDepositModal();
    await loadDeposits();
  } catch (error) {
    console.error("승인 실패:", error);
    alert("승인 중 오류가 발생했습니다.\n" + (error.message || ""));
  }
}

async function rejectDeposit() {
  if (!currentTransaction) return;

  const reason =
    document.getElementById("rejectReason").value.trim() || "관리자 거절";

  if (
    !confirm(
      `${currentTransaction.userId}의 ${getDepositTypeText(currentTransaction.type)} 요청을 거절하시겠습니까?`,
    )
  ) {
    return;
  }

  try {
    await window.API.fetchAPI(
      `/deposits/admin/reject/${currentTransaction.id}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      },
    );

    alert("거절되었습니다.");
    closeDepositModal();
    await loadDeposits();
  } catch (error) {
    console.error("거절 실패:", error);
    alert("거절 중 오류가 발생했습니다.\n" + (error.message || ""));
  }
}

// =====================================================
// 정산 승인 모달
// =====================================================
function setupSettlementModalEvents() {
  document
    .getElementById("settlementModalClose")
    ?.addEventListener("click", closeSettlementModal);
  document
    .getElementById("settlementActionCancel")
    ?.addEventListener("click", closeSettlementModal);
  document
    .getElementById("settlementApproveBtn")
    ?.addEventListener("click", approveSettlement);
}

function openSettlementApprovalModal(
  id,
  userId,
  date,
  total,
  completed,
  depositorName = null,
  paymentStatus = "unpaid",
) {
  currentSettlement = {
    id,
    userId,
    date,
    total,
    completed,
    remaining: total - completed,
    depositorName,
    paymentStatus,
  };

  // 상태에 따른 모달 제목 변경
  const modalTitle = document.querySelector(
    "#settlementApprovalModal .modal-header h3",
  );
  if (modalTitle) {
    if (paymentStatus === "pending") {
      modalTitle.textContent = "입금 확인 및 승인";
    } else if (paymentStatus === "paid") {
      modalTitle.textContent = "추가 입금 처리";
    } else {
      modalTitle.textContent = "정산 수동 처리";
    }
  }

  // 상태에 따른 버튼 텍스트 변경
  const approveBtn = document.getElementById("settlementApproveBtn");
  if (approveBtn) {
    const iconHTML = '<i class="fas fa-check"></i> ';
    if (paymentStatus === "pending") {
      approveBtn.innerHTML = iconHTML + "승인";
    } else if (paymentStatus === "paid") {
      approveBtn.innerHTML = iconHTML + "추가 처리";
    } else {
      approveBtn.innerHTML = iconHTML + "처리";
    }
  }

  document.getElementById("stUserId").textContent = userId;
  document.getElementById("stDate").textContent = date;
  document.getElementById("stTotal").textContent = `₩${total.toLocaleString()}`;
  document.getElementById("stCompleted").textContent =
    `₩${completed.toLocaleString()}`;
  document.getElementById("stRemaining").textContent =
    `₩${(total - completed).toLocaleString()}`;

  // 현재 입금자명 표시
  document.getElementById("stCurrentDepositorName").textContent =
    depositorName || "-";

  // 입력 필드 초기화
  document.getElementById("stDepositorName").value = "";
  document.getElementById("stPaymentAmount").value = ""; // 빈 값으로 설정 (전액 처리)
  document.getElementById("stAdminMemo").value = "";

  document.getElementById("settlementApprovalModal").style.display = "flex";
}

function closeSettlementModal() {
  document.getElementById("settlementApprovalModal").style.display = "none";
  currentSettlement = null;
}

async function approveSettlement() {
  if (!currentSettlement) return;

  const depositorName = document.getElementById("stDepositorName").value.trim();
  const paymentAmountStr = document
    .getElementById("stPaymentAmount")
    .value.trim();
  const memo = document.getElementById("stAdminMemo").value.trim();

  // 입금액 처리 (미입력 시 undefined로 전송하여 백엔드에서 전액 처리)
  const paymentAmount =
    paymentAmountStr && paymentAmountStr !== ""
      ? parseInt(paymentAmountStr)
      : undefined;

  // 입금액이 입력된 경우 유효성 검사
  if (paymentAmount !== undefined) {
    if (paymentAmount <= 0) {
      alert("입금 금액은 0보다 커야 합니다.");
      return;
    }

    if (paymentAmount > currentSettlement.remaining) {
      alert(
        `입금 금액(₩${paymentAmount.toLocaleString()})이 남은 결제액(₩${currentSettlement.remaining.toLocaleString()})을 초과할 수 없습니다.`,
      );
      return;
    }
  }

  // 확인 메시지
  const amountText = paymentAmount
    ? `₩${paymentAmount.toLocaleString()}`
    : `₩${currentSettlement.remaining.toLocaleString()} (전액)`;
  const depositorText = depositorName ? `\n입금자: ${depositorName}` : "";

  if (
    !confirm(
      `${currentSettlement.userId}의 정산을 처리하시겠습니까?\n금액: ${amountText}${depositorText}`,
    )
  ) {
    return;
  }

  try {
    // 백엔드 API 호출
    const requestBody = {
      admin_memo: memo || "수동 정산 처리",
    };

    // 선택적 파라미터 추가
    if (depositorName) {
      requestBody.depositor_name = depositorName;
    }
    if (paymentAmount !== undefined) {
      requestBody.payment_amount = paymentAmount;
    }

    const response = await window.API.fetchAPI(
      `/bid-results/admin/settlements/${currentSettlement.id}`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      },
    );

    if (response && response.settlement) {
      const paymentInfo = response.payment_info || {};
      alert(
        `정산 처리가 완료되었습니다.\n\n` +
          `처리 금액: ₩${(paymentInfo.payment_amount || 0).toLocaleString()}\n` +
          `누적 결제액: ₩${(paymentInfo.new_completed || 0).toLocaleString()}\n` +
          `남은 금액: ₩${(paymentInfo.remaining || 0).toLocaleString()}\n` +
          `상태: ${paymentInfo.status === "paid" ? "결제 완료" : paymentInfo.status === "pending" ? "부분 입금" : "미결제"}`,
      );
      closeSettlementModal();
      await loadSettlements();
    } else {
      throw new Error(response.message || "정산 처리에 실패했습니다.");
    }
  } catch (error) {
    console.error("정산 처리 실패:", error);
    alert("정산 처리 중 오류가 발생했습니다.\n" + (error.message || ""));
  }
}

// =====================================================
// 유틸리티
// =====================================================
function toggleLoading(type, show) {
  const id = type === "deposit" ? "depositLoadingMsg" : "settlementLoadingMsg";
  const loading = document.getElementById(id);
  if (loading) loading.style.display = show ? "block" : "none";
}

function renderPagination(containerId, currentPage, totalPages, onPageChange) {
  const container = document.getElementById(containerId);
  if (!container || totalPages <= 1) {
    if (container) container.innerHTML = "";
    return;
  }

  let html = "";
  if (currentPage > 1) {
    html += `<button class="page-btn" data-page="${currentPage - 1}">이전</button>`;
  }

  const start = Math.max(1, currentPage - 2);
  const end = Math.min(totalPages, currentPage + 2);

  for (let i = start; i <= end; i++) {
    html += `<button class="page-btn ${i === currentPage ? "active" : ""}" data-page="${i}">${i}</button>`;
  }

  if (currentPage < totalPages) {
    html += `<button class="page-btn" data-page="${currentPage + 1}">다음</button>`;
  }

  container.innerHTML = html;

  // 클릭 핸들러 등록
  container.querySelectorAll(".page-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const page = parseInt(btn.getAttribute("data-page"));
      onPageChange(page);
    });
  });
}

function getDepositTypeText(type) {
  const map = { charge: "충전", refund: "환불", deduct: "차감" };
  return map[type] || type;
}

function getDepositStatusBadge(status) {
  const map = {
    pending: '<span class="status-badge status-pending">대기 중</span>',
    confirmed: '<span class="status-badge status-confirmed">승인 완료</span>',
    rejected: '<span class="status-badge status-rejected">거절됨</span>',
  };
  return map[status] || status;
}

function getPaymentStatusBadge(status) {
  const map = {
    unpaid: '<span class="status-badge status-unpaid">미결제</span>',
    pending: '<span class="status-badge status-pending">확인 중</span>',
    paid: '<span class="status-badge status-paid">완료</span>',
  };
  return map[status] || status;
}

function formatDateTime(dateString) {
  const date = new Date(dateString);
  return date.toLocaleString("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// =====================================================
// 문서 발행 관련 함수
// =====================================================

/**
 * 문서 재발행 (실패한 경우)
 */
async function retryDocumentIssue(docId) {
  if (!confirm("문서를 재발행하시겠습니까?")) {
    return;
  }

  try {
    const response = await window.API.fetchAPI(
      `/popbill/admin/retry-issue/${docId}`,
      { method: "POST" },
    );

    if (response.success) {
      alert(`재발행 성공!\n승인번호: ${response.confirmNum || "-"}`);
      await loadSettlements();
    } else {
      alert("재발행에 실패했습니다.");
    }
  } catch (error) {
    console.error("재발행 실패:", error);
    alert("재발행 중 오류가 발생했습니다.\n" + (error.message || ""));
  }
}

/**
 * 문서 수동 발행 (미발행 상태인 경우)
 */
async function issueDocumentManually(settlementId, docType) {
  const docTypeName = docType === "taxinvoice" ? "세금계산서" : "현금영수증";

  if (!confirm(`${docTypeName}을(를) 발행하시겠습니까?`)) {
    return;
  }

  try {
    const endpoint =
      docType === "taxinvoice"
        ? "/popbill/admin/issue-taxinvoice"
        : "/popbill/admin/issue-cashbill-settlement";

    const body = { settlement_id: settlementId };

    const response = await window.API.fetchAPI(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (response.success) {
      alert(
        `${docTypeName} 발행 성공!\n승인번호: ${response.confirmNum || response.ntsConfirmNum || "-"}`,
      );
      await loadSettlements();
    } else {
      alert(`${docTypeName} 발행에 실패했습니다.`);
    }
  } catch (error) {
    console.error("발행 실패:", error);
    alert(
      `${docTypeName} 발행 중 오류가 발생했습니다.\n` + (error.message || ""),
    );
  }
}

/**
 * 예치금 문서 재발행
 */
async function retryDepositDocument(docId) {
  if (!confirm("현금영수증을 재발행하시겠습니까?")) {
    return;
  }

  try {
    const response = await window.API.fetchAPI(
      `/popbill/admin/retry-issue/${docId}`,
      { method: "POST" },
    );

    if (response.success) {
      alert(`재발행 성공!\n승인번호: ${response.confirmNum || "-"}`);
      await loadDeposits();
    } else {
      alert("재발행에 실패했습니다.");
    }
  } catch (error) {
    console.error("재발행 실패:", error);
    alert("재발행 중 오류가 발생했습니다.\n" + (error.message || ""));
  }
}

/**
 * 예치금 문서 수동 발행
 */
async function issueDepositDocument(transactionId) {
  if (!confirm("현금영수증을 발행하시겠습니까?")) {
    return;
  }

  try {
    const response = await window.API.fetchAPI(
      "/popbill/admin/issue-cashbill",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transaction_id: transactionId }),
      },
    );

    if (response.success) {
      alert(`현금영수증 발행 성공!\n승인번호: ${response.confirmNum || "-"}`);
      await loadDeposits();
    } else {
      alert("현금영수증 발행에 실패했습니다.");
    }
  } catch (error) {
    console.error("발행 실패:", error);
    alert("현금영수증 발행 중 오류가 발생했습니다.\n" + (error.message || ""));
  }
}

// =====================================================
// 전역 함수
// =====================================================
window.openDepositApprovalModal = openDepositApprovalModal;
window.openDepositRejectionModal = openDepositRejectionModal;
window.openSettlementApprovalModal = openSettlementApprovalModal;
window.retryDocumentIssue = retryDocumentIssue;
window.issueDocumentManually = issueDocumentManually;
window.retryDepositDocument = retryDepositDocument;
window.issueDepositDocument = issueDepositDocument;

// =====================================================
// 초기화
// =====================================================
document.addEventListener("DOMContentLoaded", initialize);
