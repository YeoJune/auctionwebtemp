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

  // 감정 생성 관련 이벤트 리스너 추가
  document
    .getElementById("create-appraisal-btn")
    .addEventListener("click", function () {
      openCreateAppraisalModal();
    });

  document
    .getElementById("create-appraisal-type")
    .addEventListener("change", function () {
      toggleAppraisalTypeFields(this.value);
    });

  document
    .getElementById("create-appraisal-form")
    .addEventListener("submit", function (e) {
      e.preventDefault();
      submitCreateAppraisal();
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
// 수정: 감정번호(인증서번호) 표시하도록 displayAppraisalList 함수 업데이트
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
            <td>${appraisal.certificate_number || "미발급"}</td>
            <td>${
              appraisal.appraisal_type === "quicklink" ? "퀵링크" : "오프라인"
            }</td>
            <td>${appraisal.brand} / ${appraisal.model_name}</td>
            <td>${appraisal.user_email || appraisal.user_id}</td>
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
                <th style="width: 120px;">인증서 번호</th>
                <td>${appraisal.certificate_number || "-"}</td>
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
                <th>신청자 정보</th>
                <td>${appraisal.user_email || appraisal.user_id}</td>
            </tr>
            <tr>
                <th>신청일</th>
                <td>${formatDate(appraisal.created_at)}</td>
                <th>감정일</th>
                <td>${formatDate(appraisal.appraised_at) || "-"}</td>
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
                <label for="suggested-restoration-services" class="form-label">추천 복원 서비스</label>
                <div id="suggested-restoration-services" style="margin-top: 10px;">
                    <p>추천 복원 서비스를 선택하려면 먼저 복원 서비스 목록을 불러와야 합니다.</p>
                    <button type="button" class="btn btn-outline" onclick="loadRestorationServicesForAppraisal()">복원 서비스 불러오기</button>
                </div>
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

// 복원 서비스 목록 로드 함수 (감정 상세 모달에서 사용)
function loadRestorationServicesForAppraisal() {
  // 로딩 표시
  document.getElementById("suggested-restoration-services").innerHTML =
    "<p>복원 서비스를 불러오는 중...</p>";

  // API 호출
  fetch("/api/appr/admin/restoration-services")
    .then((response) => {
      if (!response.ok) {
        throw new Error("복원 서비스 목록을 불러오는데 실패했습니다.");
      }
      return response.json();
    })
    .then((data) => {
      if (data.success) {
        displayRestorationServicesCheckboxes(data.services);
      } else {
        throw new Error(
          data.message || "복원 서비스 목록을 불러오는데 실패했습니다."
        );
      }
    })
    .catch((error) => {
      document.getElementById(
        "suggested-restoration-services"
      ).innerHTML = `<p>오류: ${error.message}</p>`;
    });
}

// 복원 서비스 체크박스 표시 함수
function displayRestorationServicesCheckboxes(services) {
  // 활성화된 서비스만 필터링
  const activeServices = services.filter((service) => service.is_active);

  if (activeServices.length === 0) {
    document.getElementById("suggested-restoration-services").innerHTML =
      "<p>사용 가능한 복원 서비스가 없습니다.</p>";
    return;
  }

  let html = '<div style="margin-top: 10px;">';

  activeServices.forEach((service) => {
    html += `
      <div style="margin-bottom: 5px;">
        <label>
          <input type="checkbox" name="suggested-restoration-service" value="${
            service.id
          }">
          ${service.name} (${service.price.toLocaleString()}원)
        </label>
      </div>
    `;
  });

  html += "</div>";
  document.getElementById("suggested-restoration-services").innerHTML = html;
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

  // 추천 복원 서비스 ID 추가
  const suggestedServices = document.querySelectorAll(
    'input[name="suggested-restoration-service"]:checked'
  );
  if (suggestedServices.length > 0) {
    const serviceIds = Array.from(suggestedServices).map(
      (checkbox) => checkbox.value
    );
    formData.append(
      "suggested_restoration_services",
      JSON.stringify(serviceIds)
    );
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

// 감정 생성 모달 열기
function openCreateAppraisalModal() {
  // 폼 초기화 및 검색 결과 클리어
  document.getElementById("create-appraisal-form").reset();
  document.getElementById("user-search-results").innerHTML = "";
  toggleAppraisalTypeFields("");
  // 구성품 입력 필드 초기화
  document.getElementById("components-container").innerHTML = `
    <div style="margin-bottom: 10px;">
      <input type="text" class="form-input component-input" placeholder="구성품 입력 (예: 본체, 더스트백, 보증서 등)" style="margin-bottom: 5px;" />
    </div>`;
  openModal("create-appraisal-modal");
}

// 감정 유형에 따른 필드 표시/숨김 함수
function toggleAppraisalTypeFields(type) {
  const quicklinkFields = document.getElementById("quicklink-fields");
  const offlineFields = document.getElementById("offline-fields");
  const productLinkInput = document.getElementById("create-product-link");

  if (type === "quicklink") {
    quicklinkFields.style.display = "block";
    offlineFields.style.display = "none";
    productLinkInput.required = true;
  } else if (type === "offline") {
    quicklinkFields.style.display = "none";
    offlineFields.style.display = "block";
    productLinkInput.required = false;
  } else {
    quicklinkFields.style.display = "none";
    offlineFields.style.display = "none";
    productLinkInput.required = false;
  }
}

// 구성품 입력 필드 추가 함수
function addComponentInput() {
  const newInput = document.createElement("div");
  newInput.style.marginBottom = "10px";
  newInput.innerHTML = `
    <input type="text" class="form-input component-input" placeholder="구성품 입력" style="margin-bottom: 5px;" />
    <button type="button" class="btn btn-outline" onclick="removeComponentInput(this)" style="margin-left: 10px; padding: 5px 10px;">삭제</button>
  `;
  const container = document.getElementById("components-container");
  container.appendChild(newInput);
}

// 구성품 입력 필드 삭제 함수
function removeComponentInput(button) {
  button.parentElement.remove();
}

// 사용자 검색 모달 열기 함수
function searchUsers() {
  document.getElementById("user-search-list").innerHTML = "";
  document.getElementById("user-search-input").value = "";
  openModal("user-search-modal");
}

// 사용자 검색 실행 함수
function performUserSearch() {
  const query = document.getElementById("user-search-input").value.trim();
  const resultContainer = document.getElementById("user-search-list");

  if (!query) {
    return showAlert("검색어를 입력해주세요.", "error");
  }

  resultContainer.innerHTML = '<p style="text-align: center;">검색 중...</p>';

  fetch(`/api/appr/admin/users?search=${encodeURIComponent(query)}&limit=10`)
    .then((response) => response.json())
    .then((data) => {
      if (data.success && data.users.length > 0) {
        let html = '<table style="width: 100%; border-collapse: collapse;">';
        html +=
          "<thead><tr><th>ID</th><th>이메일</th><th>회사명</th><th>선택</th></tr></thead><tbody>";
        data.users.forEach((user) => {
          html += `
            <tr style="border-bottom: 1px solid #e2e8f0;">
              <td style="padding: 10px;">${user.id}</td>
              <td style="padding: 10px;">${user.email}</td>
              <td style="padding: 10px;">${user.company_name || "-"}</td>
              <td style="padding: 10px;">
                <button type="button" class="btn btn-outline" onclick="selectUser('${
                  user.id
                }', '${user.email}')">선택</button>
              </td>
            </tr>
          `;
        });
        html += "</tbody></table>";
        resultContainer.innerHTML = html;
      } else {
        resultContainer.innerHTML =
          '<p style="text-align: center;">검색 결과가 없습니다.</p>';
      }
    })
    .catch((error) => {
      resultContainer.innerHTML =
        '<p style="text-align: center;">검색 중 오류가 발생했습니다.</p>';
    });
}

// 사용자 선택 함수
function selectUser(userId, userEmail) {
  document.getElementById("create-user-id").value = userId;
  document.getElementById("user-search-results").innerHTML = `
    <div style="padding: 10px; background-color: #f0f9ff; border-radius: 4px; border: 1px solid #0ea5e9;">
      선택된 사용자: ${userId} (${userEmail})
    </div>
  `;
  closeModal("user-search-modal");
}

// 감정 생성 제출 함수
function submitCreateAppraisal() {
  const formData = new FormData(
    document.getElementById("create-appraisal-form")
  );

  // 로딩 표시
  document.getElementById("create-appraisal-message").innerHTML =
    '<div class="alert alert-info">감정 신청 중...</div>';

  // API 호출
  fetch("/api/appr/admin/appraisals", {
    method: "POST",
    body: formData,
  })
    .then((response) => {
      if (!response.ok) {
        throw new Error("감정 신청에 실패했습니다.");
      }
      return response.json();
    })
    .then((data) => {
      if (data.success) {
        showAlert("감정 신청이 완료되었습니다.", "success");
        closeModal("create-appraisal-modal");
        loadAppraisalList(); // 목록 새로고침
      } else {
        throw new Error(data.message || "감정 신청에 실패했습니다.");
      }
    })
    .catch((error) => {
      document.getElementById(
        "create-appraisal-message"
      ).innerHTML = `<div class="alert alert-danger">오류: ${error.message}</div>`;
    });
}
