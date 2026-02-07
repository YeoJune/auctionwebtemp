// 다운로드 진행률 표시 관련 함수들

/**
 * 다운로드 진행률 모달 표시
 * @param {string} message - 표시할 메시지
 * @param {number} progress - 진행률 (0-100)
 */
function showDownloadProgress(message, progress) {
  let modal = document.getElementById("downloadProgressModal");

  // 모달이 없으면 생성
  if (!modal) {
    modal = createDownloadProgressModal();
  }

  updateDownloadProgress(progress, message);
  modal.style.display = "flex";
}

/**
 * 다운로드 진행률 업데이트
 * @param {number} progress - 진행률 (0-100)
 * @param {string} message - 표시할 메시지
 */
function updateDownloadProgress(progress, message) {
  const progressBar = document.getElementById("downloadProgressBar");
  const progressText = document.getElementById("downloadProgressText");
  const progressPercent = document.getElementById("downloadProgressPercent");

  if (progressBar) {
    progressBar.style.width = `${progress}%`;
    progressBar.setAttribute("aria-valuenow", progress);
  }

  if (progressText) {
    progressText.textContent = message || "다운로드 중...";
  }

  if (progressPercent) {
    progressPercent.textContent = `${Math.round(progress)}%`;
  }
}

/**
 * 다운로드 진행률 모달 숨기기
 */
function hideDownloadProgress() {
  const modal = document.getElementById("downloadProgressModal");
  if (modal) {
    modal.style.display = "none";
  }
}

/**
 * 다운로드 진행률 모달 HTML 생성
 * @returns {HTMLElement} 생성된 모달 요소
 */
function createDownloadProgressModal() {
  const modal = document.createElement("div");
  modal.id = "downloadProgressModal";
  modal.className = "modal-overlay";
  modal.style.cssText =
    "display: none; align-items: center; justify-content: center;";

  modal.innerHTML = `
    <div class="modal-dialog" style="max-width: 500px; width: 90%;">
      <div class="modal-header">
        <h3 class="modal-title">파일 다운로드</h3>
      </div>
      <div class="modal-body">
        <p id="downloadProgressText" style="margin-bottom: 15px; text-align: center; font-size: 14px;">
          다운로드 준비 중...
        </p>
        <div style="width: 100%; background-color: #f0f0f0; border-radius: 4px; overflow: hidden; height: 30px; position: relative;">
          <div id="downloadProgressBar" 
               role="progressbar" 
               aria-valuenow="0" 
               aria-valuemin="0" 
               aria-valuemax="100"
               style="height: 100%; background: linear-gradient(90deg, #4CAF50 0%, #45a049 100%); width: 0%; transition: width 0.3s ease; display: flex; align-items: center; justify-content: center;">
            <span id="downloadProgressPercent" style="color: white; font-weight: bold; font-size: 14px; text-shadow: 0 1px 2px rgba(0,0,0,0.3);">0%</span>
          </div>
        </div>
        <p style="margin-top: 10px; text-align: center; font-size: 12px; color: #666;">
          잠시만 기다려주세요...
        </p>
      </div>
    </div>
  `;

  document.body.appendChild(modal);
  return modal;
}
