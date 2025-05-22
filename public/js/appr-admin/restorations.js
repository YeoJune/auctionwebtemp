// public/js/appr-admin/restorations.js - 복원 서비스 관리 관련 기능

// 전역 변수
let restorationServices = [];

// 페이지 로드시 이벤트 리스너 등록
document.addEventListener("DOMContentLoaded", function () {
  // 복원 서비스 추가 버튼 이벤트
  document
    .getElementById("add-restoration-service-btn")
    .addEventListener("click", function () {
      // 모달 초기화
      resetRestorationServiceForm();
      // 모달 타이틀 설정
      document.getElementById("restoration-service-modal-title").textContent =
        "복원 서비스 추가";
      // 모달 표시
      openModal("restoration-service-modal");
    });

  // 복원 서비스 폼 제출 이벤트
  document
    .getElementById("restoration-service-form")
    .addEventListener("submit", function (e) {
      e.preventDefault();
      submitRestorationService();
    });

  // 이미지 미리보기 이벤트
  document
    .getElementById("restoration-service-before-image")
    .addEventListener("change", function () {
      createImagePreview(
        this.files[0],
        document.getElementById("before-image-preview")
      );
    });

  document
    .getElementById("restoration-service-after-image")
    .addEventListener("change", function () {
      createImagePreview(
        this.files[0],
        document.getElementById("after-image-preview")
      );
    });
});

// 복원 서비스 목록 로드
function loadRestorationServiceList() {
  // 로딩 표시
  document.getElementById("restoration-services-list").innerHTML =
    '<tr><td colspan="6" style="text-align: center;">서비스 데이터를 불러오는 중...</td></tr>';

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
        // 전역 변수에 서비스 목록 저장
        restorationServices = data.services;
        displayRestorationServices(data.services);
      } else {
        throw new Error(
          data.message || "복원 서비스 목록을 불러오는데 실패했습니다."
        );
      }
    })
    .catch((error) => {
      document.getElementById(
        "restoration-services-list"
      ).innerHTML = `<tr><td colspan="6" style="text-align: center;">오류: ${error.message}</td></tr>`;
    });
}

// 복원 서비스 목록 표시
function displayRestorationServices(services) {
  const tableBody = document.getElementById("restoration-services-list");

  // 데이터가 없는 경우
  if (!services || services.length === 0) {
    tableBody.innerHTML =
      '<tr><td colspan="6" style="text-align: center;">등록된 복원 서비스가 없습니다.</td></tr>';
    return;
  }

  // 테이블 내용 생성
  let html = "";
  services.forEach((service) => {
    // 가격 표시 로직 수정 - 문자열일 수도 있음
    let priceDisplay = service.price;
    if (!isNaN(parseFloat(service.price))) {
      // 숫자인 경우에만 천 단위 구분자 추가
      priceDisplay = parseFloat(service.price).toLocaleString();
    }
    // 문자열인 경우 그대로 표시

    html += `<tr>
            <td>${service.name}</td>
            <td>${
              service.description.length > 50
                ? service.description.substring(0, 50) + "..."
                : service.description
            }</td>
            <td>${priceDisplay}</td>
            <td>${service.estimated_days}</td>
            <td>${
              service.is_active
                ? '<span class="badge badge-success">활성화</span>'
                : '<span class="badge badge-error">비활성화</span>'
            }</td>
            <td>
                <button class="btn btn-outline" onclick="editRestorationService('${
                  service.id
                }')">수정</button>
                ${
                  service.is_active
                    ? `<button class="btn btn-outline" style="margin-left: 5px;" onclick="deleteRestorationService('${service.id}')">비활성화</button>`
                    : `<button class="btn btn-outline" style="margin-left: 5px;" onclick="activateRestorationService('${service.id}')">활성화</button>`
                }
            </td>
        </tr>`;
  });

  tableBody.innerHTML = html;
}

// 복원 서비스 폼 초기화
function resetRestorationServiceForm() {
  document.getElementById("restoration-service-form").reset();
  document.getElementById("restoration-service-id").value = "";
  document.getElementById("before-image-preview").innerHTML = "";
  document.getElementById("after-image-preview").innerHTML = "";
  document.querySelector(
    'input[name="restoration-service-active"][value="true"]'
  ).checked = true;
}

// 복원 서비스 수정 모달 열기
function editRestorationService(serviceId) {
  // 모달 초기화
  resetRestorationServiceForm();

  // 로딩 표시
  document.getElementById("restoration-service-modal-title").textContent =
    "복원 서비스 수정";
  openModal("restoration-service-modal");

  // 전역 변수에서 서비스 정보 찾기
  const service = restorationServices.find((s) => s.id === serviceId);

  if (service) {
    populateRestorationServiceForm(service);
  } else {
    showAlert("서비스 정보를 찾을 수 없습니다.", "error");
    closeModal("restoration-service-modal");
  }
}

// 복원 서비스 폼에 데이터 채우기
function populateRestorationServiceForm(service) {
  document.getElementById("restoration-service-id").value = service.id;
  document.getElementById("restoration-service-name").value = service.name;
  document.getElementById("restoration-service-description").value =
    service.description;
  document.getElementById("restoration-service-price").value = service.price;
  document.getElementById("restoration-service-days").value =
    service.estimated_days;

  // 활성화 상태 설정
  document.querySelector(
    `input[name="restoration-service-active"][value="${service.is_active}"]`
  ).checked = true;

  // 이미지 미리보기 설정
  if (service.before_image) {
    document.getElementById(
      "before-image-preview"
    ).innerHTML = `<img src="${service.before_image}" style="max-width: 100%; max-height: 200px;">`;
  }

  if (service.after_image) {
    document.getElementById(
      "after-image-preview"
    ).innerHTML = `<img src="${service.after_image}" style="max-width: 100%; max-height: 200px;">`;
  }
}

// 복원 서비스 폼 제출 처리
function submitRestorationService() {
  const serviceId = document.getElementById("restoration-service-id").value;
  const isNewService = !serviceId;

  // 폼 데이터 생성
  const formData = new FormData();
  formData.append(
    "name",
    document.getElementById("restoration-service-name").value
  );
  formData.append(
    "description",
    document.getElementById("restoration-service-description").value
  );
  formData.append(
    "price",
    document.getElementById("restoration-service-price").value
  );
  formData.append(
    "estimated_days",
    document.getElementById("restoration-service-days").value
  );

  // 새 서비스 추가가 아닌 수정일 경우에만 is_active 전송
  if (!isNewService) {
    formData.append(
      "is_active",
      document.querySelector('input[name="restoration-service-active"]:checked')
        .value
    );
  }

  // 이미지 파일 추가
  const beforeImage = document.getElementById(
    "restoration-service-before-image"
  ).files[0];
  if (beforeImage) {
    formData.append("before_image", beforeImage);
  }

  const afterImage = document.getElementById("restoration-service-after-image")
    .files[0];
  if (afterImage) {
    formData.append("after_image", afterImage);
  }

  // API URL 및 메서드 설정
  const url = isNewService
    ? "/api/appr/admin/restoration-services"
    : `/api/appr/admin/restoration-services/${serviceId}`;

  const method = isNewService ? "POST" : "PUT";

  // API 호출
  fetch(url, {
    method: method,
    body: formData,
  })
    .then((response) => {
      if (!response.ok) {
        throw new Error("복원 서비스 저장에 실패했습니다.");
      }
      return response.json();
    })
    .then((data) => {
      if (data.success) {
        showAlert(
          isNewService
            ? "복원 서비스가 추가되었습니다."
            : "복원 서비스가 수정되었습니다.",
          "success"
        );
        closeModal("restoration-service-modal");
        loadRestorationServiceList(); // 목록 갱신
      } else {
        throw new Error(data.message || "복원 서비스 저장에 실패했습니다.");
      }
    })
    .catch((error) => {
      showAlert(error.message, "error");
    });
}

// 복원 서비스 비활성화
function deleteRestorationService(serviceId) {
  if (!confirm("정말 이 서비스를 비활성화하시겠습니까?")) {
    return;
  }

  // API 호출
  fetch(`/api/appr/admin/restoration-services/${serviceId}`, {
    method: "DELETE",
  })
    .then((response) => {
      if (!response.ok) {
        throw new Error("복원 서비스 비활성화에 실패했습니다.");
      }
      return response.json();
    })
    .then((data) => {
      if (data.success) {
        showAlert("복원 서비스가 비활성화되었습니다.", "success");
        loadRestorationServiceList(); // 목록 갱신
      } else {
        throw new Error(data.message || "복원 서비스 비활성화에 실패했습니다.");
      }
    })
    .catch((error) => {
      showAlert(error.message, "error");
    });
}

// 복원 서비스 활성화
function activateRestorationService(serviceId) {
  if (!confirm("정말 이 서비스를 활성화하시겠습니까?")) {
    return;
  }

  // 폼 데이터 생성
  const formData = new FormData();
  formData.append("is_active", true);

  // API 호출
  fetch(`/api/appr/admin/restoration-services/${serviceId}`, {
    method: "PUT",
    body: formData,
  })
    .then((response) => {
      if (!response.ok) {
        throw new Error("복원 서비스 활성화에 실패했습니다.");
      }
      return response.json();
    })
    .then((data) => {
      if (data.success) {
        showAlert("복원 서비스가 활성화되었습니다.", "success");
        loadRestorationServiceList(); // 목록 갱신
      } else {
        throw new Error(data.message || "복원 서비스 활성화에 실패했습니다.");
      }
    })
    .catch((error) => {
      showAlert(error.message, "error");
    });
}
