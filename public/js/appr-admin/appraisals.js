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

// 기존 displayAppraisalList 함수에서 삭제 버튼만 추가
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
                <button class="btn" style="background-color: #dc2626; margin-left: 5px;" onclick="deleteAppraisal('${
                  appraisal.id
                }', '${appraisal.certificate_number || "미발급"}', '${
      appraisal.brand
    }', '${appraisal.model_name}')">삭제</button>
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

// 간단한 삭제 함수 추가
function deleteAppraisal(appraisalId, certificateNumber, brand, modelName) {
  if (
    confirm(
      `정말로 감정을 삭제하시겠습니까?\n\n${certificateNumber} - ${brand} / ${modelName}\n\n삭제된 데이터는 복구할 수 없습니다.`
    )
  ) {
    // API 호출
    fetch(`/api/appr/admin/appraisals/${appraisalId}`, {
      method: "DELETE",
    })
      .then((response) => {
        if (!response.ok) {
          return response.json().then((data) => {
            throw new Error(data.message || "감정 삭제에 실패했습니다.");
          });
        }
        return response.json();
      })
      .then((data) => {
        if (data.success) {
          showAlert("감정이 성공적으로 삭제되었습니다.", "success");

          // 상세 모달이 열려있으면 닫기
          const modal = document.getElementById("appraisal-detail-modal");
          if (modal && modal.style.display === "flex") {
            closeModal("appraisal-detail-modal");
          }

          // 목록 새로고침
          loadAppraisalList();
        } else {
          throw new Error(data.message || "감정 삭제에 실패했습니다.");
        }
      })
      .catch((error) => {
        showAlert(error.message, "error");
      });
  }
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

// 감정 상세 정보 표시 함수 - 기본 정보도 수정 가능하도록 개선
function displayAppraisalDetail(appraisal) {
  const container = document.getElementById("appraisal-detail-content");

  // 감정 기본 정보 수정 폼
  let html = `
    <form id="appraisal-update-form" enctype="multipart/form-data">
        <input type="hidden" id="appraisal-id" value="${appraisal.id}">
        
        <div class="card" style="margin-bottom: 20px;">
            <div class="card-header">
                <div class="card-title">기본 정보</div>
            </div>
            
            <div class="form-group">
                <label for="appraisal-certificate-number" class="form-label">인증서 번호</label>
                <input
                    type="text"
                    id="appraisal-certificate-number"
                    class="form-input"
                    value="${appraisal.certificate_number || ""}"
                    placeholder="예: CAS004312"
                    pattern="^[Cc][Aa][Ss]\\d+$"
                    title="CAS + 숫자 형태여야 합니다 (예: CAS004312)" />
                <small style="color: #666">비워두면 자동으로 생성됩니다</small>
            </div>

            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px; margin-bottom: 15px;">
                <div class="form-group">
                    <label for="appraisal-type-select" class="form-label">감정 유형</label>
                    <select id="appraisal-type-select" class="form-select" onchange="toggleAppraisalTypeFieldsInDetail(this.value)">
                        <option value="quicklink" ${
                          appraisal.appraisal_type === "quicklink"
                            ? "selected"
                            : ""
                        }>퀵링크</option>
                        <option value="offline" ${
                          appraisal.appraisal_type === "offline"
                            ? "selected"
                            : ""
                        }>오프라인</option>
                    </select>
                </div>
                
                <div class="form-group">
                    <label for="appraisal-category-select" class="form-label">카테고리</label>
                    <select id="appraisal-category-select" class="form-select">
                        <option value="가방" ${
                          appraisal.category === "가방" ? "selected" : ""
                        }>가방</option>
                        <option value="지갑" ${
                          appraisal.category === "지갑" ? "selected" : ""
                        }>지갑</option>
                        <option value="신발" ${
                          appraisal.category === "신발" ? "selected" : ""
                        }>신발</option>
                        <option value="의류" ${
                          appraisal.category === "의류" ? "selected" : ""
                        }>의류</option>
                        <option value="시계" ${
                          appraisal.category === "시계" ? "selected" : ""
                        }>시계</option>
                        <option value="액세서리" ${
                          appraisal.category === "액세서리" ? "selected" : ""
                        }>액세서리</option>
                        <option value="기타" ${
                          appraisal.category === "기타" ? "selected" : ""
                        }>기타</option>
                    </select>
                </div>
            </div>

            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px; margin-bottom: 15px;">
                <div class="form-group">
                    <label for="appraisal-brand-input" class="form-label">브랜드</label>
                    <input
                        type="text"
                        id="appraisal-brand-input"
                        class="form-input"
                        value="${appraisal.brand}"
                        placeholder="예: 루이비통, 샤넬, 에르메스 등" />
                </div>
                
                <div class="form-group">
                    <label for="appraisal-model-input" class="form-label">모델명</label>
                    <input
                        type="text"
                        id="appraisal-model-input"
                        class="form-input"
                        value="${appraisal.model_name}"
                        placeholder="상품의 모델명 입력" />
                </div>
            </div>

            <!-- 퀵링크 전용 필드 -->
            <div id="quicklink-fields-detail" style="${
              appraisal.appraisal_type === "quicklink"
                ? "display: block"
                : "display: none"
            }">
                <div class="form-group">
                    <label for="appraisal-product-link" class="form-label">상품 링크</label>
                    <input
                        type="url"
                        id="appraisal-product-link"
                        class="form-input"
                        value="${appraisal.product_link || ""}"
                        placeholder="https://..." />
                </div>

                <div class="form-group">
                    <label for="appraisal-platform" class="form-label">플랫폼</label>
                    <input
                        type="text"
                        id="appraisal-platform"
                        class="form-input"
                        value="${appraisal.platform || ""}"
                        placeholder="예: 네이버쇼핑, 당근마켓 등" />
                </div>
            </div>

            <!-- 오프라인 전용 필드 -->
            <div id="offline-fields-detail" style="${
              appraisal.appraisal_type === "offline"
                ? "display: block"
                : "display: none"
            }">
                <div class="form-group">
                    <label for="appraisal-purchase-year" class="form-label">구매연도</label>
                    <input
                        type="number"
                        id="appraisal-purchase-year"
                        class="form-input"
                        value="${appraisal.purchase_year || ""}"
                        placeholder="예: 2020"
                        min="1980"
                        max="2025" />
                </div>

                <div class="form-group">
                    <label for="appraisal-components" class="form-label">구성품</label>
                    <div id="components-container-detail">
                        ${
                          appraisal.components_included &&
                          appraisal.components_included.length > 0
                            ? appraisal.components_included
                                .map(
                                  (component, index) => `
                                <div style="margin-bottom: 10px;">
                                    <input
                                        type="text"
                                        class="form-input component-input-detail"
                                        value="${component}"
                                        placeholder="구성품 입력"
                                        style="margin-bottom: 5px;" />
                                    ${
                                      index > 0
                                        ? '<button type="button" class="btn btn-outline" onclick="removeComponentInputDetail(this)" style="margin-left: 10px; padding: 5px 10px;">삭제</button>'
                                        : ""
                                    }
                                </div>
                            `
                                )
                                .join("")
                            : `
                                <div style="margin-bottom: 10px;">
                                    <input
                                        type="text"
                                        class="form-input component-input-detail"
                                        placeholder="구성품 입력 (예: 본체, 더스트백, 보증서 등)"
                                        style="margin-bottom: 5px;" />
                                </div>
                            `
                        }
                    </div>
                    <button
                        type="button"
                        class="btn btn-outline"
                        onclick="addComponentInputDetail()">
                        구성품 추가
                    </button>
                </div>

                <div class="form-group">
                    <label class="form-label">배송 정보</label>
                    ${
                      appraisal.delivery_info
                        ? (() => {
                            const delivery = appraisal.delivery_info;
                            return `
                            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 10px;">
                                <input
                                    type="text"
                                    id="appraisal-delivery-name"
                                    class="form-input"
                                    value="${delivery.name || ""}"
                                    placeholder="수령인명" />
                                <input
                                    type="tel"
                                    id="appraisal-delivery-phone"
                                    class="form-input"
                                    value="${delivery.phone || ""}"
                                    placeholder="연락처" />
                            </div>
                            <div style="display: grid; grid-template-columns: 150px 1fr; gap: 10px; margin-bottom: 10px;">
                                <input
                                    type="text"
                                    id="appraisal-delivery-zipcode"
                                    class="form-input"
                                    value="${delivery.zipcode || ""}"
                                    placeholder="우편번호" />
                                <input
                                    type="text"
                                    id="appraisal-delivery-address1"
                                    class="form-input"
                                    value="${delivery.address1 || ""}"
                                    placeholder="기본 주소" />
                            </div>
                            <input
                                type="text"
                                id="appraisal-delivery-address2"
                                class="form-input"
                                value="${delivery.address2 || ""}"
                                placeholder="상세 주소" />
                        `;
                          })()
                        : `
                        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 10px;">
                            <input
                                type="text"
                                id="appraisal-delivery-name"
                                class="form-input"
                                placeholder="수령인명" />
                            <input
                                type="tel"
                                id="appraisal-delivery-phone"
                                class="form-input"
                                placeholder="연락처" />
                        </div>
                        <div style="display: grid; grid-template-columns: 150px 1fr; gap: 10px; margin-bottom: 10px;">
                            <input
                                type="text"
                                id="appraisal-delivery-zipcode"
                                class="form-input"
                                placeholder="우편번호" />
                            <input
                                type="text"
                                id="appraisal-delivery-address1"
                                class="form-input"
                                placeholder="기본 주소" />
                        </div>
                        <input
                            type="text"
                            id="appraisal-delivery-address2"
                            class="form-input"
                            placeholder="상세 주소" />
                    `
                    }
                </div>
            </div>

            <div class="form-group">
                <label for="appraisal-remarks-input" class="form-label">비고</label>
                <textarea
                    id="appraisal-remarks-input"
                    class="form-textarea"
                    placeholder="특이사항이나 추가 요청사항을 입력하세요">${
                      appraisal.remarks || ""
                    }</textarea>
            </div>

            <div style="margin-bottom: 15px; padding: 10px; background-color: #f8fafc; border-radius: 4px;">
                <strong>신청자 정보:</strong> ${
                  appraisal.user_email || appraisal.user_id
                } | 
                <strong>신청일:</strong> ${formatDate(appraisal.created_at)} |
                <strong>현재 상태:</strong> ${getStatusBadge(appraisal.status)}
            </div>
        </div>
        
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
                <label for="appraisal-result-notes" class="form-label">감정 결과 소견 내용</label>
                <textarea id="appraisal-result-notes" class="form-textarea" placeholder="감정 결과에 대한 상세한 소견을 입력하세요">${
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
                <div class="card-title">이미지 관리</div>
            </div>
            
            <div class="form-group">
                <label for="appraisal-images" class="form-label">새 이미지 업로드 (여러 장 선택 가능)</label>
                <input type="file" id="appraisal-images" multiple accept="image/*">
                <small style="color: #666; display: block; margin-top: 5px;">
                    ${
                      appraisal.appraisal_type === "quicklink"
                        ? "퀵링크"
                        : "오프라인"
                    } 감정 이미지를 업로드할 수 있습니다.
                </small>
            </div>
            
            <div id="appraisal-images-preview" style="margin-top: 15px;">
                <h4 style="margin-bottom: 10px; font-size: 1rem; color: #1a2a3a;">현재 업로드된 이미지</h4>
                <div style="display: flex; flex-wrap: wrap; gap: 10px;">
                ${
                  appraisal.images && appraisal.images.length > 0
                    ? appraisal.images
                        .map(
                          (img, index) => `
                        <div style="position: relative; width: 150px; height: 150px; margin-bottom: 10px;">
                            <img src="${img}" style="width: 100%; height: 100%; object-fit: cover; border-radius: 4px; border: 1px solid #e2e8f0;">
                            <div style="position: absolute; bottom: 5px; left: 5px; background: rgba(0,0,0,0.7); color: white; padding: 2px 6px; border-radius: 3px; font-size: 0.75rem;">
                                ${index + 1}
                            </div>
                        </div>
                    `
                        )
                        .join("")
                    : "<p style='color: #666; font-style: italic;'>업로드된 이미지가 없습니다.</p>"
                }
                </div>
            </div>
        </div>
        
        
        <div style="margin-top: 20px; display: flex; justify-content: space-between;">
            <div>
                <button type="button" class="btn" style="background-color: #dc2626;" onclick="deleteAppraisal('${
                  appraisal.id
                }', '${appraisal.certificate_number || "미발급"}', '${
    appraisal.brand
  }', '${appraisal.model_name}')">
                    삭제
                </button>
            </div>
            <div>
                <button type="button" class="btn btn-outline" onclick="closeModal('appraisal-detail-modal')">취소</button>
                <button type="button" class="btn" style="margin-left: 10px;" onclick="updateAppraisal()">저장</button>
            </div>
        </div>
    </form>
    `;

  container.innerHTML = html;
}

// 감정 유형에 따른 필드 표시/숨김 함수 (상세 모달용)
function toggleAppraisalTypeFieldsInDetail(type) {
  const quicklinkFields = document.getElementById("quicklink-fields-detail");
  const offlineFields = document.getElementById("offline-fields-detail");

  if (type === "quicklink") {
    quicklinkFields.style.display = "block";
    offlineFields.style.display = "none";
  } else if (type === "offline") {
    quicklinkFields.style.display = "none";
    offlineFields.style.display = "block";
  }
}

// 구성품 입력 필드 추가 함수 (상세 모달용)
function addComponentInputDetail() {
  const newInput = document.createElement("div");
  newInput.style.marginBottom = "10px";
  newInput.innerHTML = `
    <input type="text" class="form-input component-input-detail" placeholder="구성품 입력" style="margin-bottom: 5px;" />
    <button type="button" class="btn btn-outline" onclick="removeComponentInputDetail(this)" style="margin-left: 10px; padding: 5px 10px;">삭제</button>
  `;
  const container = document.getElementById("components-container-detail");
  container.appendChild(newInput);
}

// 구성품 입력 필드 삭제 함수 (상세 모달용)
function removeComponentInputDetail(button) {
  button.parentElement.remove();
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

// 감정 정보 업데이트 함수 - 기본 정보도 포함하도록 수정
function updateAppraisal() {
  const appraisalId = document.getElementById("appraisal-id").value;

  // 폼 데이터 생성
  const formData = new FormData();

  // 기본 정보 필드들 추가
  formData.append(
    "certificate_number",
    document.getElementById("appraisal-certificate-number").value || ""
  );
  formData.append(
    "appraisal_type",
    document.getElementById("appraisal-type-select").value
  );
  formData.append(
    "brand",
    document.getElementById("appraisal-brand-input").value
  );
  formData.append(
    "model_name",
    document.getElementById("appraisal-model-input").value
  );
  formData.append(
    "category",
    document.getElementById("appraisal-category-select").value
  );
  formData.append(
    "remarks",
    document.getElementById("appraisal-remarks-input").value
  );

  // 감정 유형별 필드 추가
  const appraisalType = document.getElementById("appraisal-type-select").value;

  if (appraisalType === "quicklink") {
    formData.append(
      "product_link",
      document.getElementById("appraisal-product-link").value || ""
    );
    formData.append(
      "platform",
      document.getElementById("appraisal-platform").value || ""
    );
  } else if (appraisalType === "offline") {
    const purchaseYear = document.getElementById(
      "appraisal-purchase-year"
    ).value;
    if (purchaseYear) {
      formData.append("purchase_year", purchaseYear);
    }

    // 구성품 수집
    const componentInputs = document.querySelectorAll(
      ".component-input-detail"
    );
    const components = Array.from(componentInputs)
      .map((input) => input.value.trim())
      .filter((value) => value);
    if (components.length > 0) {
      formData.append("components_included", JSON.stringify(components));
    }

    // 배송 정보 수집
    const deliveryName =
      document.getElementById("appraisal-delivery-name")?.value || "";
    const deliveryPhone =
      document.getElementById("appraisal-delivery-phone")?.value || "";
    const deliveryZipcode =
      document.getElementById("appraisal-delivery-zipcode")?.value || "";
    const deliveryAddress1 =
      document.getElementById("appraisal-delivery-address1")?.value || "";
    const deliveryAddress2 =
      document.getElementById("appraisal-delivery-address2")?.value || "";

    if (deliveryName || deliveryPhone || deliveryAddress1) {
      const deliveryInfo = {
        name: deliveryName,
        phone: deliveryPhone,
        zipcode: deliveryZipcode,
        address1: deliveryAddress1,
        address2: deliveryAddress2,
      };
      formData.append("delivery_info", JSON.stringify(deliveryInfo));
    }
  }

  // 감정 결과 필드들 추가
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

  // 유효성 검사
  const brand = formData.get("brand");
  const modelName = formData.get("model_name");
  const category = formData.get("category");

  if (!brand || !modelName || !category) {
    showAlert("브랜드, 모델명, 카테고리는 필수 입력 항목입니다.", "error");
    return;
  }

  if (appraisalType === "quicklink") {
    const productLink = formData.get("product_link");
    if (!productLink) {
      showAlert("퀵링크 감정에는 상품 링크가 필요합니다.", "error");
      return;
    }
  }

  // 로딩 표시
  const submitButton = document.querySelector(
    'button[onclick="updateAppraisal()"]'
  );
  const originalText = submitButton.textContent;
  submitButton.textContent = "업데이트 중...";
  submitButton.disabled = true;

  // API 호출
  fetch(`/api/appr/admin/appraisals/${appraisalId}`, {
    method: "PUT",
    body: formData,
  })
    .then((response) => {
      if (!response.ok) {
        return response.json().then((data) => {
          throw new Error(data.message || "감정 정보 업데이트에 실패했습니다.");
        });
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
    })
    .finally(() => {
      // 버튼 상태 복원
      submitButton.textContent = originalText;
      submitButton.disabled = false;
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
// 감정 생성 제출 함수 - 수정된 버전
function submitCreateAppraisal() {
  // 폼 데이터 수집
  const formData = {
    user_id: document.getElementById("create-user-id").value,
    appraisal_type: document.getElementById("create-appraisal-type").value,
    brand: document.getElementById("create-brand").value,
    model_name: document.getElementById("create-model-name").value,
    category: document.getElementById("create-category").value,
    remarks: document.getElementById("create-remarks").value,
  };

  // 선택사항 필드
  const certificateNumber = document.getElementById(
    "create-certificate-number"
  ).value;
  if (certificateNumber) {
    formData.certificate_number = certificateNumber;
  }

  // 감정 유형별 필드
  if (formData.appraisal_type === "quicklink") {
    formData.product_link = document.getElementById(
      "create-product-link"
    ).value;
    formData.platform = document.getElementById("create-platform").value;
  } else if (formData.appraisal_type === "offline") {
    const purchaseYear = document.getElementById("create-purchase-year").value;
    if (purchaseYear) {
      formData.purchase_year = parseInt(purchaseYear);
    }

    // 구성품 수집
    const componentInputs = document.querySelectorAll(".component-input");
    const components = Array.from(componentInputs)
      .map((input) => input.value.trim())
      .filter((value) => value);
    if (components.length > 0) {
      formData.components_included = components;
    }

    // 배송 정보 수집
    const deliveryName = document.getElementById("create-delivery-name").value;
    const deliveryPhone = document.getElementById(
      "create-delivery-phone"
    ).value;
    const deliveryZipcode = document.getElementById(
      "create-delivery-zipcode"
    ).value;
    const deliveryAddress1 = document.getElementById(
      "create-delivery-address1"
    ).value;
    const deliveryAddress2 = document.getElementById(
      "create-delivery-address2"
    ).value;

    if (deliveryName || deliveryPhone || deliveryAddress1) {
      formData.delivery_info = {
        name: deliveryName,
        phone: deliveryPhone,
        zipcode: deliveryZipcode,
        address1: deliveryAddress1,
        address2: deliveryAddress2,
      };
    }
  }

  // 유효성 검사
  if (!formData.user_id) {
    showAlert("사용자 ID를 입력해주세요.", "error");
    return;
  }

  if (formData.appraisal_type === "quicklink" && !formData.product_link) {
    showAlert("퀵링크 감정에는 상품 링크가 필요합니다.", "error");
    return;
  }

  // API 호출
  fetch("/api/appr/admin/appraisals", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(formData),
  })
    .then((response) => response.json())
    .then((data) => {
      if (data.success) {
        showAlert("감정이 성공적으로 생성되었습니다.", "success");
        closeModal("create-appraisal-modal");
        loadAppraisalList(); // 목록 새로고침
      } else {
        throw new Error(data.message || "감정 생성에 실패했습니다.");
      }
    })
    .catch((error) => {
      showAlert(error.message, "error");
    });
}
