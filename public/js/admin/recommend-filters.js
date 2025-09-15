// public/js/admin/recommend-filters.js

document.addEventListener("DOMContentLoaded", async () => {
  // 추천 규칙 UI에 필요한 데이터 미리 불러오기
  await loadPrerequisiteData();

  // 필터 섹션 초기화
  initFilterSection();

  // 추천 규칙 섹션 초기화
  initRecommendSection();
});

// =======================================================================
// 데이터 사전 로드 (Data Preloading)
// =======================================================================
let availableBrands = [];
let availableCategories = [];

async function loadPrerequisiteData() {
  try {
    // api.js에 fetchAvailableBrands, fetchAvailableCategories 추가 필요
    // 지금은 임시로 기존 /api/data/ 엔드포인트를 사용합니다.
    const brandData = await fetch("/api/data/brands").then((res) => res.json());
    const categoryData = await fetch("/api/data/categories").then((res) =>
      res.json()
    );
    availableBrands = brandData;
    availableCategories = categoryData;
  } catch (error) {
    handleError(error, "필터링 데이터를 불러오는 데 실패했습니다.");
  }
}

// =======================================================================
// 필터 설정 섹션 (Filter Settings Section)
// =======================================================================

let originalFilterSettings = [];
let modifiedFilterSettings = {};

function initFilterSection() {
  document
    .getElementById("applyFilterBtn")
    .addEventListener("click", applyFilterChanges);
  document
    .getElementById("cancelFilterBtn")
    .addEventListener("click", revertFilterChanges);
  fetchAndDisplayFilters();
}

// 로딩 상태 표시
function showLoading(containerId) {
  const container = document.getElementById(containerId);
  if (container) {
    container.innerHTML = `
      <div class="loading-container">
        <div class="loading-spinner"></div>
        <span>데이터를 불러오는 중...</span>
      </div>
    `;
  }
}

// 데이터 없음 메시지 표시
function showNoData(containerId, message) {
  const container = document.getElementById(containerId);
  if (container) {
    container.innerHTML = `<div class="no-data-message">${message}</div>`;
  }
}

// 에러 처리
function handleError(error, defaultMessage = "오류가 발생했습니다") {
  console.error("Error:", error);
  const message = error.message || defaultMessage;
  showAlert(message, "error");
}

async function fetchAndDisplayFilters() {
  try {
    showLoading("dateFilters");
    showLoading("brandFilters");
    showLoading("categoryFilters");
    const settings = await fetchFilterSettings();
    originalFilterSettings = JSON.parse(JSON.stringify(settings)); // Deep copy
    modifiedFilterSettings = {};
    displayFilters(settings);
  } catch (error) {
    handleError(error, "필터 설정을 불러오는 데 실패했습니다.");
  }
}

function displayFilters(settings) {
  const filtersByType = { date: [], brand: [], category: [] };
  settings.forEach((s) => filtersByType[s.filter_type]?.push(s));

  ["date", "brand", "category"].forEach((type) => {
    const container = document.getElementById(`${type}Filters`);
    if (filtersByType[type].length === 0) {
      container.innerHTML = `<div class="no-data-message">등록된 ${type} 필터가 없습니다.</div>`;
    } else {
      container.innerHTML = createFilterContainerHTML(
        type,
        filtersByType[type]
      );
    }
  });
}

function createFilterContainerHTML(type, filters) {
  let html = "";

  // 브랜드의 경우 검색 기능 추가
  if (type === "brand") {
    html += `
      <div class="brand-search-container">
        <input type="text" id="brandSearchInput" placeholder="브랜드 검색..." class="form-control brand-search">
      </div>
    `;
  }

  html += `<div class="filter-grid" id="${type}FilterGrid">`;
  html += filters.map(createFilterToggleHTML).join("");
  html += `</div>`;

  // 브랜드 검색 이벤트 리스너 추가
  if (type === "brand") {
    setTimeout(() => {
      const searchInput = document.getElementById("brandSearchInput");
      if (searchInput) {
        searchInput.addEventListener("input", (e) => {
          filterBrandList(e.target.value);
        });
      }
    }, 100);
  }

  return html;
}

function filterBrandList(searchTerm) {
  const brandGrid = document.getElementById("brandFilterGrid");
  const brandItems = brandGrid.querySelectorAll(".filter-item");

  brandItems.forEach((item) => {
    const brandName = item
      .querySelector(".filter-value")
      .textContent.toLowerCase();
    const matches = brandName.includes(searchTerm.toLowerCase());
    item.style.display = matches ? "flex" : "none";
  });
}

function createFilterToggleHTML(filter) {
  // 날짜 필터인 경우 시간 부분 제거
  let displayValue = filter.filter_value;
  if (filter.filter_type === "date") {
    // 날짜 문자열에서 시간 부분 제거 (YYYY-MM-DD 형태만 유지)
    displayValue = displayValue.split("T")[0].split(" ")[0];
  }

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
      <span class="filter-value">${displayValue}</span>
    </div>
  `;
}

function handleFilterChange(filterType, filterValue, isEnabled) {
  const key = `${filterType}:${filterValue}`;
  const original = originalFilterSettings.find(
    (s) => s.filter_type === filterType && s.filter_value === filterValue
  );

  // 원래 상태와 같아지면 변경 목록에서 제거, 다르면 추가
  if (original && original.is_enabled !== isEnabled) {
    modifiedFilterSettings[key] = { filterType, filterValue, isEnabled };
  } else {
    delete modifiedFilterSettings[key];
  }

  // 버튼 상태 업데이트
  updateFilterButtonStates();
}

function updateFilterButtonStates() {
  const hasChanges = Object.keys(modifiedFilterSettings).length > 0;
  const applyBtn = document.getElementById("applyFilterBtn");
  const cancelBtn = document.getElementById("cancelFilterBtn");

  if (applyBtn) {
    applyBtn.disabled = !hasChanges;
    applyBtn.textContent = hasChanges
      ? `변경사항 적용 (${Object.keys(modifiedFilterSettings).length})`
      : "변경사항 적용";
  }
  if (cancelBtn) {
    cancelBtn.disabled = !hasChanges;
  }
}

async function applyFilterChanges() {
  const changes = Object.values(modifiedFilterSettings);
  if (changes.length === 0) {
    showAlert("변경된 내용이 없습니다.", "info");
    return;
  }
  if (!confirmAction(`${changes.length}개의 필터 설정을 적용하시겠습니까?`))
    return;

  try {
    const applyBtn = document.getElementById("applyFilterBtn");
    if (applyBtn) {
      applyBtn.disabled = true;
      applyBtn.innerHTML = '<div class="loading-spinner"></div> 적용 중...';
    }

    await updateFilterSettingsBatch(changes);
    showAlert("필터 설정이 성공적으로 업데이트되었습니다.", "success");
    fetchAndDisplayFilters();
  } catch (error) {
    handleError(error, "필터 설정 업데이트에 실패했습니다.");
  } finally {
    const applyBtn = document.getElementById("applyFilterBtn");
    if (applyBtn) {
      applyBtn.disabled = false;
      applyBtn.innerHTML = "변경사항 적용";
    }
  }
}

function revertFilterChanges() {
  if (Object.keys(modifiedFilterSettings).length === 0) return;
  displayFilters(originalFilterSettings);
  modifiedFilterSettings = {};
  updateFilterButtonStates();
  showAlert("변경이 취소되었습니다.", "info");
}

// =======================================================================
// 추천 규칙 설정 섹션 (Recommendation Rules Section)
// =======================================================================

let recommendRules = [];
let modifiedRecommendRules = {};

function initRecommendSection() {
  document
    .getElementById("addRecommendRuleBtn")
    .addEventListener("click", () => renderRuleForm()); // 새 규칙 폼 렌더링

  document
    .getElementById("applyRecommendBtn")
    ?.addEventListener("click", applyRecommendChanges);

  document
    .getElementById("cancelRecommendBtn")
    ?.addEventListener("click", revertRecommendChanges);

  fetchAndDisplayRecommendRules();
}

async function fetchAndDisplayRecommendRules() {
  try {
    showLoading("recommendRulesContainer");
    recommendRules = await fetchRecommendSettings();
    displayRecommendRules();
  } catch (error) {
    handleError(error, "추천 규칙을 불러오는 데 실패했습니다.");
  }
}

function displayRecommendRules() {
  const container = document.getElementById("recommendRulesContainer");
  container.innerHTML = ""; // 컨테이너 비우기

  if (recommendRules.length === 0) {
    showNoData(
      "recommendRulesContainer",
      "등록된 추천 규칙이 없습니다. '새 규칙 추가' 버튼을 눌러 규칙을 만들어보세요."
    );
    return;
  }

  recommendRules.forEach((rule) => {
    container.insertAdjacentHTML("beforeend", createRuleCardHTML(rule));
  });

  // 이벤트 위임 방식으로 이벤트 리스너 등록
  container.addEventListener("click", (e) => {
    const target = e.target.closest("button");
    if (!target) return;

    const ruleId = target.dataset.id;
    if (target.classList.contains("edit-rule-btn")) {
      const ruleToEdit = recommendRules.find((r) => r.id == ruleId);
      renderRuleForm(ruleToEdit);
    } else if (target.classList.contains("delete-rule-btn")) {
      handleDeleteRule(ruleId);
    }
  });
}

function createRuleCardHTML(rule) {
  const conditionsSummary = Object.entries(rule.conditions)
    .map(([field, cond]) => {
      let values = "";
      if (cond.values) values = cond.values.join(", ");
      if (cond.keywords) values = cond.keywords.join(", ");
      if (cond.min) values = `${cond.min} ~ ${cond.max}`;
      if (cond.start) values = `${cond.start} ~ ${cond.end}`;
      return `<li><strong>${getFieldDisplayName(field)}:</strong> ${values} (${
        cond.operator
      })</li>`;
    })
    .join("");

  return `
    <div class="rule-card">
      <div class="rule-header">
        <span class="rule-name">${rule.rule_name}</span>
        <span class="rule-score">점수: ${rule.recommend_score}</span>
        <label class="toggle-switch small">
          <input type="checkbox" ${rule.is_enabled ? "checked" : ""} 
                 onchange="handleRuleToggleChange(${rule.id}, this.checked)">
          <span class="toggle-slider"></span>
        </label>
      </div>
      <div class="rule-body">
        <ul>${conditionsSummary}</ul>
      </div>
      <div class="rule-actions">
        <button class="btn btn-sm edit-rule-btn" data-id="${
          rule.id
        }">수정</button>
        <button class="btn btn-sm btn-danger delete-rule-btn" data-id="${
          rule.id
        }">삭제</button>
      </div>
    </div>
  `;
}

function getFieldDisplayName(field) {
  const displayNames = {
    brand: "브랜드",
    category: "카테고리",
    scheduled_date: "경매일",
    starting_price: "시작 가격",
    title: "제목",
  };
  return displayNames[field] || field;
}

function handleRuleToggleChange(ruleId, isEnabled) {
  const original = recommendRules.find((r) => r.id === ruleId);
  if (original && original.is_enabled !== isEnabled) {
    modifiedRecommendRules[ruleId] = { ...original, is_enabled: isEnabled };
  } else {
    delete modifiedRecommendRules[ruleId];
  }
  updateRecommendButtonStates();
}

function updateRecommendButtonStates() {
  const hasChanges = Object.keys(modifiedRecommendRules).length > 0;
  const applyBtn = document.getElementById("applyRecommendBtn");
  const cancelBtn = document.getElementById("cancelRecommendBtn");

  if (applyBtn) applyBtn.disabled = !hasChanges;
  if (cancelBtn) cancelBtn.disabled = !hasChanges;
}

async function applyRecommendChanges() {
  const changes = Object.values(modifiedRecommendRules);
  if (changes.length === 0) {
    showAlert("변경된 내용이 없습니다.", "info");
    return;
  }
  if (!confirmAction("변경된 추천 설정을 적용하시겠습니까?")) return;

  try {
    await updateRecommendSettingsBatch(changes);
    showAlert("추천 설정이 성공적으로 업데이트되었습니다.", "success");
    fetchAndDisplayRecommendRules();
  } catch (error) {
    handleError(error, "추천 설정 업데이트에 실패했습니다.");
  }
}

function revertRecommendChanges() {
  if (Object.keys(modifiedRecommendRules).length === 0) return;
  displayRecommendRules();
  modifiedRecommendRules = {};
  updateRecommendButtonStates();
  showAlert("변경이 취소되었습니다.", "info");
}

async function handleDeleteRule(ruleId) {
  if (!confirmAction("정말로 이 규칙을 삭제하시겠습니까?")) return;
  try {
    await deleteRecommendSetting(ruleId);
    showAlert("규칙이 삭제되었습니다.", "success");
    fetchAndDisplayRecommendRules();
  } catch (error) {
    handleError(error, "규칙 삭제에 실패했습니다.");
  }
}

// =======================================================================
// 추천 규칙 폼 (Form for Recommendation Rule)
// =======================================================================

function renderRuleForm(rule = null) {
  const container = document.getElementById("recommendRulesContainer");
  // 기존에 열려있는 폼이 있다면 제거
  const existingForm = container.querySelector(".rule-form-card");
  if (existingForm) existingForm.remove();

  const formHTML = createRuleFormHTML(rule);
  container.insertAdjacentHTML("afterbegin", formHTML);

  const form = container.querySelector("#ruleForm");
  form.addEventListener("submit", (e) => handleRuleFormSubmit(e, rule));
  form
    .querySelector("#cancelRuleForm")
    .addEventListener("click", () => form.closest(".rule-form-card").remove());
  form
    .querySelector("#addConditionBtn")
    .addEventListener("click", () => addConditionRow(form));
}

function createRuleFormHTML(rule) {
  const isEditing = rule !== null;
  const conditionsHTML = isEditing
    ? Object.entries(rule.conditions).map(createConditionRowHTML).join("")
    : "";

  return `
    <div class="rule-form-card">
      <h3>${isEditing ? "규칙 수정" : "새 규칙 추가"}</h3>
      <form id="ruleForm">
        <div class="form-group">
          <label>규칙 이름</label>
          <input type="text" name="ruleName" class="form-control" value="${
            rule?.rule_name || ""
          }" required>
        </div>
        <div class="form-group">
          <label>추천 점수</label>
          <input type="number" name="recommendScore" class="form-control" value="${
            rule?.recommend_score || 0
          }" required>
        </div>
        <div class="form-group">
          <label>활성화</label>
           <label class="toggle-switch">
            <input type="checkbox" name="isEnabled" ${
              !isEditing || rule.is_enabled ? "checked" : ""
            }>
            <span class="toggle-slider"></span>
          </label>
        </div>
        
        <h4>조건</h4>
        <div id="conditionsContainer">${conditionsHTML}</div>
        <button type="button" id="addConditionBtn" class="btn btn-sm btn-secondary">조건 추가</button>
        
        <div class="form-actions">
          <button type="submit" class="btn btn-primary">저장</button>
          <button type="button" id="cancelRuleForm" class="btn btn-secondary">취소</button>
        </div>
      </form>
    </div>
  `;
}

function addConditionRow(form) {
  const container = form.querySelector("#conditionsContainer");
  container.insertAdjacentHTML("beforeend", createConditionRowHTML(["", {}]));
}

function createConditionRowHTML([field, condition]) {
  const conditionTypes = {
    brand: "브랜드",
    category: "카테고리",
    scheduled_date: "경매일",
    starting_price: "시작 가격",
    title: "제목",
  };

  const id = `condition-${Date.now()}`;
  let inputHTML = `<div class="condition-input-container"></div>`; // 초기 placeholder

  // 기존 데이터가 있으면 해당 인풋 렌더링
  if (field) {
    inputHTML = renderConditionInput(
      field,
      condition,
      availableBrands,
      availableCategories
    );
  }

  return `
    <div class="condition-row" id="${id}">
      <select class="condition-type-select" onchange="updateConditionInput(this)">
        <option value="">-- 타입 선택 --</option>
        ${Object.entries(conditionTypes)
          .map(
            ([key, value]) =>
              `<option value="${key}" ${
                field === key ? "selected" : ""
              }>${value}</option>`
          )
          .join("")}
      </select>
      ${inputHTML}
      <button type="button" class="btn btn-sm btn-danger" onclick="document.getElementById('${id}').remove()">삭제</button>
    </div>
  `;
}

function updateConditionInput(selectElement) {
  const type = selectElement.value;
  const container = selectElement.nextElementSibling;
  container.innerHTML = renderConditionInput(
    type,
    {},
    availableBrands,
    availableCategories
  );
}

function renderConditionInput(type, condition, brands, categories) {
  switch (type) {
    case "brand":
    case "category":
      const options = type === "brand" ? brands : categories;
      const selectedValues = new Set(condition.values || []);

      // 체크박스 방식으로 변경
      const checkboxesHTML = options
        .map(
          (opt) => `
        <label class="checkbox-option">
          <input type="checkbox" name="${type}" value="${opt}" ${
            selectedValues.has(opt) ? "checked" : ""
          }>
          <span>${opt}</span>
        </label>
      `
        )
        .join("");

      return `
        <div class="checkbox-container ${type === "brand" ? "searchable" : ""}">
          ${
            type === "brand"
              ? `
            <input type="text" placeholder="검색..." class="condition-search form-control" 
                   onkeyup="filterConditionOptions(this)">
          `
              : ""
          }
          <div class="checkbox-list">
            ${checkboxesHTML}
          </div>
        </div>
      `;

    case "scheduled_date":
      return `
        <input type="date" name="date_start" class="form-control" value="${
          condition.start || ""
        }">
        <span>~</span>
        <input type="date" name="date_end" class="form-control" value="${
          condition.end || ""
        }">
      `;
    case "starting_price":
      return `
        <input type="number" name="price_min" placeholder="최소" class="form-control" value="${
          condition.min || ""
        }">
        <span>~</span>
        <input type="number" name="price_max" placeholder="최대" class="form-control" value="${
          condition.max || ""
        }">
      `;
    case "title":
      return `<input type="text" name="title_keywords" placeholder="쉼표(,)로 키워드 구분" class="form-control" value="${(
        condition.keywords || []
      ).join(", ")}">`;
    default:
      return "";
  }
}

function filterConditionOptions(searchInput) {
  const checkboxContainer = searchInput.nextElementSibling;
  const checkboxes = checkboxContainer.querySelectorAll(".checkbox-option");
  const searchTerm = searchInput.value.toLowerCase();

  checkboxes.forEach((checkbox) => {
    const text = checkbox.querySelector("span").textContent.toLowerCase();
    checkbox.style.display = text.includes(searchTerm) ? "block" : "none";
  });
}

async function handleRuleFormSubmit(event, existingRule) {
  event.preventDefault();
  const form = event.target;
  const formData = new FormData(form);

  const conditions = {};
  const conditionRows = form.querySelectorAll(".condition-row");
  conditionRows.forEach((row) => {
    const type = row.querySelector(".condition-type-select").value;
    if (!type) return;

    switch (type) {
      case "brand":
      case "category":
        // 체크박스에서 선택된 값들 가져오기
        const checkedBoxes = row.querySelectorAll(
          `input[name="${type}"]:checked`
        );
        const selectedValues = Array.from(checkedBoxes).map((cb) => cb.value);
        if (selectedValues.length > 0) {
          conditions[type] = {
            operator: "IN",
            values: selectedValues,
          };
        }
        break;
      case "scheduled_date":
        conditions[type] = {
          operator: "BETWEEN",
          start: formData.get("date_start"),
          end: formData.get("date_end"),
        };
        break;
      case "starting_price":
        conditions[type] = {
          operator: "BETWEEN",
          min: formData.get("price_min"),
          max: formData.get("price_max"),
        };
        break;
      case "title":
        conditions[type] = {
          operator: "CONTAINS",
          keywords: formData
            .get("title_keywords")
            .split(",")
            .map((k) => k.trim())
            .filter(Boolean),
        };
        break;
    }
  });

  const ruleData = {
    ruleName: formData.get("ruleName"),
    recommendScore: parseInt(formData.get("recommendScore")),
    isEnabled: form.querySelector('[name="isEnabled"]').checked,
    conditions: conditions,
  };

  try {
    if (existingRule) {
      await updateRecommendSetting(existingRule.id, ruleData);
      showAlert("규칙이 성공적으로 수정되었습니다.", "success");
    } else {
      await createRecommendSetting(ruleData);
      showAlert("새 규칙이 성공적으로 추가되었습니다.", "success");
    }
    form.closest(".rule-form-card").remove();
    fetchAndDisplayRecommendRules();
  } catch (error) {
    handleError(error, "규칙 저장에 실패했습니다.");
  }
}
