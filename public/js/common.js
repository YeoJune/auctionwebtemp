// 날짜 포맷팅
function formatDate(dateString) {
    if (!dateString) return '-';
    const date = new Date(dateString);
    const kstDate = new Date(date.getTime() + (9 * 60 * 60 * 1000));
    return kstDate.toISOString().split('T')[0];
}

// 숫자 포맷팅 (1000 -> 1,000)
function formatNumber(num) {
    return (num || 0).toLocaleString();
}

// DOM 요소 생성 헬퍼 함수
function createElement(tag, className, textContent) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (textContent) element.textContent = textContent;
    return element;
}

// 필터 아이템 생성 함수
function createFilterItem(value, type, selectedArray, label = value) {
    const item = createElement('div', 'filter-item');
    
    const checkbox = createElement('input');
    checkbox.type = 'checkbox';
    checkbox.value = value;
    checkbox.id = `${type}-${value}`;
    
    checkbox.addEventListener('change', () => {
        if (checkbox.checked) {
            selectedArray.push(value);
        } else {
            const index = selectedArray.indexOf(value);
            if (index > -1) selectedArray.splice(index, 1);
        }
    });
    
    const labelElement = createElement('label');
    labelElement.htmlFor = `${type}-${value}`;
    labelElement.textContent = label;
    
    item.appendChild(checkbox);
    item.appendChild(labelElement);
    return item;
}

// 필터 검색 설정
function setupFilterSearch(inputId, filterId) {
    const searchInput = document.getElementById(inputId);
    const filterContainer = document.getElementById(filterId);
    
    searchInput?.addEventListener('input', function() {
        const searchTerm = this.value.toLowerCase();
        const filterItems = filterContainer.getElementsByClassName('filter-item');
        
        Array.from(filterItems).forEach(item => {
            const label = item.getElementsByTagName('label')[0].innerText.toLowerCase();
            item.style.display = label.includes(searchTerm) ? '' : 'none';
        });
    });
}

// 페이지네이션 생성 함수
function createPagination(currentPage, totalPages, onPageChange) {
    const container = document.getElementById('pagination');
    if (!container) return;
    
    container.innerHTML = '';
    if (totalPages <= 1) return;

    // 이전 버튼
    const prevButton = createElement('button', '', '이전');
    prevButton.disabled = currentPage <= 1;
    prevButton.addEventListener('click', () => onPageChange(currentPage - 1));
    container.appendChild(prevButton);

    // 페이지 번호
    const pageNumbers = getPageNumbers(currentPage, totalPages);
    pageNumbers.forEach(pageNum => {
        if (pageNum === '...') {
            container.appendChild(document.createTextNode('...'));
        } else {
            const pageButton = createElement('button', pageNum === currentPage ? 'active' : '');
            pageButton.textContent = pageNum;
            pageButton.addEventListener('click', () => onPageChange(pageNum));
            container.appendChild(pageButton);
        }
    });

    // 다음 버튼
    const nextButton = createElement('button', '', '다음');
    nextButton.disabled = currentPage >= totalPages;
    nextButton.addEventListener('click', () => onPageChange(currentPage + 1));
    container.appendChild(nextButton);
}

// 페이지 번호 생성
function getPageNumbers(currentPage, totalPages) {
    const pages = [];
    const totalPagesToShow = 5;
    const sidePages = Math.floor(totalPagesToShow / 2);

    let startPage = Math.max(currentPage - sidePages, 1);
    let endPage = Math.min(startPage + totalPagesToShow - 1, totalPages);

    if (endPage - startPage + 1 < totalPagesToShow) {
        startPage = Math.max(endPage - totalPagesToShow + 1, 1);
    }

    if (startPage > 1) {
        pages.push(1);
        if (startPage > 2) pages.push('...');
    }

    for (let i = startPage; i <= endPage; i++) {
        pages.push(i);
    }

    if (endPage < totalPages) {
        if (endPage < totalPages - 1) pages.push('...');
        pages.push(totalPages);
    }

    return pages;
}

// 모달 관련 함수
function setupModal(modalId) {
    const modal = document.getElementById(modalId);
    if (!modal) return null;

    const closeBtn = modal.querySelector('.close');
    
    if (closeBtn) {
        closeBtn.onclick = () => modal.style.display = 'none';
    }

    window.onclick = (event) => {
        if (event.target === modal) {
            modal.style.display = 'none';
        }
    };

    return {
        show: () => modal.style.display = 'flex',
        hide: () => modal.style.display = 'none',
        element: modal
    };
}

// 로딩 상태 관리
function toggleLoading(show) {
    const loadingMsg = document.getElementById('loadingMsg');
    if (loadingMsg) {
        loadingMsg.style.display = show ? 'block' : 'none';
    }
}

// 모바일 필터 토글
function setupMobileFilters() {
    const filterBtn = document.getElementById('mobileFilterBtn');
    const filtersContainer = document.querySelector('.filters-container');
    const backdrop = document.createElement('div');
    backdrop.className = 'filter-backdrop';
    backdrop.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background-color: rgba(0, 0, 0, 0.5);
        z-index: 899;
        display: none;
    `;
    document.body.appendChild(backdrop);

    if (filterBtn && filtersContainer) {
        filterBtn.addEventListener('click', () => {
            filtersContainer.classList.add('active');
            backdrop.style.display = 'block';
            document.body.style.overflow = 'hidden';
        });

        // 백드롭 클릭시 필터 닫기
        backdrop.addEventListener('click', () => {
            filtersContainer.classList.remove('active');
            backdrop.style.display = 'none';
            document.body.style.overflow = '';
        });

        // ESC 키로 필터 닫기
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && filtersContainer.classList.contains('active')) {
                filtersContainer.classList.remove('active');
                backdrop.style.display = 'none';
                document.body.style.overflow = '';
            }
        });
    }
}


// common.js에 추가
function displayFilters(brands, categories, dates, ranks) {
    displayBrandFilters(brands);
    displayCategoryFilters(categories);
    displayDateFilters(dates);
    displayRankFilters(ranks);
}

function displayBrandFilters(brands) {
    const brandFilters = document.getElementById('brandFilters');
    if (!brandFilters) return;
    
    brandFilters.innerHTML = '';
    brands.sort((a, b) => b.count - a.count);
    brands.forEach(brand => {
        const brandItem = createFilterItem(
            brand.brand, 
            'brand', 
            state.selectedBrands, 
            `${brand.brand} (${brand.count})`
        );
        brandFilters.appendChild(brandItem);
    });
    setupFilterSearch('brandSearch', 'brandFilters');
}

function displayCategoryFilters(categories) {
    const categoryFilters = document.getElementById('categoryFilters');
    if (!categoryFilters) return;

    categoryFilters.innerHTML = '';
    categories.forEach(category => {
        const categoryItem = createFilterItem(
            category, 
            'category', 
            state.selectedCategories, 
            category || '기타'
        );
        categoryFilters.appendChild(categoryItem);
    });
}

function displayDateFilters(dates) {
    const scheduledDateFilters = document.getElementById('scheduledDateFilters');
    if (!scheduledDateFilters) return;
    
    scheduledDateFilters.innerHTML = '';
    
    const noScheduledDateItem = createFilterItem(
        'NO_DATE', 
        'date', 
        state.selectedDates, 
        '날짜 없음'
    );
    scheduledDateFilters.appendChild(noScheduledDateItem);
    
    dates.forEach(date => {
        if (date.Date) {
            const formattedDate = formatDate(date.Date);
            const dateItem = createFilterItem(
                date.Date, 
                'date', 
                state.selectedDates, 
                `${formattedDate} (${date.count})`
            );
            scheduledDateFilters.appendChild(dateItem);
        }
    });
}

function displayRankFilters(ranks) {
    const rankFilters = document.getElementById('rankFilters');
    if (!rankFilters) return;
    
    rankFilters.innerHTML = '';
    const rankOrder = ['N', 'S', 'A', 'AB', 'B', 'BC', 'C', 'D', 'E', 'F'];
    const rankMap = new Map(ranks.map(r => [r.rank, r]));
    
    rankOrder.forEach(rank => {
        const rankData = rankMap.get(rank);
        if (rankData) {
            const rankItem = createFilterItem(
                rankData.rank, 
                'rank', 
                state.selectedRanks, 
                `${rankData.rank} (${rankData.count})`
            );
            rankFilters.appendChild(rankItem);
        }
    });
}

// 초기화 함수
function initializeCommonFeatures() {
    setupMobileFilters();
}

// DOMContentLoaded 이벤트
document.addEventListener('DOMContentLoaded', initializeCommonFeatures);