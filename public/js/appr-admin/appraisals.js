// public/js/appr-admin/appraisals.js - 감정 관리 관련 기능

// 전역 변수
let currentAppraisalPage = 1;
let appraisalSearchQuery = "";
let appraisalStatusFilter = "all";
let appraisalResultFilter = "all";

// 페이지 로드 시 이벤트 리스너 설정
document.addEventListener("DOMContentLoaded", function () {
  // 검색 기능
  document
    .getElementById("appraisal-search-btn")
    .addEventListener("click", function () {
      appraisalSearchQuery = document.getElementById("appraisal-search").value;
      currentAppraisalPage = 1;
      loadAppraisalList();
    });

  // 검색창 엔터 이벤트
  document
    .getElementById("appraisal-search")
    .addEventListener("keypress", function (e) {
      if (e.key === "Enter") {
        appraisalSearchQuery = this.value;
        currentAppraisalPage = 1;
        loadAppraisalList();
      }
    });

  // 상태 필터 변경 이벤트
  document
    .getElementById("appraisal-status-filter")
    .addEventListener("change", function () {
      appraisalStatusFilter = this.value;
      currentAppraisalPage = 1;
      loadAppraisalList();
    });

  // 결과 필터 변경 이벤트
  document
    .getElementById("appraisal-result-filter")
    .addEventListener("change", function () {
      appraisalResultFilter = this.value;
      currentAppraisalPage = 1;
      loadAppraisalList();
    });
});

// 감정 목록 로드 함수
function loadAppraisalList() {
  // 로딩 표시
  document.getElementById("appraisals-list").innerHTML =
    '<tr><td colspan="8" style="text-align: center;">감정 데이터를 불러오는 중...</td></tr>';

  // API URL 생성
  let url = `/api/appr/admin/appraisals?page=${currentAppraisalPage}&limit=10`;

  // 필터 적용
  if (appraisalStatusFilter !== "all") {
    url += `&status=${appraisalStatusFilter}`;
  }

  if (appraisalResultFilter !== "all") {
    url += `&result=${appraisalResultFilter}`;
  }

  // 검색어 적용
  if (appraisalSearchQuery) {
    url += `&search=${encodeURIComponent(appraisalSearchQuery)}`;
  }

  // API 호출
  fetch(url)
    .then((response) => {
      if (!response.ok) {
        throw new Error("감정 목록을 불러오는데 실패했습니다.");
      }
      return response.json();
    })
    .then((data) => {
      if (data.success) {
        displayAppraisalList(data.appraisals, data.pagination);
      } else {
        throw new Error(data.message || "감정 목록을 불러오는데 실패했습니다.");
      }
    })
    .catch((error) => {
      document.getElementById(
        "appraisals-list"
      ).innerHTML = `<tr><td colspan="8" style="text-align: center;">오류: ${error.message}</td></tr>`;
    });
}

// 감정 목록 표시 함수
function displayAppraisalList(appraisals, pagination) {
  const tableBody = document.getElementById("appraisals-list");

  // 데이터가 없는 경우
  if (!appraisals || appraisals.length === 0) {
    tableBody.innerHTML =
      '<tr><td colspan="8" style="text-align: center;">감정 신청 내역이 없습니다.</td></tr>';
    document.getElementById("appraisals-pagination").innerHTML = "";
    return;
  }

  // 테이블 내용 생성
  let html = "";
  appraisals.forEach((appraisal) => {
    html += `<tr>
            <td>${appraisal.id.substring(0, 8)}...</td>
            <td>${
              appraisal.appraisal_type === "quicklink" ? "퀵링크" : "오프라인"
            }</td>
            <td>${appraisal.brand} / ${appraisal.model_name}</td>
            <td>${appraisal.user_id}</td>
            <td>${getStatusBadge(appraisal.status)}</td>
            <td>${getStatusBadge(appraisal.result)}</td>
            <td>${formatDate(appraisal.created_at)}</td>
            <td>
                <button class="btn btn-outline" onclick="viewAppraisalDetail('${
                  appraisal.id
                }')">상세/수정</button>
            </td>
        </tr>`;
  });

  tableBody.innerHTML = html;

  // 페이지네이션 생성
  createPagination(
    "appraisals-pagination",
    pagination.currentPage,
    pagination.totalPages,
    (page) => {
      currentAppraisalPage = page;
      loadAppraisalList();
    }
  );
}

// 감정 상세 조회 함수
function viewAppraisalDetail(appraisalId) {
  // 모달 내용 초기화
  document.getElementById("appraisal-detail-content").innerHTML =
    '<p style="text-align: center;">감정 정보를 불러오는 중...</p>';

  // 모달 표시
  openModal("appraisal-detail-modal");

  // API 호출
  fetch(`/api/appr/admin/appraisals/${appraisalId}`)
    .then((response) => {
      if (!response.ok) {
        throw new Error("감정 정보를 불러오는데 실패했습니다.");
      }
      return response.json();
    })
    .then((data) => {
      if (data.success) {
        displayAppraisalDetail(data.appraisal);
      } else {
        throw new Error(data.message || "감정 정보를 불러오는데 실패했습니다.");
      }
    })
    .catch((error) => {
      document.getElementById(
        "appraisal-detail-content"
      ).innerHTML = `<p style="text-align: center;">오류: ${error.message}</p>`;
    });
}

// 감정 상세 정보 표시 함수
function displayAppraisalDetail(appraisal) {
  const container = document.getElementById("appraisal-detail-content");

  // 감정 기본 정보 섹션
  let html = `
    <div class="card" style="margin-bottom: 20px;">
        <div class="card-header">
            <div class="card-title">기본 정보</div>
        </div>
        <table>
            <tr>
                <th style="width: 120px;">감정 ID</th>
                <td>${appraisal.id}</td>
                <th style="width: 120px;">신청일</th>
                <td>${formatDate(appraisal.created_at)}</td>
            </tr>
            <tr>
                <th>감정 유형</th>
                <td>${
                  appraisal.appraisal_type === "quicklink"
                    ? "퀵링크"
                    : "오프라인"
                }</td>
                <th>감정 상태</th>
                <td>${getStatusBadge(appraisal.status)}</td>
            </tr>
            <tr>
                <th>브랜드</th>
                <td>${appraisal.brand}</td>
                <th>모델명</th>
                <td>${appraisal.model_name}</td>
            </tr>
            <tr>
                <th>카테고리</th>
                <td>${appraisal.category}</td>
                <th>신청자 ID</th>
                <td>${appraisal.user_id}</td>
            </tr>
    `;

  // 퀵링크 감정 전용 정보
  if (appraisal.appraisal_type === "quicklink") {
    html += `
            <tr>
                <th>상품 링크</th>
                <td colspan="3">
                    <a href="${appraisal.product_link}" target="_blank">${
      appraisal.product_link
    }</a>
                </td>
            </tr>
            <tr>
                <th>플랫폼</th>
                <td colspan="3">${appraisal.platform || "-"}</td>
            </tr>
        `;
  }

  // 오프라인 감정 전용 정보
  if (appraisal.appraisal_type === "offline") {
    // 구성품 정보 처리
    let componentsHtml = "-";
    if (
      appraisal.components_included &&
      appraisal.components_included.length > 0
    ) {
      componentsHtml = appraisal.components_included.join(", ");
    }

    // 배송 정보 처리
    let deliveryHtml = "-";
    if (appraisal.delivery_info) {
      const delivery = appraisal.delivery_info;
      deliveryHtml = `
                ${delivery.name} / ${delivery.phone}<br>
                (${delivery.zipcode}) ${delivery.address1} ${
        delivery.address2 || ""
      }
            `;
    }

    html += `
            <tr>
                <th>구매연도</th>
                <td>${appraisal.purchase_year || "-"}</td>
                <th>구성품</th>
                <td>${componentsHtml}</td>
            </tr>
            <tr>
                <th>배송정보</th>
                <td colspan="3">${deliveryHtml}</td>
            </tr>
        `;
  }

  // 추가 비고 정보
  html += `
            <tr>
                <th>비고</th>
                <td colspan="3">${appraisal.remarks || "-"}</td>
            </tr>
        </table>
    </div>
    `;

  // 감정 결과 및 이미지 업데이트 폼
  html += `
    <form id="appraisal-update-form" enctype="multipart/form-data">
        <input type="hidden" id="appraisal-id" value="${appraisal.id}">
        
        <div class="card" style="margin-bottom: 20px;">
            <div class="card-header">
                <div class="card-title">감정 결과</div>
            </div>
            
            <div class="form-group">
                <label for="appraisal-status" class="form-label">상태 변경</label>
                <select id="appraisal-status" class="form-select">
                    <option value="pending" ${
                      appraisal.status === "pending" ? "selected" : ""
                    }>접수완료</option>
                    <option value="in_review" ${
                      appraisal.status === "in_review" ? "selected" : ""
                    }>감정중</option>
                    <option value="completed" ${
                      appraisal.status === "completed" ? "selected" : ""
                    }>완료</option>
                    <option value="cancelled" ${
                      appraisal.status === "cancelled" ? "selected" : ""
                    }>취소</option>
                </select>
            </div>
            
            <div class="form-group">
                <label for="appraisal-result" class="form-label">감정 결과</label>
                <select id="appraisal-result" class="form-select">
                    <option value="pending" ${
                      appraisal.result === "pending" ? "selected" : ""
                    }>감정대기</option>
                    <option value="authentic" ${
                      appraisal.result === "authentic" ? "selected" : ""
                    }>정품</option>
                    <option value="fake" ${
                      appraisal.result === "fake" ? "selected" : ""
                    }>가품</option>
                    <option value="uncertain" ${
                      appraisal.result === "uncertain" ? "selected" : ""
                    }>판단불가</option>
                </select>
            </div>
            
            <div class="form-group">
                <label for="appraisal-result-notes" class="form-label">감정 결과 내용</label>
                <textarea id="appraisal-result-notes" class="form-textarea">${
                  appraisal.result_notes || ""
                }</textarea>
            </div>
            
            <div class="form-group">
                <label for="appraisal-certificate-number" class="form-label">감정서 번호</label>
                <input type="text" id="appraisal-certificate-number" class="form-input" value="${
                  appraisal.certificate_number || ""
                }">
            </div>
            
            <div class="form-group">
                <label for="appraisal-pdf" class="form-label">감정서 PDF 업로드</label>
                <input type="file" id="appraisal-pdf" accept="application/pdf">
                ${
                  appraisal.certificate_url
                    ? `<p><a href="${appraisal.certificate_url}" target="_blank">현재 PDF 보기</a></p>`
                    : ""
                }
            </div>
        </div>
        
        <div class="card" style="margin-bottom: 20px;">
            <div class="card-header">
                <div class="card-title">이미지</div>
            </div>
            
            <div class="form-group">
                <label for="appraisal-images" class="form-label">이미지 업로드 (여러 장 선택 가능)</label>
                <input type="file" id="appraisal-images" multiple accept="image/*">
            </div>
            
            <div id="appraisal-images-preview" style="margin-top: 15px; display: flex; flex-wrap: wrap; gap: 10px;">
                ${
                  appraisal.images && appraisal.images.length > 0
                    ? appraisal.images
                        .map(
                          (img) => `
                    <div style="position: relative; width: 150px; height: 150px; margin-bottom: 10px;">
                        <img src="${img}" style="width: 100%; height: 100%; object-fit: cover; border-radius: 4px;">
                    </div>
                `
                        )
                        .join("")
                    : "<p>업로드된 이미지가 없습니다.</p>"
                }
            </div>
        </div>
        
        <div style="margin-top: 20px; text-align: right;">
            <button type="button" class="btn btn-outline" onclick="closeModal('appraisal-detail-modal')">취소</button>
            <button type="button" class="btn" style="margin-left: 10px;" onclick="updateAppraisal()">저장</button>
        </div>
    </form>
    `;

  container.innerHTML = html;
}

// 감정 정보 업데이트 함수
function updateAppraisal() {
  const appraisalId = document.getElementById("appraisal-id").value;

  // 폼 데이터 생성
  const formData = new FormData();
  formData.append("result", document.getElementById("appraisal-result").value);
  formData.append(
    "result_notes",
    document.getElementById("appraisal-result-notes").value
  );
  formData.append("status", document.getElementById("appraisal-status").value);

  // 감정서 번호가 있으면 추가
  const certificateNumber = document.getElementById(
    "appraisal-certificate-number"
  ).value;
  if (certificateNumber) {
    formData.append("certificate_number", certificateNumber);
  }

  // PDF 파일이 선택되었으면 추가
  const pdfFile = document.getElementById("appraisal-pdf").files[0];
  if (pdfFile) {
    formData.append("pdf", pdfFile);
  }

  // 이미지 파일이 선택되었으면 추가
  const imageFiles = document.getElementById("appraisal-images").files;
  for (let i = 0; i < imageFiles.length; i++) {
    formData.append("images", imageFiles[i]);
  }

  // 로딩 표시
  document.getElementById("appraisal-detail-content").innerHTML +=
    '<div class="alert alert-info">업데이트 중...</div>';

  // API 호출
  fetch(`/api/appr/admin/appraisals/${appraisalId}`, {
    method: "PUT",
    body: formData,
  })
    .then((response) => {
      if (!response.ok) {
        throw new Error("감정 정보 업데이트에 실패했습니다.");
      }
      return response.json();
    })
    .then((data) => {
      if (data.success) {
        showAlert("감정 정보가 성공적으로 업데이트되었습니다.", "success");
        closeModal("appraisal-detail-modal");
        loadAppraisalList(); // 목록 새로고침
      } else {
        throw new Error(data.message || "감정 정보 업데이트에 실패했습니다.");
      }
    })
    .catch((error) => {
      showAlert(error.message, "error");
    });
}
