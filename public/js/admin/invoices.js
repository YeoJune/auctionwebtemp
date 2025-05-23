// public/js/admin/invoices.js

// 상태 관리
const state = {
  currentPage: 1,
  limit: 10,
  totalPages: 1,
  filters: {
    status: "",
    auc_num: "",
    startDate: "",
    endDate: "",
  },
};

// 경매사 이름 매핑
const aucNames = {
  1: "EcoAuc",
  2: "BrandAuc",
  3: "StarAuc",
};

// 상태 이름 매핑
const statusNames = {
  paid: "결제 완료",
  unpaid: "미결제",
  partial: "부분 결제",
};

// 페이지 초기화
document.addEventListener("DOMContentLoaded", function () {
  // 인보이스 로드
  loadInvoices();

  // 이벤트 리스너 등록
  setupEventListeners();
});

// 이벤트 리스너 설정
function setupEventListeners() {
  // 필터 탭 클릭
  document.querySelectorAll(".filter-tab").forEach((tab) => {
    tab.addEventListener("click", function () {
      // 활성 탭 클래스 변경
      document
        .querySelectorAll(".filter-tab")
        .forEach((t) => t.classList.remove("active"));
      this.classList.add("active");

      // 상태 필터 적용
      state.filters.status = this.dataset.status;
      state.currentPage = 1;
      loadInvoices();
    });
  });

  // 필터 적용 버튼 클릭
  document
    .getElementById("apply-filters")
    .addEventListener("click", function () {
      // 필터 값 가져오기
      state.filters.auc_num = document.getElementById("auc-filter").value;
      state.filters.startDate = document.getElementById("date-from").value;
      state.filters.endDate = document.getElementById("date-to").value;

      // 첫 페이지부터 조회
      state.currentPage = 1;
      loadInvoices();
    });

  // 필터 초기화 버튼 클릭
  document
    .getElementById("reset-filters")
    .addEventListener("click", function () {
      // 필터 입력 초기화
      document.getElementById("auc-filter").value = "";
      document.getElementById("date-from").value = "";
      document.getElementById("date-to").value = "";

      // 상태 필터 초기화 (전체 탭 활성화)
      document.querySelectorAll(".filter-tab").forEach((tab) => {
        if (tab.dataset.status === "") {
          tab.classList.add("active");
        } else {
          tab.classList.remove("active");
        }
      });

      // 필터 상태 초기화
      state.filters = {
        status: "",
        auc_num: "",
        startDate: "",
        endDate: "",
      };

      // 첫 페이지부터 다시 조회
      state.currentPage = 1;
      loadInvoices();
    });

  // 인보이스 크롤링 버튼 클릭
  document
    .getElementById("crawlInvoicesBtn")
    .addEventListener("click", async function () {
      if (!confirm("인보이스 크롤링을 시작하시겠습니까?")) return;

      // 버튼 비활성화
      this.disabled = true;
      this.textContent = "크롤링 중...";

      try {
        // 크롤링 API 호출
        const result = await crawlInvoices();

        // 크롤링 결과 표시
        //     alert(`인보이스 크롤링이 완료되었습니다.
        // - EcoAuc: ${result.stats.ecoAucCount}개
        // - BrandAuc: ${result.stats.brandAucCount}개
        // - StarAuc: ${result.stats.starAucCount}개
        // - 총: ${result.stats.totalCount}개`);

        // 데이터 다시 로드
        loadInvoices();
      } catch (error) {
        console.error("크롤링 오류:", error);
        alert("인보이스 크롤링 중 오류가 발생했습니다.");
      } finally {
        // 버튼 상태 복원
        this.disabled = false;
        this.textContent = "인보이스 크롤링";
      }
    });
}

// 인보이스 목록 로드
async function loadInvoices() {
  // 로딩 표시
  showLoading("invoicesTableBody");

  try {
    // API 호출
    const response = await fetchInvoices(
      state.currentPage,
      state.limit,
      state.filters
    );

    // 응답 데이터를 테이블에 표시
    renderInvoicesTable(response.invoices || []);

    // 페이지네이션 업데이트
    renderPagination(
      response.pagination.currentPage,
      response.pagination.totalPages,
      response.pagination.total
    );

    // 페이지 상태 업데이트
    state.currentPage = response.pagination.currentPage;
    state.totalPages = response.pagination.totalPages;
  } catch (error) {
    console.error("인보이스 로드 오류:", error);
    showNoData(
      "invoicesTableBody",
      "인보이스 데이터를 불러오는 중 오류가 발생했습니다."
    );
    renderPagination(0, 0, 0);
  }
}

// 인보이스 테이블 렌더링
function renderInvoicesTable(invoices) {
  const tableBody = document.getElementById("invoicesTableBody");

  // 데이터가 없는 경우
  if (!invoices || invoices.length === 0) {
    tableBody.innerHTML =
      '<tr><td colspan="5" class="text-center">인보이스 데이터가 없습니다.</td></tr>';
    return;
  }

  // 테이블 내용 생성
  let html = "";

  invoices.forEach((invoice) => {
    // 날짜에서 시간 제거 (YYYY-MM-DD 형식만 사용)
    const dateStr = formatDate(invoice.date, true);

    html += `
          <tr>
            <td>${invoice.id || "-"}</td>
            <td>${dateStr}</td>
            <td>${aucNames[invoice.auc_num] || invoice.auc_num || "-"}</td>
            <td><span class="status-badge status-${
              invoice.status || "unknown"
            }">${
      statusNames[invoice.status] || invoice.status || "알 수 없음"
    }</span></td>
            <td>${invoice.amount ? formatCurrency(invoice.amount) : "-"}</td>
          </tr>
        `;
  });

  tableBody.innerHTML = html;
}

// 페이지네이션 렌더링 (direct-bids.js 스타일로 변경)
function renderPagination(currentPage, totalPages, totalItems) {
  const paginationContainer = document.getElementById("pagination");
  if (!paginationContainer) return;

  if (totalPages <= 1) {
    paginationContainer.innerHTML = "";
    return;
  }

  let html = `<div class="pagination-info">총 ${totalItems}개 항목 중 ${
    (currentPage - 1) * state.limit + 1
  } - ${Math.min(currentPage * state.limit, totalItems)}개 표시</div>`;
  html += '<div class="pagination-controls">';

  // 이전 페이지 버튼
  html += `<button class="btn btn-sm ${currentPage === 1 ? "disabled" : ""}" ${
    currentPage === 1
      ? "disabled"
      : 'onclick="goToPage(' + (currentPage - 1) + ')"'
  }>이전</button>`;

  // 페이지 번호 버튼들
  const maxPageButtons = 5;
  const startPage = Math.max(1, currentPage - Math.floor(maxPageButtons / 2));
  const endPage = Math.min(totalPages, startPage + maxPageButtons - 1);

  for (let i = startPage; i <= endPage; i++) {
    html += `<button class="btn btn-sm ${
      i === currentPage ? "active" : ""
    }" onclick="goToPage(${i})">${i}</button>`;
  }

  // 다음 페이지 버튼
  html += `<button class="btn btn-sm ${
    currentPage === totalPages ? "disabled" : ""
  }" ${
    currentPage === totalPages
      ? "disabled"
      : 'onclick="goToPage(' + (currentPage + 1) + ')"'
  }>다음</button>`;

  html += "</div>";

  paginationContainer.innerHTML = html;
}

// 페이지 이동
function goToPage(page) {
  if (page < 1 || page > state.totalPages) return;
  state.currentPage = page;
  loadInvoices();

  // 페이지 상단으로 스크롤
  window.scrollTo(0, 0);
}

// 로딩 표시
function showLoading(tableBodyId) {
  const tableBody = document.getElementById(tableBodyId);
  tableBody.innerHTML =
    '<tr><td colspan="5" class="text-center">데이터를 불러오는 중입니다...</td></tr>';
}

// 데이터 없음 표시
function showNoData(tableBodyId, message = "데이터가 없습니다.") {
  const tableBody = document.getElementById(tableBodyId);
  tableBody.innerHTML = `<tr><td colspan="5" class="text-center">${message}</td></tr>`;
}
