// public/js/appr-admin/payments.js - 결제 관리 관련 기능

// 전역 변수
let currentPaymentPage = 1;
let paymentSearchQuery = "";
let paymentStatusFilter = "all";
let paymentTypeFilter = "all";

// 페이지 로드 시 이벤트 리스너 설정
document.addEventListener("DOMContentLoaded", function () {
  // 검색 버튼 이벤트
  document
    .getElementById("payment-search-btn")
    .addEventListener("click", function () {
      paymentSearchQuery = document.getElementById("payment-search").value;
      currentPaymentPage = 1;
      loadPaymentList();
    });

  // 검색창 엔터 이벤트
  document
    .getElementById("payment-search")
    .addEventListener("keypress", function (e) {
      if (e.key === "Enter") {
        paymentSearchQuery = this.value;
        currentPaymentPage = 1;
        loadPaymentList();
      }
    });

  // 상태 필터 변경 이벤트
  document
    .getElementById("payment-status-filter")
    .addEventListener("change", function () {
      paymentStatusFilter = this.value;
      currentPaymentPage = 1;
      loadPaymentList();
    });

  // 유형 필터 변경 이벤트
  document
    .getElementById("payment-type-filter")
    .addEventListener("change", function () {
      paymentTypeFilter = this.value;
      currentPaymentPage = 1;
      loadPaymentList();
    });
});

// 결제 목록 로드 함수
function loadPaymentList() {
  // 로딩 표시
  document.getElementById("payments-list").innerHTML =
    '<tr><td colspan="8" style="text-align: center;">결제 데이터를 불러오는 중...</td></tr>';

  // API URL 생성
  let url = `/api/appr/admin/payments?page=${currentPaymentPage}&limit=10`;

  // 필터 적용
  if (paymentStatusFilter !== "all") {
    url += `&status=${paymentStatusFilter}`;
  }

  if (paymentTypeFilter !== "all") {
    url += `&type=${paymentTypeFilter}`;
  }

  // 검색어 적용
  if (paymentSearchQuery) {
    url += `&search=${encodeURIComponent(paymentSearchQuery)}`;
  }

  // API 호출
  fetch(url)
    .then((response) => {
      if (!response.ok) {
        throw new Error("결제 목록을 불러오는데 실패했습니다.");
      }
      return response.json();
    })
    .then((data) => {
      if (data.success) {
        displayPaymentList(data.payments, data.pagination);
      } else {
        throw new Error(data.message || "결제 목록을 불러오는데 실패했습니다.");
      }
    })
    .catch((error) => {
      document.getElementById(
        "payments-list"
      ).innerHTML = `<tr><td colspan="8" style="text-align: center;">오류: ${error.message}</td></tr>`;
    });
}

// 결제 목록 표시 함수
function displayPaymentList(payments, pagination) {
  const tableBody = document.getElementById("payments-list");

  // 데이터가 없는 경우
  if (!payments || payments.length === 0) {
    tableBody.innerHTML =
      '<tr><td colspan="8" style="text-align: center;">결제 내역이 없습니다.</td></tr>';
    document.getElementById("payments-pagination").innerHTML = "";
    return;
  }

  // 테이블 내용 생성
  let html = "";
  payments.forEach((payment) => {
    // 결제 상태에 따른 배지 설정
    let statusBadgeClass = "badge-info";
    if (payment.status === "completed") {
      statusBadgeClass = "badge-success";
    } else if (
      payment.status === "failed" ||
      payment.status.includes("failed") ||
      payment.status.includes("error") ||
      payment.status.includes("mismatch")
    ) {
      statusBadgeClass = "badge-error";
    } else if (payment.status === "cancelled") {
      statusBadgeClass = "badge-warning";
    } else if (payment.status === "vbank_ready") {
      statusBadgeClass = "badge-info";
    } else if (payment.status === "vbank_expired") {
      statusBadgeClass = "badge-error";
    }

    // 결제 유형 한글화
    let productTypeKorean = "기타";
    if (payment.product_type === "quicklink_subscription") {
      productTypeKorean = "퀵링크 구독";
    } else if (payment.product_type === "certificate_issue") {
      productTypeKorean = "감정서 발급";
    } else if (payment.product_type === "restoration_service") {
      productTypeKorean = "복원 서비스";
    }

    html += `<tr>
            <td>${payment.order_id}</td>
            <td>${
              payment.user_email || payment.company_name || payment.user_id
            }</td>
            <td>${productTypeKorean}</td>
            <td>${payment.product_name}</td>
            <td>${payment.amount.toLocaleString()}원</td>
            <td><span class="badge ${statusBadgeClass}">${getPaymentStatusText(
      payment.status
    )}</span></td>
            <td>${
              formatDate(payment.paid_at) || formatDate(payment.created_at)
            }</td>
            <td>
                <button class="btn btn-outline" onclick="viewPaymentDetail('${
                  payment.id
                }')">상세</button>
            </td>
        </tr>`;
  });

  tableBody.innerHTML = html;

  // 페이지네이션 생성
  createPagination(
    "payments-pagination",
    pagination.currentPage,
    pagination.totalPages,
    (page) => {
      currentPaymentPage = page;
      loadPaymentList();
    }
  );
}

// 결제 상태 텍스트 변환 함수
function getPaymentStatusText(status) {
  const statusMap = {
    pending: "처리중",
    ready: "결제 대기",
    completed: "완료",
    failed: "실패",
    cancelled: "취소",
    auth_failed: "인증 실패",
    auth_signature_mismatch: "서명 불일치",
    approval_signature_mismatch: "승인 서명 불일치",
    server_error: "서버 오류",
    approval_api_failed: "API 오류",
    vbank_ready: "가상계좌 발급",
    vbank_expired: "가상계좌 만료",
  };

  return statusMap[status] || status;
}

// 결제 상세 조회 함수
function viewPaymentDetail(paymentId) {
  // 모달 내용 초기화
  document.getElementById("payment-detail-content").innerHTML =
    '<p style="text-align: center;">결제 정보를 불러오는 중...</p>';

  // 모달 표시
  openModal("payment-detail-modal");

  // API 호출
  fetch(`/api/appr/admin/payments/${paymentId}`)
    .then((response) => {
      if (!response.ok) {
        throw new Error("결제 정보를 불러오는데 실패했습니다.");
      }
      return response.json();
    })
    .then((data) => {
      if (data.success) {
        displayPaymentDetail(data.payment, data.related_resource);
      } else {
        throw new Error(data.message || "결제 정보를 불러오는데 실패했습니다.");
      }
    })
    .catch((error) => {
      document.getElementById(
        "payment-detail-content"
      ).innerHTML = `<p style="text-align: center;">오류: ${error.message}</p>`;
    });
}

// 결제 상세 정보 표시 함수
function displayPaymentDetail(payment, relatedResource) {
  const container = document.getElementById("payment-detail-content");

  // 결제 유형 한글화
  let productTypeKorean = "기타";
  if (payment.product_type === "quicklink_subscription") {
    productTypeKorean = "퀵링크 구독";
  } else if (payment.product_type === "certificate_issue") {
    productTypeKorean = "감정서 발급";
  } else if (payment.product_type === "restoration_service") {
    productTypeKorean = "복원 서비스";
  }

  // 결제 기본 정보 섹션
  let html = `
    <div class="card" style="margin-bottom: 20px;">
        <div class="card-header">
            <div class="card-title">결제 기본 정보</div>
        </div>
        <table>
            <tr>
                <th style="width: 120px;">결제 ID</th>
                <td>${payment.id}</td>
                <th style="width: 120px;">주문번호</th>
                <td>${payment.order_id}</td>
            </tr>
            <tr>
                <th>회원 정보</th>
                <td>${
                  payment.user_email || payment.company_name || payment.user_id
                }</td>
                <th>결제 상태</th>
                <td><span class="badge ${
                  payment.status === "completed"
                    ? "badge-success"
                    : payment.status === "failed"
                    ? "badge-error"
                    : "badge-info"
                }">${getPaymentStatusText(payment.status)}</span></td>
            </tr>
            <tr>
                <th>상품 유형</th>
                <td>${productTypeKorean}</td>
                <th>상품명</th>
                <td>${payment.product_name}</td>
            </tr>
            <tr>
                <th>결제 금액</th>
                <td>${payment.amount.toLocaleString()}원</td>
                <th>결제 수단</th>
                <td>${payment.payment_method || "-"}</td>
            </tr>
            <tr>
                <th>결제 일시</th>
                <td>${formatDate(payment.paid_at) || "-"}</td>
                <th>생성 일시</th>
                <td>${formatDate(payment.created_at)}</td>
            </tr>
            ${
              payment.receipt_url
                ? `
            <tr>
                <th>영수증</th>
                <td colspan="3"><a href="${payment.receipt_url}" target="_blank">영수증 보기</a></td>
            </tr>`
                : ""
            }
        </table>
    </div>
    `;

  // 연관 리소스 정보 추가
  if (relatedResource && relatedResource.type) {
    let resourceType = relatedResource.type;
    let resourceLabel = "알 수 없음";
    let resourceDetailHtml = "";

    if (resourceType === "appraisal") {
      resourceLabel = "감정 정보";
      if (relatedResource.data) {
        const appraisal = relatedResource.data;
        resourceDetailHtml = `
          <tr>
            <th>인증서 번호</th>
            <td>${appraisal.certificate_number || "-"}</td>
          </tr>
          <tr>
            <th>브랜드/모델명</th>
            <td>${appraisal.brand || "-"} / ${appraisal.model_name || "-"}</td>
          </tr>
          <tr>
            <th>감정 상태</th>
            <td>${getStatusBadge(appraisal.status)}</td>
          </tr>
        `;
      }
    } else if (resourceType === "restoration") {
      resourceLabel = "복원 정보";
      if (relatedResource.data) {
        const restoration = relatedResource.data;
        resourceDetailHtml = `
          <tr>
            <th>인증서 번호</th>
            <td>${restoration.certificate_number || "-"}</td>
          </tr>
          <tr>
            <th>복원 상태</th>
            <td>${getStatusBadge(restoration.status)}</td>
          </tr>
          <tr>
            <th>서비스 개수</th>
            <td>${restoration.services ? restoration.services.length : 0}개</td>
          </tr>
        `;
      }
    }

    html += `
        <div class="card" style="margin-bottom: 20px;">
            <div class="card-header">
                <div class="card-title">${resourceLabel}</div>
            </div>
            <table>
                <tr>
                    <th style="width: 120px;">리소스 ID</th>
                    <td>${payment.related_resource_id}</td>
                </tr>
                ${resourceDetailHtml}
            </table>
        </div>
        `;
  } else if (payment.related_resource_id) {
    // 새 API 응답 형식에서 관련 리소스 정보가 없지만 ID가 있는 경우
    let resourceType = payment.related_resource_type || "알 수 없음";
    let resourceLabel = "알 수 없음";

    if (resourceType === "appraisal") {
      resourceLabel = "감정 ID";
    } else if (resourceType === "restoration") {
      resourceLabel = "복원 요청 ID";
    }

    html += `
        <div class="card" style="margin-bottom: 20px;">
            <div class="card-header">
                <div class="card-title">연관 정보</div>
            </div>
            <table>
                <tr>
                    <th style="width: 120px;">리소스 유형</th>
                    <td>${resourceType}</td>
                </tr>
                <tr>
                    <th>${resourceLabel}</th>
                    <td>${payment.related_resource_id}</td>
                </tr>
            </table>
        </div>
        `;
  }

  // 카드 정보 표시
  if (payment.card_info && Object.keys(payment.card_info).length > 0) {
    html += `
        <div class="card" style="margin-bottom: 20px;">
            <div class="card-header">
                <div class="card-title">카드 결제 정보</div>
            </div>
            <table>
    `;

    const cardInfo = payment.card_info;

    if (cardInfo.cardCompany || cardInfo.cardName) {
      html += `
        <tr>
            <th style="width: 120px;">카드사</th>
            <td>${cardInfo.cardCompany || cardInfo.cardName || "-"}</td>
        </tr>
      `;
    }

    if (cardInfo.cardNum) {
      html += `
        <tr>
            <th>카드번호</th>
            <td>${cardInfo.cardNum}</td>
        </tr>
      `;
    }

    if (cardInfo.cardQuota) {
      html += `
        <tr>
            <th>할부개월</th>
            <td>${
              cardInfo.cardQuota === "00"
                ? "일시불"
                : cardInfo.cardQuota + "개월"
            }</td>
        </tr>
      `;
    }

    html += `
            </table>
        </div>
    `;
  }

  // PG사 거래 정보 추가
  if (payment.payment_gateway_transaction_id || payment.raw_response_data) {
    html += `
        <div class="card" style="margin-bottom: 20px;">
            <div class="card-header">
                <div class="card-title">PG사 거래 정보</div>
            </div>
            <table>`;

    if (payment.payment_gateway_transaction_id) {
      html += `
                <tr>
                    <th style="width: 120px;">거래번호</th>
                    <td>${payment.payment_gateway_transaction_id}</td>
                </tr>`;
    }

    if (payment.raw_response_data) {
      let rawDataHtml = "";
      try {
        // JSON 데이터를 예쁘게 포맷팅해 표시
        const rawData =
          typeof payment.raw_response_data === "string"
            ? JSON.parse(payment.raw_response_data)
            : payment.raw_response_data;

        rawDataHtml = `<pre style="max-height: 300px; overflow-y: auto; background-color: #f8fafc; padding: 10px; border-radius: 4px; font-size: 0.85rem;">${JSON.stringify(
          rawData,
          null,
          2
        )}</pre>`;
      } catch (error) {
        rawDataHtml = `<pre style="max-height: 300px; overflow-y: auto; background-color: #f8fafc; padding: 10px; border-radius: 4px; font-size: 0.85rem;">${payment.raw_response_data}</pre>`;
      }

      html += `
                <tr>
                    <th>원본 응답</th>
                    <td>${rawDataHtml}</td>
                </tr>`;
    }

    html += `
            </table>
        </div>
        `;
  }

  // 하단 닫기 버튼
  html += `
    <div style="margin-top: 20px; text-align: right;">
        <button class="btn" onclick="closeModal('payment-detail-modal')">닫기</button>
    </div>
    `;

  container.innerHTML = html;
}
