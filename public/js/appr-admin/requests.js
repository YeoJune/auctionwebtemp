// public/js/appr-admin/requests.js - 복원 요청 관리 관련 기능

// 전역 변수
let currentRequestPage = 1;
let requestSearchQuery = "";
let requestStatusFilter = "all";

// 페이지 로드 시 이벤트 리스너 설정
document.addEventListener("DOMContentLoaded", function () {
  // 검색 버튼 이벤트
  document
    .getElementById("restoration-request-search-btn")
    .addEventListener("click", function () {
      requestSearchQuery = document.getElementById(
        "restoration-request-search"
      ).value;
      currentRequestPage = 1;
      loadRestorationRequestList();
    });

  // 검색창 엔터 이벤트
  document
    .getElementById("restoration-request-search")
    .addEventListener("keypress", function (e) {
      if (e.key === "Enter") {
        requestSearchQuery = this.value;
        currentRequestPage = 1;
        loadRestorationRequestList();
      }
    });

  // 상태 필터 변경 이벤트
  document
    .getElementById("restoration-request-status-filter")
    .addEventListener("change", function () {
      requestStatusFilter = this.value;
      currentRequestPage = 1;
      loadRestorationRequestList();
    });
});

// 복원 요청 목록 로드 함수
function loadRestorationRequestList() {
  // 로딩 표시
  document.getElementById("restoration-requests-list").innerHTML =
    '<tr><td colspan="9" style="text-align: center;">복원 요청 데이터를 불러오는 중...</td></tr>';

  // API URL 생성
  let url = `/api/appr/admin/restorations?page=${currentRequestPage}&limit=10`;

  // 필터 적용
  if (requestStatusFilter !== "all") {
    url += `&status=${requestStatusFilter}`;
  }

  // 검색어 적용
  if (requestSearchQuery) {
    url += `&search=${encodeURIComponent(requestSearchQuery)}`;
  }

  // API 호출
  fetch(url)
    .then((response) => {
      if (!response.ok) {
        throw new Error("복원 요청 목록을 불러오는데 실패했습니다.");
      }
      return response.json();
    })
    .then((data) => {
      if (data.success) {
        displayRestorationRequestList(data.restorations, data.pagination);
      } else {
        throw new Error(
          data.message || "복원 요청 목록을 불러오는데 실패했습니다."
        );
      }
    })
    .catch((error) => {
      document.getElementById(
        "restoration-requests-list"
      ).innerHTML = `<tr><td colspan="9" style="text-align: center;">오류: ${error.message}</td></tr>`;
    });
}

// 복원 요청 목록 표시 함수
function displayRestorationRequestList(restorations, pagination) {
  const tableBody = document.getElementById("restoration-requests-list");

  // 데이터가 없는 경우
  if (!restorations || restorations.length === 0) {
    tableBody.innerHTML =
      '<tr><td colspan="9" style="text-align: center;">복원 요청 내역이 없습니다.</td></tr>';
    document.getElementById("restoration-requests-pagination").innerHTML = "";
    return;
  }

  // 테이블 내용 생성
  let html = "";
  restorations.forEach((request) => {
    // 서비스 항목 수 파악
    const serviceCount = request.services ? request.services.length : 0;

    html += `<tr>
            <td>${request.id.substring(0, 8)}...</td>
            <td>${request.appraisal_id.substring(0, 8)}...</td>
            <td>${
              request.brand && request.model_name
                ? `${request.brand} / ${request.model_name}`
                : "-"
            }</td>
            <td>${
              request.user_email || request.company_name || request.user_id
            }</td>
            <td>${serviceCount}개 항목</td>
            <td>${getStatusBadge(request.status)}</td>
            <td>${formatDate(request.created_at)}</td>
            <td>${formatDate(request.estimated_completion_date) || "-"}</td>
            <td>
                <button class="btn btn-outline" onclick="viewRestorationRequestDetail('${
                  request.id
                }')">상세/수정</button>
            </td>
        </tr>`;
  });

  tableBody.innerHTML = html;

  // 페이지네이션 생성
  createPagination(
    "restoration-requests-pagination",
    pagination.currentPage,
    pagination.totalPages,
    (page) => {
      currentRequestPage = page;
      loadRestorationRequestList();
    }
  );
}

// 복원 요청 상세 조회 함수
function viewRestorationRequestDetail(requestId) {
  // 모달 내용 초기화
  document.getElementById("restoration-request-detail-content").innerHTML =
    '<p style="text-align: center;">복원 요청 정보를 불러오는 중...</p>';

  // 모달 표시
  openModal("restoration-request-detail-modal");

  // API 호출
  fetch(`/api/appr/admin/restorations/${requestId}`)
    .then((response) => {
      if (!response.ok) {
        throw new Error("복원 요청 정보를 불러오는데 실패했습니다.");
      }
      return response.json();
    })
    .then((data) => {
      if (data.success) {
        displayRestorationRequestDetail(data.restoration);
      } else {
        throw new Error(
          data.message || "복원 요청 정보를 불러오는데 실패했습니다."
        );
      }
    })
    .catch((error) => {
      document.getElementById(
        "restoration-request-detail-content"
      ).innerHTML = `<p style="text-align: center;">오류: ${error.message}</p>`;
    });
}

// 복원 요청 상세 정보 표시 함수
function displayRestorationRequestDetail(restoration) {
  const container = document.getElementById(
    "restoration-request-detail-content"
  );

  // 복원 요청 기본 정보 섹션
  let html = `
    <div class="card" style="margin-bottom: 20px;">
        <div class="card-header">
            <div class="card-title">기본 정보</div>
        </div>
        <table>
            <tr>
                <th style="width: 120px;">요청 ID</th>
                <td>${restoration.id}</td>
                <th style="width: 120px;">인증서 번호</th>
                <td>${restoration.certificate_number || "-"}</td>
            </tr>
            <tr>
                <th>감정 ID</th>
                <td>${restoration.appraisal_id}</td>
                <th>신청자 정보</th>
                <td>${
                  restoration.user_email ||
                  restoration.company_name ||
                  restoration.user_id
                }</td>
            </tr>
            <tr>
                <th>신청일</th>
                <td>${formatDate(restoration.created_at)}</td>
                <th>상태</th>
                <td>${getStatusBadge(restoration.status)}</td>
            </tr>`;

  // 상품 정보가 있는 경우 추가
  if (restoration.appraisal) {
    html += `
            <tr>
                <th>브랜드</th>
                <td>${restoration.appraisal.brand}</td>
                <th>모델명</th>
                <td>${restoration.appraisal.model_name}</td>
            </tr>
            <tr>
                <th>카테고리</th>
                <td colspan="3">${restoration.appraisal.category}</td>
            </tr>
        `;
  }

  // 배송 정보
  if (restoration.delivery_info) {
    const delivery = restoration.delivery_info;
    html += `
            <tr>
                <th>배송정보</th>
                <td colspan="3">
                    ${delivery.name} / ${delivery.phone}<br>
                    (${delivery.zipcode}) ${delivery.address1} ${
      delivery.address2 || ""
    }
                </td>
            </tr>
        `;
  }

  // 추가 요청사항
  html += `
            <tr>
                <th>요청사항</th>
                <td colspan="3">${restoration.notes || "-"}</td>
            </tr>
        </table>
    </div>
    `;

  // 복원 서비스 항목 섹션
  html += `
    <div class="card" style="margin-bottom: 20px;">
        <div class="card-header">
            <div class="card-title">복원 서비스 항목</div>
        </div>
        <table>
            <thead>
                <tr>
                    <th>서비스명</th>
                    <th>가격</th>
                    <th>상태</th>
                </tr>
            </thead>
            <tbody>
    `;

  // 서비스 항목 목록 (가격 표시 로직 수정)
  if (restoration.services && restoration.services.length > 0) {
    restoration.services.forEach((service) => {
      // 가격 표시 로직 수정 - 문자열일 수도 있음
      let priceDisplay = service.price;
      if (!isNaN(parseFloat(service.price))) {
        // 숫자인 경우에만 천 단위 구분자 + "원" 추가
        priceDisplay = parseFloat(service.price).toLocaleString() + "원";
      }
      // 문자열인 경우 그대로 표시

      html += `
                <tr>
                    <td>${service.service_name}</td>
                    <td>${priceDisplay}</td>
                    <td>${getStatusBadge(service.status)}</td>
                </tr>
            `;
    });
  } else {
    html +=
      '<tr><td colspan="3" style="text-align: center;">서비스 항목이 없습니다.</td></tr>';
  }

  // 총 금액 표시 로직 수정
  let totalPriceDisplay = restoration.total_price;
  if (!isNaN(parseFloat(restoration.total_price))) {
    // 숫자인 경우에만 천 단위 구분자 + "원" 추가
    totalPriceDisplay =
      parseFloat(restoration.total_price).toLocaleString() + "원";
  }
  // 문자열인 경우 ("견적 문의" 등) 그대로 표시

  html += `
            </tbody>
            <tfoot>
                <tr>
                    <th>총 금액</th>
                    <td colspan="2"><strong>${totalPriceDisplay}</strong></td>
                </tr>
            </tfoot>
        </table>
    </div>
    `;

  // 현재 이미지 갤러리 섹션
  let hasImages = false;
  let imagesHtml = `
    <div class="card" style="margin-bottom: 20px;">
        <div class="card-header">
            <div class="card-title">현재 이미지</div>
        </div>
        <div style="padding: 15px;">`;

  // 상품 이미지 (감정서에서 가져온 이미지)
  if (
    restoration.appraisal &&
    restoration.appraisal.images &&
    restoration.appraisal.images.length > 0
  ) {
    hasImages = true;
    imagesHtml += `
            <h3 style="margin-bottom: 10px;">상품 이미지</h3>
            <div style="display: flex; flex-wrap: wrap; gap: 10px; margin-bottom: 20px;">
        `;

    restoration.appraisal.images.forEach((img) => {
      imagesHtml += `
                <div style="width: 120px; height: 120px; margin-bottom: 10px;">
                    <img src="${img}" style="width: 100%; height: 100%; object-fit: cover; border-radius: 4px;">
                </div>
            `;
    });

    imagesHtml += "</div>";
  }

  // 복원 작업 이미지
  if (restoration.images) {
    // 복원 전 이미지
    if (restoration.images.before && restoration.images.before.length > 0) {
      hasImages = true;
      imagesHtml += `
                <h3 style="margin-bottom: 10px;">복원 전 이미지</h3>
                <div style="display: flex; flex-wrap: wrap; gap: 10px; margin-bottom: 20px;">
            `;

      restoration.images.before.forEach((img) => {
        imagesHtml += `
                    <div style="width: 120px; height: 120px; margin-bottom: 10px;">
                        <img src="${img}" style="width: 100%; height: 100%; object-fit: cover; border-radius: 4px;">
                    </div>
                `;
      });

      imagesHtml += "</div>";
    }

    // 복원 진행 이미지
    if (restoration.images.progress && restoration.images.progress.length > 0) {
      hasImages = true;
      imagesHtml += `
                <h3 style="margin-bottom: 10px;">복원 진행 이미지</h3>
                <div style="display: flex; flex-wrap: wrap; gap: 10px; margin-bottom: 20px;">
            `;

      restoration.images.progress.forEach((img) => {
        imagesHtml += `
                    <div style="width: 120px; height: 120px; margin-bottom: 10px;">
                        <img src="${img}" style="width: 100%; height: 100%; object-fit: cover; border-radius: 4px;">
                    </div>
                `;
      });

      imagesHtml += "</div>";
    }

    // 복원 후 이미지
    if (restoration.images.after && restoration.images.after.length > 0) {
      hasImages = true;
      imagesHtml += `
                <h3 style="margin-bottom: 10px;">복원 후 이미지</h3>
                <div style="display: flex; flex-wrap: wrap; gap: 10px; margin-bottom: 20px;">
            `;

      restoration.images.after.forEach((img) => {
        imagesHtml += `
                    <div style="width: 120px; height: 120px; margin-bottom: 10px;">
                        <img src="${img}" style="width: 100%; height: 100%; object-fit: cover; border-radius: 4px;">
                    </div>
                `;
      });

      imagesHtml += "</div>";
    }
  }

  if (!hasImages) {
    imagesHtml += "<p>업로드된 이미지가 없습니다.</p>";
  }

  imagesHtml += `
        </div>
    </div>
    `;

  html += imagesHtml;

  // 상태 업데이트 폼
  html += `
    <form id="restoration-update-form" enctype="multipart/form-data">
        <input type="hidden" id="restoration-id" value="${restoration.id}">
        
        <div class="card" style="margin-bottom: 20px;">
            <div class="card-header">
                <div class="card-title">상태 관리</div>
            </div>
            
            <div class="form-group">
                <label for="restoration-status" class="form-label">복원 상태</label>
                <select id="restoration-status" class="form-select">
                    <option value="pending" ${
                      restoration.status === "pending" ? "selected" : ""
                    }>접수완료</option>
                    <option value="in_progress" ${
                      restoration.status === "in_progress" ? "selected" : ""
                    }>진행중</option>
                    <option value="completed" ${
                      restoration.status === "completed" ? "selected" : ""
                    }>완료</option>
                    <option value="cancelled" ${
                      restoration.status === "cancelled" ? "selected" : ""
                    }>취소</option>
                </select>
            </div>
            
            <div class="form-group">
                <label for="restoration-estimated-date" class="form-label">예상 완료일</label>
                <input type="date" id="restoration-estimated-date" class="form-input" value="${
                  restoration.estimated_completion_date
                    ? restoration.estimated_completion_date.substring(0, 10)
                    : ""
                }">
            </div>
            
            <div class="form-group">
                <label for="restoration-completed-date" class="form-label">실제 완료일</label>
                <input type="date" id="restoration-completed-date" class="form-input" value="${
                  restoration.completed_at
                    ? restoration.completed_at.substring(0, 10)
                    : ""
                }">
            </div>
            
            <div class="form-group">
                <label class="form-label">서비스 항목 상태</label>
                <div id="service-status-container">
    `;

  // 서비스 항목 상태 관리 (가격 표시 로직 수정)
  if (restoration.services && restoration.services.length > 0) {
    restoration.services.forEach((service, index) => {
      // 가격 표시 로직 수정
      let priceDisplay = service.price;
      if (!isNaN(parseFloat(service.price))) {
        priceDisplay = parseFloat(service.price).toLocaleString() + "원";
      }

      html += `
                <div style="margin-bottom: 10px; padding: 10px; background-color: #f8fafc; border-radius: 4px;">
                    <p><strong>${
                      service.service_name
                    }</strong> (${priceDisplay})</p>
                    <select id="service-status-${index}" class="form-select" style="margin-top: 5px;">
                        <option value="pending" ${
                          service.status === "pending" ? "selected" : ""
                        }>접수완료</option>
                        <option value="in_progress" ${
                          service.status === "in_progress" ? "selected" : ""
                        }>진행중</option>
                        <option value="completed" ${
                          service.status === "completed" ? "selected" : ""
                        }>완료</option>
                    </select>
                    <input type="hidden" id="service-id-${index}" value="${
        service.service_id
      }">
                </div>
            `;
    });
  } else {
    html += "<p>서비스 항목이 없습니다.</p>";
  }

  html += `
                </div>
            </div>
        </div>
        
        <div class="card" style="margin-bottom: 20px;">
            <div class="card-header">
                <div class="card-title">이미지 업로드</div>
            </div>
            
            <div class="form-group">
                <label for="restoration-before-images" class="form-label">복원 전 이미지 (여러 장 선택 가능)</label>
                <input type="file" id="restoration-before-images" multiple accept="image/*">
            </div>
            
            <div class="form-group">
                <label for="restoration-progress-images" class="form-label">복원 진행 이미지 (여러 장 선택 가능)</label>
                <input type="file" id="restoration-progress-images" multiple accept="image/*">
            </div>
            
            <div class="form-group">
                <label for="restoration-after-images" class="form-label">복원 후 이미지 (여러 장 선택 가능)</label>
                <input type="file" id="restoration-after-images" multiple accept="image/*">
            </div>
        </div>
        
        <div style="margin-top: 20px; text-align: right;">
            <button type="button" class="btn btn-outline" onclick="closeModal('restoration-request-detail-modal')">취소</button>
            <button type="button" class="btn" style="margin-left: 10px;" onclick="updateRestorationRequest()">저장</button>
        </div>
    </form>
    `;

  container.innerHTML = html;
}

// 복원 요청 업데이트 함수
function updateRestorationRequest() {
  const requestId = document.getElementById("restoration-id").value;

  // 서비스 상태 정보 수집
  const servicesData = [];
  const serviceCount = document.querySelectorAll('[id^="service-id-"]').length;

  for (let i = 0; i < serviceCount; i++) {
    servicesData.push({
      service_id: document.getElementById(`service-id-${i}`).value,
      status: document.getElementById(`service-status-${i}`).value,
    });
  }

  // 폼 데이터 생성
  const formData = new FormData();
  formData.append(
    "status",
    document.getElementById("restoration-status").value
  );

  // 예상 완료일이 있으면 추가
  const estimatedDate = document.getElementById(
    "restoration-estimated-date"
  ).value;
  if (estimatedDate) {
    formData.append("estimated_completion_date", estimatedDate);
  }

  // 실제 완료일이 있으면 추가
  const completedDate = document.getElementById(
    "restoration-completed-date"
  ).value;
  if (completedDate) {
    formData.append("completed_at", completedDate);
  }

  // 서비스 상태 정보 추가
  if (servicesData.length > 0) {
    formData.append("services", JSON.stringify(servicesData));
  }

  // 이미지 파일 추가
  const beforeImages = document.getElementById(
    "restoration-before-images"
  ).files;
  for (let i = 0; i < beforeImages.length; i++) {
    formData.append("before_images", beforeImages[i]);
  }

  const progressImages = document.getElementById(
    "restoration-progress-images"
  ).files;
  for (let i = 0; i < progressImages.length; i++) {
    formData.append("progress_images", progressImages[i]);
  }

  const afterImages = document.getElementById("restoration-after-images").files;
  for (let i = 0; i < afterImages.length; i++) {
    formData.append("after_images", afterImages[i]);
  }

  // 로딩 표시
  document.getElementById("restoration-request-detail-content").innerHTML +=
    '<div class="alert alert-info">업데이트 중...</div>';

  // API 호출
  fetch(`/api/appr/admin/restorations/${requestId}`, {
    method: "PUT",
    body: formData,
  })
    .then((response) => {
      if (!response.ok) {
        throw new Error("복원 요청 업데이트에 실패했습니다.");
      }
      return response.json();
    })
    .then((data) => {
      if (data.success) {
        showAlert("복원 요청이 성공적으로 업데이트되었습니다.", "success");
        closeModal("restoration-request-detail-modal");
        loadRestorationRequestList(); // 목록 새로고침
      } else {
        throw new Error(data.message || "복원 요청 업데이트에 실패했습니다.");
      }
    })
    .catch((error) => {
      showAlert(error.message, "error");
    });
}
