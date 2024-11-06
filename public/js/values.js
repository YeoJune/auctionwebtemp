// 상태 관리
window.state = {
    selectedBrands: [],
    selectedCategories: [],
    selectedDates: [],
    selectedRanks: [],
    currentPage: 1,
    itemsPerPage: 20,
    totalItems: 0,
    totalPages: 0,
    searchTerm: '',
    currentData: [],
    images: [],
    currentImageIndex: 0
};

// 데이터 표시 함수
function displayData(data) {
    const dataBody = document.getElementById('dataBody');
    if (!dataBody) return;

    state.currentData = data;
    dataBody.innerHTML = '';

    if (!data || data.length === 0) {
        dataBody.innerHTML = '<p>선택한 필터에 맞는 항목이 없습니다.</p>';
        return;
    }

    data.forEach(item => {
        const card = createElement('div', 'product-card');
        card.dataset.itemId = item.item_id;

        card.innerHTML = `
            <div class="product-header">
                <div>
                    <div class="product-brand">${item.brand}</div>
                    <div class="auctioneer-number">${item.auc_num}번</div>
                </div>
                <h3 class="product-title">${item.japanese_title}</h3>
            </div>
            <img src="${API.validateImageUrl(item.image)}" 
                 alt="${item.japanese_title}" 
                 class="product-image"
                 loading="lazy">
            <div class="product-details">
                <p class="scheduled-date">경매일: ${formatDate(item.scheduled_date)}</p>
                <p class="scheduled-date">랭크: ${item.rank}</p>
                ${item.final_price ? 
                    `<p class="final-price">최종가격: ${formatNumber(parseInt(item.final_price))} ¥</p>` 
                    : ''}
            </div>
        `;

        card.addEventListener('click', () => showDetails(item.item_id));
        dataBody.appendChild(card);
    });
}

// 상세 정보 모달 초기화
function initializeModal(item) {
    const modal = document.querySelector('.modal-content');
    if (!modal) return;

    document.querySelector('.modal-brand').textContent = item.brand;
    document.querySelector('.modal-title').textContent = item.japanese_title;
    document.querySelector('.main-image').src = API.validateImageUrl(item.image);
    document.querySelector('.modal-description').textContent = item.description || "설명 없음";
    document.querySelector('.modal-category').textContent = item.category || "카테고리 없음";
    document.querySelector('.modal-brand2').textContent = item.brand;
    document.querySelector('.modal-accessory-code').textContent = item.accessory_code || "액세서리 코드 없음";
    document.querySelector('.modal-scheduled-date').textContent = formatDate(item.scheduled_date) || "날짜 정보 없음";
    document.querySelector('.modal-final-price').textContent = item.final_price ? 
        `${formatNumber(parseInt(item.final_price))} ¥` : "가격 정보 없음";

    initializeImages([item.image]);
}

// 이미지 갤러리 초기화
function initializeImages(imageUrls) {
    state.images = imageUrls;
    state.currentImageIndex = 0;

    const mainImage = document.querySelector('.main-image');
    const thumbnailContainer = document.querySelector('.thumbnail-container');
    
    if (mainImage) mainImage.src = state.images[0];
    if (thumbnailContainer) {
        thumbnailContainer.innerHTML = '';
        state.images.forEach((img, index) => {
            const thumbnailWrapper = createElement('div', 'thumbnail');
            const thumbnail = createElement('img');
            thumbnail.src = img;
            thumbnail.alt = `Thumbnail ${index + 1}`;
            thumbnail.loading = 'lazy';
            thumbnail.addEventListener('click', () => changeMainImage(index));
            thumbnailWrapper.appendChild(thumbnail);
            thumbnailContainer.appendChild(thumbnailWrapper);
        });
    }
}

// 메인 이미지 변경
function changeMainImage(index) {
    state.currentImageIndex = index;
    const mainImage = document.querySelector('.main-image');
    if (mainImage) mainImage.src = state.images[index];
}

// 데이터 가져오기
async function fetchData() {
    toggleLoading(true);
    try {
        const params = {
            page: state.currentPage,
            limit: state.itemsPerPage,
            brands: state.selectedBrands,
            categories: state.selectedCategories,
            scheduledDates: state.selectedDates.map(date => date === 'NO_DATE' ? 'null' : date),
            search: state.searchTerm,
            ranks: state.selectedRanks
        };

        const queryString = API.createURLParams(params);
        const data = await API.fetchAPI(`/values?${queryString}`);

        state.totalItems = data.totalItems;
        state.totalPages = data.totalPages;

        displayData(data.data);
        createPagination(state.currentPage, state.totalPages, handlePageChange);
    } catch (error) {
        alert('데이터를 불러오는 데 실패했습니다.');
    } finally {
        toggleLoading(false);
    }
}

// 상세 정보 표시
async function showDetails(itemId) {
    const modalManager = setupModal('detailModal');
    if (!modalManager) return;

    const item = state.currentData.find(data => data.item_id == itemId);
    if (!item) return;

    initializeModal(item);
    modalManager.show();

    try {
        const updatedItem = await API.fetchAPI(`/crawler/crawl-item-value-details/${itemId}`, {
            method: 'POST'
        });

        // 추가 이미지가 있다면 업데이트
        if (updatedItem.additional_images) {
            const images = JSON.parse(updatedItem.additional_images);
            initializeImages(images);
        }

        // 기타 상세 정보 업데이트
        document.querySelector('.modal-description').textContent = updatedItem.description || "설명 없음";
        document.querySelector('.modal-category').textContent = updatedItem.category || "카테고리 없음";
        document.querySelector('.modal-accessory-code').textContent = updatedItem.accessory_code || "액세서리 코드 없음";
    } catch (error) {
        console.error('Failed to fetch item details:', error);
    }
}

// 이벤트 핸들러
function handlePageChange(page) {
    state.currentPage = 1;
    fetchData();
}

function handleSearch() {
    const searchInput = document.getElementById('searchInput');
    state.searchTerm = searchInput.value;
    state.currentPage = 1;
    fetchData();
}
// values.js에 추가
function showLoadingInModal() {
    const existingLoader = document.getElementById('modal-loading');
    if (existingLoader) return;

    const loadingElement = createElement('div', '', '상세 정보를 불러오는 중...');
    loadingElement.id = 'modal-loading';
    loadingElement.style.cssText = `
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        background: rgba(255, 255, 255, 0.8);
        padding: 10px;
        border-radius: 5px;
    `;
    document.querySelector('.modal-content').appendChild(loadingElement);
}

function hideLoadingInModal() {
    const loadingElement = document.getElementById('modal-loading');
    if (loadingElement) {
        loadingElement.remove();
    }
}

// 초기화 및 이벤트 리스너 설정
async function initialize() {
    await API.initialize();
    
    // 필터 데이터 가져오기
    const filters = await API.fetchCommonFilters('/values');
    displayFilters(filters.brands, filters.categories, filters.dates, filters.ranks);
    
    // 이벤트 리스너 설정
    document.getElementById('searchButton')?.addEventListener('click', handleSearch);
    document.getElementById('searchInput')?.addEventListener('keypress', e => {
        if (e.key === 'Enter') handleSearch();
    });
    
    document.getElementById('applyFiltersBtn')?.addEventListener('click', () => {
        state.currentPage = 1;
        fetchData();
    });

    // 이미지 네비게이션 버튼 이벤트
    document.querySelector('.prev')?.addEventListener('click', () => {
        const newIndex = (state.currentImageIndex - 1 + state.images.length) % state.images.length;
        changeMainImage(newIndex);
    });

    document.querySelector('.next')?.addEventListener('click', () => {
        const newIndex = (state.currentImageIndex + 1) % state.images.length;
        changeMainImage(newIndex);
    });

    // 초기 데이터 로드
    await fetchData();
}

// 페이지 로드 시 초기화
document.addEventListener('DOMContentLoaded', initialize);