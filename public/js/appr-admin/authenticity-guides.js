// public/js/appr-admin/authenticity-guides.js - 정품 구별법 관리 관련 기능

// 전역 변수
let currentBrandFilter = "all";
let authenticityGuides = [];

// 페이지 로드 시 이벤트 리스너 설정
document.addEventListener("DOMContentLoaded", function () {
  // 브랜드 필터 변경 이벤트
  document
    .getElementById("authenticity-guide-brand-filter")
    .addEventListener("change", function () {
      currentBrandFilter = this.value;
      loadAuthenticityGuides();
    });

  // 정품 구별법 추가 버튼 이벤트
  document
    .getElementById("add-authenticity-guide-btn")
    .addEventListener("click", function () {
      // 모달 초기화
      resetAuthenticityGuideForm();
      // 모달 타이틀 설정
      document.getElementById("authenticity-guide-modal-title").textContent =
        "정품 구별법 추가";
      // 모달 표시
      openModal("authenticity-guide-modal");
    });

  // 정품 구별법 폼 제출 이벤트
  document
    .getElementById("authenticity-guide-form")
    .addEventListener("submit", function (e) {
      e.preventDefault();
      submitAuthenticityGuide();
    });

  // 이미지 미리보기 이벤트
  document
    .getElementById("authenticity-guide-authentic-image")
    .addEventListener("change", function () {
      createImagePreview(
        this.files[0],
        document.getElementById("authentic-image-preview")
      );
    });

  document
    .getElementById("authenticity-guide-fake-image")
    .addEventListener("change", function () {
      createImagePreview(
        this.files[0],
        document.getElementById("fake-image-preview")
      );
    });
});

// 정품 구별법 목록 로드 함수
function loadAuthenticityGuides() {
  // 로딩 표시
  document.getElementById("authenticity-guides-list").innerHTML =
    '<tr><td colspan="6" style="text-align: center;">정품 구별법 데이터를 불러오는 중...</td></tr>';

  // API URL 생성
  let url = "/api/appr/admin/authenticity-guides";

  // 브랜드 필터 적용
  if (currentBrandFilter !== "all") {
    url += `?brand=${encodeURIComponent(currentBrandFilter)}`;
  }

  // API 호출
  fetch(url)
    .then((response) => {
      if (!response.ok) {
        throw new Error("정품 구별법 목록을 불러오는데 실패했습니다.");
      }
      return response.json();
    })
    .then((data) => {
      if (data.success) {
        // 전역 변수에 구별법 목록 저장
        authenticityGuides = data.guides;
        displayAuthenticityGuides(data.guides);
      } else {
        throw new Error(
          data.message || "정품 구별법 목록을 불러오는데 실패했습니다."
        );
      }
    })
    .catch((error) => {
      document.getElementById(
        "authenticity-guides-list"
      ).innerHTML = `<tr><td colspan="6" style="text-align: center;">오류: ${error.message}</td></tr>`;
    });
}

// 정품 구별법 목록 표시 함수
function displayAuthenticityGuides(guides) {
  const tableBody = document.getElementById("authenticity-guides-list");

  // 데이터가 없는 경우
  if (!guides || guides.length === 0) {
    tableBody.innerHTML =
      '<tr><td colspan="6" style="text-align: center;">등록된 정품 구별법이 없습니다.</td></tr>';
    return;
  }

  // 브랜드별로 그룹화
  const groupedGuides = {};
  guides.forEach((guide) => {
    if (!groupedGuides[guide.brand]) {
      groupedGuides[guide.brand] = [];
    }
    groupedGuides[guide.brand].push(guide);
  });

  // 테이블 내용 생성
  let html = "";

  for (const brand in groupedGuides) {
    // 브랜드 헤더 행
    html += `
      <tr class="brand-header" style="background-color: #f1f5f9;">
        <td colspan="6">
          <strong>${brand}</strong> (총 ${groupedGuides[brand].length}개 구별법)
        </td>
      </tr>
    `;

    // 브랜드별 구별법 목록
    groupedGuides[brand].forEach((guide) => {
      html += `<tr>
              <td>${guide.title}</td>
              <td>${guide.guide_type}</td>
              <td>${
                guide.description.length > 30
                  ? guide.description.substring(0, 30) + "..."
                  : guide.description
              }</td>
              <td>${
                guide.authentic_image
                  ? '<span class="badge badge-success">있음</span>'
                  : '<span class="badge badge-warning">없음</span>'
              }</td>
              <td>${
                guide.is_active
                  ? '<span class="badge badge-success">활성화</span>'
                  : '<span class="badge badge-error">비활성화</span>'
              }</td>
              <td>
                  <button class="btn btn-outline" onclick="editAuthenticityGuide('${
                    guide.id
                  }')">수정</button>
                  ${
                    guide.is_active
                      ? `<button class="btn btn-outline" style="margin-left: 5px;" onclick="deleteAuthenticityGuide('${guide.id}')">비활성화</button>`
                      : `<button class="btn btn-outline" style="margin-left: 5px;" onclick="activateAuthenticityGuide('${guide.id}')">활성화</button>`
                  }
              </td>
          </tr>`;
    });
  }

  tableBody.innerHTML = html;
}

// 정품 구별법 폼 초기화
function resetAuthenticityGuideForm() {
  document.getElementById("authenticity-guide-form").reset();
  document.getElementById("authenticity-guide-id").value = "";
  document.getElementById("authentic-image-preview").innerHTML = "";
  document.getElementById("fake-image-preview").innerHTML = "";
  document.querySelector(
    'input[name="authenticity-guide-active"][value="true"]'
  ).checked = true;
}

// 정품 구별법 수정 모달 열기
function editAuthenticityGuide(guideId) {
  // 모달 초기화
  resetAuthenticityGuideForm();

  // 로딩 표시
  document.getElementById("authenticity-guide-modal-title").textContent =
    "정품 구별법 수정";
  openModal("authenticity-guide-modal");

  // 전역 변수에서 구별법 정보 찾기
  const guide = authenticityGuides.find((g) => g.id === guideId);

  if (guide) {
    populateAuthenticityGuideForm(guide);
  } else {
    showAlert("정품 구별법 정보를 찾을 수 없습니다.", "error");
    closeModal("authenticity-guide-modal");
  }
}

// 정품 구별법 폼에 데이터 채우기
function populateAuthenticityGuideForm(guide) {
  document.getElementById("authenticity-guide-id").value = guide.id;
  document.getElementById("authenticity-guide-brand").value = guide.brand;
  document.getElementById("authenticity-guide-type").value = guide.guide_type;
  document.getElementById("authenticity-guide-title").value = guide.title;
  document.getElementById("authenticity-guide-description").value =
    guide.description;

  // 활성화 상태 설정
  document.querySelector(
    `input[name="authenticity-guide-active"][value="${guide.is_active}"]`
  ).checked = true;

  // 이미지 미리보기 설정
  if (guide.authentic_image) {
    document.getElementById(
      "authentic-image-preview"
    ).innerHTML = `<img src="${guide.authentic_image}" style="max-width: 100%; max-height: 200px;">`;
  }

  if (guide.fake_image) {
    document.getElementById(
      "fake-image-preview"
    ).innerHTML = `<img src="${guide.fake_image}" style="max-width: 100%; max-height: 200px;">`;
  }
}

// 정품 구별법 폼 제출 처리
function submitAuthenticityGuide() {
  const guideId = document.getElementById("authenticity-guide-id").value;
  const isNewGuide = !guideId;

  // 폼 데이터 생성
  const formData = new FormData();
  formData.append(
    "brand",
    document.getElementById("authenticity-guide-brand").value
  );
  formData.append(
    "guide_type",
    document.getElementById("authenticity-guide-type").value
  );
  formData.append(
    "title",
    document.getElementById("authenticity-guide-title").value
  );
  formData.append(
    "description",
    document.getElementById("authenticity-guide-description").value
  );

  // 기존 구별법 수정인 경우에만 활성화 상태 전송
  if (!isNewGuide) {
    formData.append(
      "is_active",
      document.querySelector('input[name="authenticity-guide-active"]:checked')
        .value
    );
  }

  // 이미지 파일 추가
  const authenticImage = document.getElementById(
    "authenticity-guide-authentic-image"
  ).files[0];
  if (authenticImage) {
    formData.append("authentic_image", authenticImage);
  }

  const fakeImage = document.getElementById("authenticity-guide-fake-image")
    .files[0];
  if (fakeImage) {
    formData.append("fake_image", fakeImage);
  }

  // API URL 및 메서드 설정
  const url = isNewGuide
    ? "/api/appr/admin/authenticity-guides"
    : `/api/appr/admin/authenticity-guides/${guideId}`;

  const method = isNewGuide ? "POST" : "PUT";

  // API 호출
  fetch(url, {
    method: method,
    body: formData,
  })
    .then((response) => {
      if (!response.ok) {
        throw new Error("정품 구별법 저장에 실패했습니다.");
      }
      return response.json();
    })
    .then((data) => {
      if (data.success) {
        showAlert(
          isNewGuide
            ? "정품 구별법이 추가되었습니다."
            : "정품 구별법이 수정되었습니다.",
          "success"
        );
        closeModal("authenticity-guide-modal");
        loadAuthenticityGuides(); // 목록 갱신
      } else {
        throw new Error(data.message || "정품 구별법 저장에 실패했습니다.");
      }
    })
    .catch((error) => {
      showAlert(error.message, "error");
    });
}

// 정품 구별법 비활성화
function deleteAuthenticityGuide(guideId) {
  if (!confirm("정말 이 정품 구별법을 비활성화하시겠습니까?")) {
    return;
  }

  // API 호출
  fetch(`/api/appr/admin/authenticity-guides/${guideId}`, {
    method: "DELETE",
  })
    .then((response) => {
      if (!response.ok) {
        throw new Error("정품 구별법 비활성화에 실패했습니다.");
      }
      return response.json();
    })
    .then((data) => {
      if (data.success) {
        showAlert("정품 구별법이 비활성화되었습니다.", "success");
        loadAuthenticityGuides(); // 목록 갱신
      } else {
        throw new Error(data.message || "정품 구별법 비활성화에 실패했습니다.");
      }
    })
    .catch((error) => {
      showAlert(error.message, "error");
    });
}

// 정품 구별법 활성화
function activateAuthenticityGuide(guideId) {
  if (!confirm("정말 이 정품 구별법을 활성화하시겠습니까?")) {
    return;
  }

  // 폼 데이터 생성
  const formData = new FormData();
  formData.append("is_active", true);

  // API 호출
  fetch(`/api/appr/admin/authenticity-guides/${guideId}`, {
    method: "PUT",
    body: formData,
  })
    .then((response) => {
      if (!response.ok) {
        throw new Error("정품 구별법 활성화에 실패했습니다.");
      }
      return response.json();
    })
    .then((data) => {
      if (data.success) {
        showAlert("정품 구별법이 활성화되었습니다.", "success");
        loadAuthenticityGuides(); // 목록 갱신
      } else {
        throw new Error(data.message || "정품 구별법 활성화에 실패했습니다.");
      }
    })
    .catch((error) => {
      showAlert(error.message, "error");
    });
}
