// public/js/admin/recommend-filters.js

document.addEventListener("DOMContentLoaded", () => {
  // 필터 섹션 초기화
  initFilterSection();

  // 추천 규칙 섹션 초기화
  initRecommendSection();
});

// =======================================================================
// 필터 설정 섹션 (Filter Settings Section)
// =======================================================================

// 필터 상태를 저장할 변수
let originalFilterSettings = [];
let modifiedFilterSettings = {}; // 변경된 필터만 추적: { "key": { type, value, isEnabled }, ... }

function initFilterSection() {
  // 버튼 이벤트 리스너 등록
  document
    .getElementById("applyFilterBtn")
    .addEventListener("click", applyFilterChanges);
  document
    .getElementById("cancelFilterBtn")
    .addEventListener("click", revertFilterChanges);

  // 필터 데이터 불러오기 및 표시
  fetchAndDisplayFilters();
}

// 서버에서 필터 설정을 가져와 화면에 표시
async function fetchAndDisplayFilters() {
  try {
    showLoading("dateFilters");
    showLoading("brandFilters");
    showLoading("categoryFilters");

    const settings = await fetchFilterSettings();
    originalFilterSettings = settings; // 원본 데이터 저장
    modifiedFilterSettings = {}; // 변경 내역 초기화

    displayFilters(originalFilterSettings);
  } catch (error) {
    handleError(error, "필터 설정을 불러오는 데 실패했습니다.");
  }
}

// 필터 데이터를 화면에 렌더링
function displayFilters(settings) {
  const filtersByType = {
    date: [],
    brand: [],
    category: [],
  };

  settings.forEach((s) => {
    if (filtersByType[s.filter_type]) {
      filtersByType[s.filter_type].push(s);
    }
  });

  document.getElementById("dateFilters").innerHTML = filtersByType.date
    .map(createFilterToggleHTML)
    .join("");
  document.getElementById("brandFilters").innerHTML = filtersByType.brand
    .map(createFilterToggleHTML)
    .join("");
  document.getElementById("categoryFilters").innerHTML = filtersByType.category
    .map(createFilterToggleHTML)
    .join("");
}

// 개별 필터 토글 HTML 생성
function createFilterToggleHTML(filter) {
  const key = `${filter.filter_type}:${filter.filter_value}`;
  return `
    <div class="filter-item">
      <label class="toggle-switch">
        <input type="checkbox" 
          ${filter.is_enabled ? "checked" : ""} 
          onchange="handleFilterChange('${filter.filter_type}', '${
    filter.filter_value
  }', this.checked)">
        <span class="toggle-slider"></span>
      </label>
      <span class="filter-value">${filter.filter_value}</span>
    </div>
  `;
}

// 필터 토글 변경 시 호출될 함수
function handleFilterChange(filterType, filterValue, isEnabled) {
  const key = `${filterType}:${filterValue}`;
  modifiedFilterSettings[key] = {
    filterType,
    filterValue,
    isEnabled,
  };
  console.log("변경됨:", modifiedFilterSettings);
}

// '변경사항 적용' 버튼 클릭 시
async function applyFilterChanges() {
  const changes = Object.values(modifiedFilterSettings);
  if (changes.length === 0) {
    showAlert("변경된 내용이 없습니다.", "info");
    return;
  }

  if (!confirmAction("변경된 필터 설정을 적용하시겠습니까?")) return;

  try {
    await updateFilterSettingsBatch(changes);
    showAlert("필터 설정이 성공적으로 업데이트되었습니다.", "success");
    fetchAndDisplayFilters(); // 데이터 다시 로드
  } catch (error) {
    handleError(error, "필터 설정 업데이트에 실패했습니다.");
  }
}

// '변경 취소' 버튼 클릭 시
function revertFilterChanges() {
  if (Object.keys(modifiedFilterSettings).length === 0) {
    return; // 변경된게 없으면 아무것도 안함
  }
  displayFilters(originalFilterSettings); // 원본 데이터로 다시 렌더링
  modifiedFilterSettings = {}; // 변경 내역 초기화
  showAlert("변경이 취소되었습니다.", "info");
}

// =======================================================================
// 추천 규칙 설정 섹션 (Recommendation Rules Section)
// =======================================================================

let recommendRules = [];

function initRecommendSection() {
  // '새 규칙 추가' 버튼 이벤트 리스너
  document
    .getElementById("addRecommendRuleBtn")
    .addEventListener("click", () => {
      // 나중에 구현할 새 규칙 추가 UI 표시 함수
      console.log("새 규칙 추가 UI를 엽니다.");
    });

  // 추천 규칙 불러오기
  fetchAndDisplayRecommendRules();
}

// 추천 규칙 불러와서 표시
async function fetchAndDisplayRecommendRules() {
  try {
    showLoading("recommendRulesContainer");
    recommendRules = await fetchRecommendSettings();
    displayRecommendRules();
  } catch (error) {
    handleError(error, "추천 규칙을 불러오는 데 실패했습니다.");
  }
}

// 추천 규칙 목록을 화면에 렌더링 (현재는 비어있음)
function displayRecommendRules() {
  const container = document.getElementById("recommendRulesContainer");
  if (recommendRules.length === 0) {
    showNoData(
      "recommendRulesContainer",
      "등록된 추천 규칙이 없습니다. '새 규칙 추가' 버튼을 눌러 규칙을 만들어보세요."
    );
    return;
  }
  // 나중에 실제 규칙을 표시하는 로직 구현
  container.innerHTML = `
    <p>총 ${recommendRules.length}개의 규칙이 있습니다.</p>
    `;
}
