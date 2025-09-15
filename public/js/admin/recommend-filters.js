// public/js/admin/recommend-filters.js

document.addEventListener("DOMContentLoaded", async () => {
  await loadPrerequisiteData();
  initFilterSection();
  initRecommendSection();
});

// =======================================================================
// 데이터 사전 로드
// =======================================================================
let availableBrands = [];
let availableCategories = [];
let availableRanks = [];

async function loadPrerequisiteData() {
  try {
    const [brandData, categoryData, rankData] = await Promise.all([
      fetch("/api/data/brands").then((res) => res.json()),
      fetch("/api/data/categories").then((res) => res.json()),
      fetch("/api/data/ranks").then((res) => res.json()),
    ]);
    availableBrands = brandData;
    availableCategories = categoryData;
    availableRanks = rankData;
  } catch (error) {
    handleError(error, "필터링 데이터를 불러오는 데 실패했습니다.");
  }
}

// =======================================================================
// 필터 설정 섹션
// =======================================================================

let originalFilterSettings = [];
let currentFilterState = {};

function initFilterSection() {
  document
    .getElementById("applyFilterBtn")
    .addEventListener("click", applyFilterChanges);
  document
    .getElementById("cancelFilterBtn")
    .addEventListener("click", revertFilterChanges);

  // 이벤트 위임으로 필터 체크박스 처리
  document.addEventListener("change", (e) => {
    if (e.target.matches(".filter-checkbox")) {
      handleFilterChange(e.target);
    }
  });

  // 브랜드 검색 이벤트 위임
  document.addEventListener("input", (e) => {
    if (e.target.matches(".brand-search")) {
      filterBrandList(e.target.value);
    }
  });

  fetchAndDisplayFilters();
}

async function fetchAndDisplayFilters() {
  try {
    showLoading("dateFilters");
    showLoading("brandFilters");
    showLoading("categoryFilters");

    const settings = await fetchFilterSettings();
    originalFilterSettings = JSON.parse(JSON.stringify(settings));

    // 현재 상태를 원본으로 초기화
    currentFilterState = {};
    settings.forEach((s) => {
      const key = `${s.filter_type}:${s.filter_value}`;
      currentFilterState[key] = s.is_enabled;
    });

    displayFilters(settings);
    updateFilterButtonStates();
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

  if (type === "brand") {
    html += `
      <div class="brand-search-container">
        <input type="text" class="form-control brand-search" placeholder="브랜드 검색...">
      </div>
    `;
  }

  html += `<div class="filter-grid" id="${type}FilterGrid">`;
  html += filters.map(createFilterToggleHTML).join("");
  html += `</div>`;

  return html;
}

function createFilterToggleHTML(filter) {
  const key = `${filter.filter_type}:${filter.filter_value}`;
  const isChecked = currentFilterState[key] || false;

  let displayValue = filter.filter_value;
  if (filter.filter_type === "date") {
    displayValue = displayValue.split("T")[0].split(" ")[0];
  }

  return `
    <div class="filter-item">
      <label class="toggle-switch">
        <input type="checkbox" 
               class="filter-checkbox"
               data-filter-type="${filter.filter_type}" 
               data-filter-value="${filter.filter_value}"
               ${isChecked ? "checked" : ""}>
        <span class="toggle-slider"></span>
      </label>
      <span class="filter-value">${displayValue}</span>
    </div>
  `;
}

function handleFilterChange(checkbox) {
  const filterType = checkbox.dataset.filterType;
  const filterValue = checkbox.dataset.filterValue;
  const key = `${filterType}:${filterValue}`;

  currentFilterState[key] = checkbox.checked;
  updateFilterButtonStates();
}

function updateFilterButtonStates() {
  const changes = getFilterChanges();
  const hasChanges = changes.length > 0;

  const applyBtn = document.getElementById("applyFilterBtn");
  const cancelBtn = document.getElementById("cancelFilterBtn");

  applyBtn.disabled = !hasChanges;
  applyBtn.textContent = hasChanges
    ? `변경사항 적용 (${changes.length})`
    : "변경사항 적용";
  cancelBtn.disabled = !hasChanges;
}

function getFilterChanges() {
  const changes = [];
  const originalState = {};

  originalFilterSettings.forEach((s) => {
    const key = `${s.filter_type}:${s.filter_value}`;
    originalState[key] = s.is_enabled;
  });

  Object.keys(currentFilterState).forEach((key) => {
    if (currentFilterState[key] !== originalState[key]) {
      const [filterType, filterValue] = key.split(":");
      changes.push({
        filterType,
        filterValue,
        isEnabled: currentFilterState[key],
      });
    }
  });

  return changes;
}

async function applyFilterChanges() {
  const changes = getFilterChanges();
  if (changes.length === 0) {
    showAlert("변경된 내용이 없습니다.", "info");
    return;
  }

  if (!confirmAction(`${changes.length}개의 필터 설정을 적용하시겠습니까?`)) {
    return;
  }

  const applyBtn = document.getElementById("applyFilterBtn");
  const originalText = applyBtn.textContent;

  try {
    applyBtn.disabled = true;
    applyBtn.innerHTML = '<div class="loading-spinner"></div> 적용 중...';

    await updateFilterSettingsBatch(changes);
    showAlert("필터 설정이 성공적으로 업데이트되었습니다.", "success");

    // 성공 시 원본 데이터 업데이트
    await fetchAndDisplayFilters();
  } catch (error) {
    handleError(error, "필터 설정 업데이트에 실패했습니다.");
    // 실패 시 UI 상태 롤백
    revertFilterChanges();
  } finally {
    applyBtn.disabled = false;
    applyBtn.textContent = originalText;
  }
}

function revertFilterChanges() {
  // 현재 상태를 원본으로 되돌리기
  currentFilterState = {};
  originalFilterSettings.forEach((s) => {
    const key = `${s.filter_type}:${s.filter_value}`;
    currentFilterState[key] = s.is_enabled;
  });

  displayFilters(originalFilterSettings);
  updateFilterButtonStates();
  showAlert("변경이 취소되었습니다.", "info");
}

function filterBrandList(searchTerm) {
  const brandGrid = document.getElementById("brandFilterGrid");
  if (!brandGrid) return;

  const brandItems = brandGrid.querySelectorAll(".filter-item");
  brandItems.forEach((item) => {
    const brandName = item
      .querySelector(".filter-value")
      .textContent.toLowerCase();
    const matches = brandName.includes(searchTerm.toLowerCase());
    item.style.display = matches ? "flex" : "none";
  });
}

// =======================================================================
// 추천 규칙 설정 섹션
// =======================================================================

let originalRecommendRules = [];
let currentRecommendState = {};

function initRecommendSection() {
  document
    .getElementById("addRecommendRuleBtn")
    .addEventListener("click", () => renderRuleForm());
  document
    .getElementById("applyRecommendBtn")
    .addEventListener("click", applyRecommendChanges);
  document
    .getElementById("cancelRecommendBtn")
    .addEventListener("click", revertRecommendChanges);

  // 이벤트 위임으로 규칙 토글 처리
  document.addEventListener("change", (e) => {
    if (e.target.matches(".rule-toggle")) {
      handleRuleToggleChange(e.target);
    }
  });

  // 이벤트 위임으로 규칙 액션 버튼 처리
  document.addEventListener("click", (e) => {
    const button = e.target.closest("button");
    if (!button) return;

    const ruleId = button.dataset.id;
    if (button.classList.contains("edit-rule-btn")) {
      const ruleToEdit = originalRecommendRules.find((r) => r.id == ruleId);
      renderRuleForm(ruleToEdit);
    } else if (button.classList.contains("delete-rule-btn")) {
      handleDeleteRule(ruleId);
    }
  });

  fetchAndDisplayRecommendRules();
}

async function fetchAndDisplayRecommendRules() {
  try {
    showLoading("recommendRulesContainer");
    const rules = await fetchRecommendSettings();
    originalRecommendRules = JSON.parse(JSON.stringify(rules));

    // 현재 상태를 원본으로 초기화
    currentRecommendState = {};
    rules.forEach((rule) => {
      currentRecommendState[rule.id] = rule.is_enabled;
    });

    displayRecommendRules();
    updateRecommendButtonStates();
  } catch (error) {
    handleError(error, "추천 규칙을 불러오는 데 실패했습니다.");
  }
}

function displayRecommendRules() {
  const container = document.getElementById("recommendRulesContainer");
  container.innerHTML = "";

  if (originalRecommendRules.length === 0) {
    showNoData(
      "recommendRulesContainer",
      "등록된 추천 규칙이 없습니다. '새 규칙 추가' 버튼을 눌러 규칙을 만들어보세요."
    );
    return;
  }

  originalRecommendRules.forEach((rule) => {
    container.insertAdjacentHTML("beforeend", createRuleCardHTML(rule));
  });
}

function createRuleCardHTML(rule) {
  const isEnabled =
    currentRecommendState[rule.id] !== undefined
      ? currentRecommendState[rule.id]
      : rule.is_enabled;

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
          <input type="checkbox" 
                 class="rule-toggle"
                 data-rule-id="${rule.id}"
                 ${isEnabled ? "checked" : ""}>
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
    starting_price: "가격",
    title: "제목",
    rank: "등급",
  };
  return displayNames[field] || field;
}

function handleRuleToggleChange(checkbox) {
  const ruleId = parseInt(checkbox.dataset.ruleId);
  currentRecommendState[ruleId] = checkbox.checked;
  updateRecommendButtonStates();
}

function updateRecommendButtonStates() {
  const changes = getRecommendChanges();
  const hasChanges = changes.length > 0;

  const applyBtn = document.getElementById("applyRecommendBtn");
  const cancelBtn = document.getElementById("cancelRecommendBtn");

  if (applyBtn) applyBtn.disabled = !hasChanges;
  if (cancelBtn) cancelBtn.disabled = !hasChanges;
}

function getRecommendChanges() {
  const changes = [];

  originalRecommendRules.forEach((rule) => {
    const currentEnabled = currentRecommendState[rule.id];
    if (currentEnabled !== undefined && currentEnabled !== rule.is_enabled) {
      changes.push({
        id: rule.id,
        ruleName: rule.rule_name,
        conditions: rule.conditions,
        recommendScore: rule.recommend_score,
        isEnabled: currentEnabled,
      });
    }
  });

  return changes;
}

async function applyRecommendChanges() {
  const changes = getRecommendChanges();
  if (changes.length === 0) {
    showAlert("변경된 내용이 없습니다.", "info");
    return;
  }

  if (!confirmAction("변경된 추천 설정을 적용하시겠습니까?")) {
    return;
  }

  try {
    await updateRecommendSettingsBatch(changes);
    showAlert("추천 설정이 성공적으로 업데이트되었습니다.", "success");

    // 성공 시 원본 데이터 업데이트
    await fetchAndDisplayRecommendRules();
  } catch (error) {
    handleError(error, "추천 설정 업데이트에 실패했습니다.");
    // 실패 시 UI 상태 롤백
    revertRecommendChanges();
  }
}

function revertRecommendChanges() {
  // 현재 상태를 원본으로 되돌리기
  currentRecommendState = {};
  originalRecommendRules.forEach((rule) => {
    currentRecommendState[rule.id] = rule.is_enabled;
  });

  displayRecommendRules();
  updateRecommendButtonStates();
  showAlert("변경이 취소되었습니다.", "info");
}

async function handleDeleteRule(ruleId) {
  if (!confirmAction("정말로 이 규칙을 삭제하시겠습니까?")) {
    return;
  }

  try {
    await deleteRecommendSetting(ruleId);
    showAlert("규칙이 삭제되었습니다.", "success");
    await fetchAndDisplayRecommendRules();
  } catch (error) {
    handleError(error, "규칙 삭제에 실패했습니다.");
  }
}

// =======================================================================
// 추천 규칙 폼
// =======================================================================

function renderRuleForm(rule = null) {
  const container = document.getElementById("recommendRulesContainer");
  const existingForm = container.querySelector(".rule-form-card");
  if (existingForm) existingForm.remove();

  const formHTML = createRuleFormHTML(rule);
  container.insertAdjacentHTML("afterbegin", formHTML);

  const form = container.querySelector("#ruleForm");
  form.addEventListener("submit", (e) => handleRuleFormSubmit(e, rule));
  form.querySelector("#cancelRuleForm").addEventListener("click", () => {
    form.closest(".rule-form-card").remove();
  });
  form
    .querySelector("#addConditionBtn")
    .addEventListener("click", () => addConditionRow(form));

  // 조건 타입 변경 이벤트 위임
  form.addEventListener("change", (e) => {
    if (e.target.matches(".condition-type-select")) {
      updateConditionInput(e.target);
    }
  });

  // 조건 검색 이벤트 위임
  form.addEventListener("input", (e) => {
    if (e.target.matches(".condition-search")) {
      filterConditionOptions(e.target);
    }
  });

  // 조건 삭제 이벤트 위임
  form.addEventListener("click", (e) => {
    if (e.target.matches(".remove-condition-btn")) {
      e.target.closest(".condition-row").remove();
    }
  });
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
            rule?.recommend_score || 1
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
    starting_price: "가격",
    title: "제목",
    rank: "등급",
  };

  const id = `condition-${Date.now()}-${Math.random()
    .toString(36)
    .substr(2, 9)}`;
  let inputHTML = `<div class="condition-input-container"></div>`;

  if (field) {
    inputHTML = renderConditionInput(
      field,
      condition,
      availableBrands,
      availableCategories,
      availableRanks
    );
  }

  return `
    <div class="condition-row" id="${id}">
      <select class="condition-type-select">
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
      <button type="button" class="btn btn-sm btn-danger remove-condition-btn">삭제</button>
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
    availableCategories,
    availableRanks
  );
}

function renderConditionInput(type, condition, brands, categories, ranks) {
  switch (type) {
    case "brand":
      const brandOptions = brands;
      const selectedBrands = new Set(condition.values || []);
      const selectedCount = selectedBrands.size;

      const brandCheckboxesHTML = brandOptions
        .map(
          (opt) => `
        <label class="checkbox-option">
          <input type="checkbox" name="brand" value="${opt}" ${
            selectedBrands.has(opt) ? "checked" : ""
          }>
          <span>${opt}</span>
        </label>
      `
        )
        .join("");

      const selectedTags = Array.from(selectedBrands)
        .slice(0, 5)
        .map((brand) => `<span class="selected-tag">${brand}</span>`)
        .join("");

      const moreCount =
        selectedCount > 5
          ? `<span class="more-count">+${selectedCount - 5}개 더</span>`
          : "";

      return `
        <div class="checkbox-container searchable">
          ${
            selectedCount > 0
              ? `<div class="selected-summary">${selectedTags}${moreCount}</div>`
              : ""
          }
          <input type="text" placeholder="검색..." class="condition-search form-control">
          <div class="checkbox-list">${brandCheckboxesHTML}</div>
        </div>
      `;

    case "category":
      const categoryOptions = categories;
      const selectedCategories = new Set(condition.values || []);

      const categoryCheckboxesHTML = categoryOptions
        .map(
          (opt) => `
        <label class="checkbox-option">
          <input type="checkbox" name="category" value="${opt}" ${
            selectedCategories.has(opt) ? "checked" : ""
          }>
          <span>${opt}</span>
        </label>
      `
        )
        .join("");

      return `
        <div class="checkbox-container">
          <div class="checkbox-list">${categoryCheckboxesHTML}</div>
        </div>
      `;

    case "rank":
      const rankSelectedValues = new Set(condition.values || []);
      const rankOptions = ranks || [];

      const rankCheckboxesHTML = rankOptions
        .map(
          (opt) => `
        <label class="checkbox-option">
          <input type="checkbox" name="rank" value="${opt.rank}" ${
            rankSelectedValues.has(opt.rank) ? "checked" : ""
          }>
          <span>${opt.rank}</span>
        </label>
      `
        )
        .join("");

      return `
        <div class="checkbox-container">
          <div class="checkbox-list">${rankCheckboxesHTML}</div>
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

      case "rank":
        const rankCheckedBoxes = row.querySelectorAll(
          `input[name="rank"]:checked`
        );
        const selectedRanks = Array.from(rankCheckedBoxes).map(
          (cb) => cb.value
        );
        if (selectedRanks.length > 0) {
          conditions[type] = {
            operator: "IN",
            values: selectedRanks,
          };
        }
        break;

      case "scheduled_date":
        const startDate = row.querySelector('[name="date_start"]').value;
        const endDate = row.querySelector('[name="date_end"]').value;
        if (startDate && endDate) {
          conditions[type] = {
            operator: "BETWEEN",
            start: startDate,
            end: endDate,
          };
        }
        break;

      case "starting_price":
        const minPrice = row.querySelector('[name="price_min"]').value;
        const maxPrice = row.querySelector('[name="price_max"]').value;
        if (minPrice && maxPrice) {
          conditions[type] = {
            operator: "BETWEEN",
            min: parseInt(minPrice),
            max: parseInt(maxPrice),
          };
        }
        break;

      case "title":
        const keywords = row.querySelector('[name="title_keywords"]').value;
        if (keywords.trim()) {
          conditions[type] = {
            operator: "CONTAINS",
            keywords: keywords
              .split(",")
              .map((k) => k.trim())
              .filter(Boolean),
          };
        }
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
    await fetchAndDisplayRecommendRules();
  } catch (error) {
    handleError(error, "규칙 저장에 실패했습니다.");
  }
}

// =======================================================================
// 유틸리티 함수
// =======================================================================

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

function showNoData(containerId, message) {
  const container = document.getElementById(containerId);
  if (container) {
    container.innerHTML = `<div class="no-data-message">${message}</div>`;
  }
}

function handleError(error, defaultMessage = "오류가 발생했습니다") {
  console.error("Error:", error);
  const message = error.message || defaultMessage;
  showAlert(message, "error");
}
