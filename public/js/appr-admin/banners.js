// public/js/appr-admin/banners.js
// 배너 관리 관련 JavaScript 함수들

let currentBannerPage = 1;
const bannerPageLimit = 20;

// 배너 목록 로드 함수
function loadBannerList(page = 1, status = "all") {
  currentBannerPage = page;

  let url = `/api/appr/admin/banners`;
  const params = new URLSearchParams();

  if (status !== "all") {
    params.append("is_active", status);
  }

  if (params.toString()) {
    url += "?" + params.toString();
  }

  fetch(url)
    .then((response) => response.json())
    .then((data) => {
      if (data.success) {
        displayBannerList(data.banners);
      } else {
        showError("배너 목록을 불러오는데 실패했습니다: " + data.message);
      }
    })
    .catch((error) => {
      console.error("Error loading banner list:", error);
      showError("배너 목록을 불러오는 중 오류가 발생했습니다.");
    });
}

// 배너 목록 표시 함수
function displayBannerList(banners) {
  const bannerList = document.getElementById("banners-list");

  if (!banners || banners.length === 0) {
    bannerList.innerHTML = `
      <tr>
        <td colspan="8" style="text-align: center; color: #666;">
          등록된 배너가 없습니다.
        </td>
      </tr>
    `;
    return;
  }

  bannerList.innerHTML = banners
    .map(
      (banner) => `
    <tr>
      <td>
        <div style="font-weight: 500; color: #1a2a3a;">${
          banner.title || "-"
        }</div>
      </td>
      <td>
        <div style="color: #4a5568;">${banner.subtitle || "-"}</div>
      </td>
      <td>
        <div style="max-width: 200px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${
          banner.description || ""
        }">
          ${banner.description}
        </div>
      </td>
      <td>
        ${
          banner.banner_image
            ? `<img src="${banner.banner_image}" style="width: 60px; height: 30px; object-fit: cover; border-radius: 4px;" alt="배너 이미지">`
            : '<span style="color: #666;">-</span>'
        }
      </td>
      <td>
        <div style="color: #4a5568;">${banner.button_text || "-"}</div>
      </td>
      <td>
        <span class="badge badge-info">${banner.display_order}</span>
      </td>
      <td>
        ${
          banner.is_active
            ? '<span class="badge badge-success">활성화</span>'
            : '<span class="badge badge-error">비활성화</span>'
        }
      </td>
      <td>
        <button class="btn btn-outline" style="margin-right: 5px; padding: 5px 10px; font-size: 0.8rem;" 
                onclick="editBanner('${banner.id}')">
          수정
        </button>
        <button class="btn" style="background-color: #dc2626; padding: 5px 10px; font-size: 0.8rem;" 
                onclick="deleteBanner('${banner.id}')">
          삭제
        </button>
      </td>
    </tr>
  `
    )
    .join("");
}

// 새 배너 추가 모달 열기
function openAddBannerModal() {
  document.getElementById("banner-modal-title").textContent = "배너 추가";
  document.getElementById("banner-form").reset();
  document.getElementById("banner-id").value = "";
  document.getElementById("banner-image-preview").innerHTML = "";
  document.querySelector(
    'input[name="banner-active"][value="true"]'
  ).checked = true;
  openModal("banner-modal");
}

// 배너 수정 모달 열기
function editBanner(bannerId) {
  fetch(`/api/appr/admin/banners`)
    .then((response) => response.json())
    .then((data) => {
      if (data.success) {
        const banner = data.banners.find((b) => b.id === bannerId);
        if (banner) {
          document.getElementById("banner-modal-title").textContent =
            "배너 수정";
          document.getElementById("banner-id").value = banner.id;
          document.getElementById("banner-title").value = banner.title || "";
          document.getElementById("banner-subtitle").value =
            banner.subtitle || "";
          document.getElementById("banner-description").value =
            banner.description || "";
          document.getElementById("banner-button-text").value =
            banner.button_text || "";
          document.getElementById("banner-button-link").value =
            banner.button_link || "";
          document.getElementById("banner-display-order").value =
            banner.display_order || 0;

          // 활성화 상태 설정
          document.querySelector(
            `input[name="banner-active"][value="${banner.is_active == 1}"]`
          ).checked = true;

          // 기존 이미지 미리보기
          const imagePreview = document.getElementById("banner-image-preview");
          if (banner.banner_image) {
            imagePreview.innerHTML = `
              <div style="margin-top: 10px;">
                <p style="font-size: 0.9rem; color: #666; margin-bottom: 5px;">현재 이미지:</p>
                <img src="${banner.banner_image}" style="max-width: 200px; max-height: 100px; border-radius: 4px;">
              </div>
            `;
          } else {
            imagePreview.innerHTML = "";
          }

          openModal("banner-modal");
        }
      } else {
        showError("배너 정보를 불러오는데 실패했습니다.");
      }
    })
    .catch((error) => {
      console.error("Error loading banner details:", error);
      showError("배너 정보를 불러오는 중 오류가 발생했습니다.");
    });
}

// 배너 삭제
function deleteBanner(bannerId) {
  if (!confirm("정말로 이 배너를 삭제하시겠습니까?")) {
    return;
  }

  fetch(`/api/appr/admin/banners/${bannerId}`, {
    method: "DELETE",
  })
    .then((response) => response.json())
    .then((data) => {
      if (data.success) {
        showAlert("배너가 성공적으로 삭제되었습니다.", "success");
        loadBannerList(currentBannerPage);
      } else {
        showError("배너 삭제에 실패했습니다: " + data.message);
      }
    })
    .catch((error) => {
      console.error("Error deleting banner:", error);
      showError("배너 삭제 중 오류가 발생했습니다.");
    });
}

// 배너 이미지 미리보기
function handleBannerImagePreview() {
  const fileInput = document.getElementById("banner-image");
  const previewContainer = document.getElementById("banner-image-preview");

  fileInput.addEventListener("change", function (e) {
    const file = e.target.files[0];
    if (file) {
      createImagePreview(file, previewContainer);
    } else {
      previewContainer.innerHTML = "";
    }
  });
}

// 배너 폼 제출 처리
function handleBannerFormSubmit() {
  document
    .getElementById("banner-form")
    .addEventListener("submit", function (e) {
      e.preventDefault();

      const bannerId = document.getElementById("banner-id").value;
      const isEdit = !!bannerId;

      // 폼 데이터 수집
      const formData = new FormData();
      formData.append(
        "title",
        document.getElementById("banner-title").value.trim()
      );
      formData.append(
        "subtitle",
        document.getElementById("banner-subtitle").value.trim()
      );
      formData.append(
        "description",
        getElementById("banner-description").value.trim()
      );
      formData.append(
        "button_text",
        document.getElementById("banner-button-text").value.trim()
      );
      formData.append(
        "button_link",
        document.getElementById("banner-button-link").value.trim()
      );
      formData.append(
        "display_order",
        document.getElementById("banner-display-order").value
      );
      formData.append(
        "is_active",
        document.querySelector('input[name="banner-active"]:checked').value
      );

      // 이미지 파일 추가
      const imageFile = document.getElementById("banner-image").files[0];
      if (imageFile) {
        formData.append("banner_image", imageFile);
      }

      // API 요청
      const url = isEdit
        ? `/api/appr/admin/banners/${bannerId}`
        : "/api/appr/admin/banners";
      const method = isEdit ? "PUT" : "POST";

      fetch(url, {
        method: method,
        body: formData,
      })
        .then((response) => response.json())
        .then((data) => {
          if (data.success) {
            showAlert(
              `배너가 성공적으로 ${isEdit ? "수정" : "추가"}되었습니다.`,
              "success"
            );
            closeModal("banner-modal");
            loadBannerList(currentBannerPage);
          } else {
            showError(
              `배너 ${isEdit ? "수정" : "추가"}에 실패했습니다: ` + data.message
            );
          }
        })
        .catch((error) => {
          console.error("Error saving banner:", error);
          showError(`배너 ${isEdit ? "수정" : "추가"} 중 오류가 발생했습니다.`);
        });
    });
}

// 배너 상태 필터 처리
function handleBannerStatusFilter() {
  document
    .getElementById("banner-status-filter")
    .addEventListener("change", function (e) {
      loadBannerList(1, e.target.value);
    });
}

// 이벤트 리스너 설정
document.addEventListener("DOMContentLoaded", function () {
  // 새 배너 추가 버튼
  const addBannerBtn = document.getElementById("add-banner-btn");
  if (addBannerBtn) {
    addBannerBtn.addEventListener("click", openAddBannerModal);
  }

  // 배너 이미지 미리보기 설정
  handleBannerImagePreview();

  // 배너 폼 제출 처리
  handleBannerFormSubmit();

  // 배너 상태 필터 처리
  handleBannerStatusFilter();
});

// 전역으로 노출할 함수들
window.loadBannerList = loadBannerList;
window.editBanner = editBanner;
window.deleteBanner = deleteBanner;
