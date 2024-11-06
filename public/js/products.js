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
    wishlist: [],
    bidData: [],
    currentData: [],
    images: [],
    currentImageIndex: 0,
    isAuthenticated: false
};

// 가격 계산 함수들
function calculateLocalFee(price, auctionNumber) {
    if (!price) return 0;
    if (auctionNumber == 1) {
        if (price < 10000) return 1100;
        if (price < 50000) return 1650;
        return 2750;
    } else if (auctionNumber == 2) {
        return price < 100000 ? price * 0.1 + 1990 : price * 0.07 + 1990;
    }
    return 0;
}

function calculateCustomsDuty(amountKRW, category) {
    if (['가방', '악세서리', '소품・액세서리', '소품'].includes(category)) {
        return amountKRW * 0.18;
    }
    if (['의류', '신발'].includes(category)) {
        return amountKRW * 0.23;
    }
    if (category == '시계') {
        const basicDuty = amountKRW * 0.08;
        const extraDuty = amountKRW > 2000000 ? (amountKRW - 2000000) * 0.2 : 0;
        const additionalTax1 = extraDuty * 0.3;
        const additionalTax2 = extraDuty * 0.1;
        const vat = (amountKRW + basicDuty + extraDuty) * 0.1;
        return basicDuty + extraDuty + additionalTax1 + additionalTax2 + vat;
    }
    return 0;
}

function calculateTotalPrice(price, auctionNumber, category) {
    price = parseFloat(price) || 0;
    const localFee = calculateLocalFee(price, auctionNumber);
    const totalAmountKRW = (price + localFee) * API.exchangeRate;
    const customsDuty = calculateCustomsDuty(totalAmountKRW, category);
    const serviceFee = (totalAmountKRW + customsDuty) * 0.05;
    return Math.round(totalAmountKRW + customsDuty + serviceFee);
}

// 입찰 섹션 HTML 생성
function getBidSectionHTML(bidInfo, itemId, aucNum, category) {
    if (bidInfo?.final_price) {
        return `
            <div>
                <p>최종 입찰금액: ${formatNumber(bidInfo.final_price)} ¥</p>
                <div class="price-details-container">
                    (수수료, 세금 포함 ${formatNumber(calculateTotalPrice(bidInfo.final_price, aucNum, category))}원)
                </div>
            </div>`;
    }

    let html = `<div class="bid-info">`;
    if (bidInfo?.first_price || bidInfo?.second_price) {
        html += `
            <div>
                <p>1차 입찰금액: ${formatNumber(bidInfo.first_price) || '-'} ¥</p>
                <div class="price-details-container">
                    ${bidInfo.first_price ? `(수수료, 세금 포함 ${formatNumber(calculateTotalPrice(bidInfo.first_price, aucNum, category))}원)` : ''}
                </div>
                <p>2차 제안금액: ${formatNumber(bidInfo.second_price) || '-'} ¥</p>
                <div class="price-details-container">
                    ${bidInfo.second_price ? `(수수료, 세금 포함 ${formatNumber(calculateTotalPrice(bidInfo.second_price, aucNum, category))}원)` : ''}
                </div>
            </div>`;
    }

    html += `
        <div>
            <div class="bid-input-group">
                <input type="number" placeholder="입찰 예정액" class="bid-input" data-item-id="${itemId}">
                <span class="bid-currency">¥</span>
                <button class="bid-button" onclick="handleBidSubmit(this.parentElement.children[0].value, '${itemId}')">입찰</button>
            </div>
            <div class="price-details-container"></div>
        </div>
    </div>`;
    
    return html;
}

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
        const card = createProductCard(item);
        dataBody.appendChild(card);
    });

    initializePriceCalculators();
}

// 제품 카드 생성
function createProductCard(item) {
    const card = createElement('div', 'product-card');
    card.dataset.itemId = item.item_id;

    const isWishlisted = state.wishlist.includes(item.item_id);
    const bidInfo = state.bidData.find(b => b.item_id == item.item_id);

    card.innerHTML = `
        <div class="product-header">
            <div>
                <div class="product-brand">${item.brand}</div>
                <div class="auctioneer-number">${item.auc_num}번</div>
            </div>
            <h3 class="product-title">${item.korean_title}</h3>
        </div>
        <img src="${API.validateImageUrl(item.image)}" alt="${item.korean_title}" class="product-image">
        <div class="product-details">
            <p class="scheduled-date">예정일: ${formatDate(item.scheduled_date)}</p>
            <p class="scheduled-date">랭크: ${item.rank}</p>
            <div class="bid-section">
                ${bidInfo ? getBidSectionHTML(bidInfo, item.item_id, item.auc_num, item.category) 
                         : getDefaultBidSectionHTML(item.item_id)}
            </div>
            <div class="action-buttons">
                <button class="wishlist-btn ${isWishlisted ? 'active' : ''}" 
                        onclick="event.stopPropagation(); toggleWishlist('${item.item_id}')">
                    <i class="fas fa-star"></i>
                </button>
            </div>
        </div>
    `;

    card.addEventListener('click', (event) => {
        if (!event.target.closest('.product-details')) {
            showDetails(item.item_id);
        }
    });

    return card;
}

// 인증 관련 함수들
async function checkAuthStatus() {
    try {
        const response = await API.fetchAPI('/auth/user');
        state.isAuthenticated = !!response.user;
        updateAuthUI();
    } catch (error) {
        state.isAuthenticated = false;
        updateAuthUI();
    }
}

function updateAuthUI() {
    const signinBtn = document.getElementById('signinBtn');
    const signoutBtn = document.getElementById('signoutBtn');
    const wishlistFilterContainer = document.querySelector('.wishlist-filters');

    if (state.isAuthenticated) {
        signinBtn.style.display = 'none';
        signoutBtn.style.display = 'inline-block';
        wishlistFilterContainer.style.display = 'block';
    } else {
        signinBtn.style.display = 'inline-block';
        signoutBtn.style.display = 'none';
        wishlistFilterContainer.style.display = 'none';
    }
}

// 위시리스트 관련 함수들
async function toggleWishlist(itemId) {
    if (!state.isAuthenticated) {
        alert('위시리스트 기능을 사용하려면 로그인이 필요합니다.');
        return;
    }

    try {
        const isWishlisted = state.wishlist.includes(itemId);
        const method = isWishlisted ? 'DELETE' : 'POST';
        
        await API.fetchAPI('/wishlist', {
            method,
            body: JSON.stringify({ itemId: itemId.toString() })
        });

        if (isWishlisted) {
            state.wishlist = state.wishlist.filter(id => id !== itemId);
        } else {
            state.wishlist.push(itemId);
        }
        
        updateWishlistUI(itemId);
    } catch (error) {
        alert(`위시리스트 업데이트 중 오류가 발생했습니다: ${error.message}`);
    }
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
            ranks: state.selectedRanks,
            wishlistOnly: document.getElementById('wishlistFilter')?.checked,
            bidOnly: document.getElementById('bidFilter')?.checked
        };

        const queryString = API.createURLParams(params);
        const data = await API.fetchAPI(`/data?${queryString}`);

        state.bidData = data.bidData || [];
        state.wishlist = data.wishlist || [];
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

// 이벤트 핸들러들
function handlePageChange(page) {
    state.currentPage = page;
    fetchData();
}

function handleSearch() {
    const searchInput = document.getElementById('searchInput');
    state.searchTerm = searchInput.value;
    state.currentPage = 1;
    fetchData();
}

async function handleSignout() {
    try {
        await API.fetchAPI('/auth/logout', { method: 'POST' });
        state.isAuthenticated = false;
        updateAuthUI();
        fetchData();
    } catch (error) {
        alert('로그아웃 중 오류가 발생했습니다.');
    }
}

// products.js에 추가
function getDefaultBidSectionHTML(itemId) {
    return `
        <div class="bid-info">
            <div>
                <div class="bid-input-group">
                    <input type="number" placeholder="입찰 예정액" class="bid-input" data-item-id="${itemId}">
                    <span class="bid-currency">¥</span>
                    <button class="bid-button" onclick="handleBidSubmit(this.parentElement.children[0].value, '${itemId}')">입찰</button>
                </div>
                <div class="price-details-container"></div>
            </div>
        </div>
    `;
}

function initializePriceCalculators() {
    document.querySelectorAll('.bid-input').forEach(input => {
        const container = input.parentElement.parentElement.querySelector('.price-details-container');
        const itemId = input.getAttribute('data-item-id');
        const item = state.currentData.find(item => item.item_id == itemId);
        
        if (container && item) {
            input.addEventListener('input', function() {
                const price = parseFloat(this.value) || 0;
                const totalPrice = calculateTotalPrice(price, item.auc_num, item.category);
                container.innerHTML = price ? `(수수료, 세금 포함 ${formatNumber(totalPrice)}원)` : '';
            });
        }
    });
}

async function handleBidSubmit(value, itemId) {
    if (!state.isAuthenticated) {
        alert('입찰하려면 로그인이 필요합니다.');
        return;
    }
    
    const bidInfo = state.bidData.find(b => b.item_id == itemId);
    const isFinalBid = !!bidInfo && (!!bidInfo.first_price || !!bidInfo.second_price);
    
    try {
        await API.fetchAPI('/bid/place-reservation', {
            method: 'POST',
            body: JSON.stringify({ 
                itemId, 
                bidAmount: value, 
                isFinalBid 
            })
        });
        
        alert(isFinalBid ? '최종 입찰금액이 등록되었습니다.' : '입찰 예정액이 신청되었습니다.');
        await fetchData(); // 데이터 새로고침
    } catch (error) {
        alert(`입찰 신청 중 오류가 발생했습니다: ${error.message}`);
    }
}
// products.js에 추가
async function showNoticeSection() {
    const noticeSection = document.querySelector('.notice-section');
    const showNoticesBtn = document.getElementById('showNoticesBtn');
    
    if (!noticeSection || !showNoticesBtn) return;

    if (noticeSection.style.display === 'none') {
        noticeSection.style.display = 'block';
        showNoticesBtn.textContent = '공지사항 닫기';
        await fetchNotices();
    } else {
        noticeSection.style.display = 'none';
        showNoticesBtn.textContent = '공지사항 보기';
    }
}

async function fetchNotices() {
    try {
        const notices = await API.fetchAPI('/admin/notices');
        displayNotices(notices);
    } catch (error) {
        console.error('Error fetching notices:', error);
    }
}

function displayNotices(notices) {
    const noticeList = document.getElementById('noticeList');
    if (!noticeList) return;

    noticeList.innerHTML = '';
    notices.forEach(notice => {
        const li = createElement('li', '', notice.title);
        li.addEventListener('click', () => showNoticeDetail(notice));
        noticeList.appendChild(li);
    });
}

function showNoticeDetail(notice) {
    const modal = document.getElementById('noticeDetailModal');
    const title = document.getElementById('noticeTitle');
    const content = document.getElementById('noticeContent');
    const image = document.getElementById('noticeImage');
    
    if (!modal || !title || !content || !image) return;
    
    title.textContent = notice.title;
    content.innerHTML = notice.content.replace(/\n/g, '<br>');
    
    if (notice.image_url) {
        image.src = notice.image_url;
        image.style.display = 'block';
    } else {
        image.style.display = 'none';
    }
    
    modal.style.display = 'block';
}
// products.js에 추가
async function showDetails(itemId) {
    const modalManager = setupModal('detailModal');
    if (!modalManager) return;

    const item = state.currentData.find(data => data.item_id == itemId);
    if (!item) return;

    // 기본 정보로 모달 초기화
    initializeModal(item);
    modalManager.show();

    // 로딩 표시
    showLoadingInModal();

    try {
        // 상세 정보 가져오기
        const updatedItem = await API.fetchAPI(`/crawler/crawl-item-details/${itemId}`, {
            method: 'POST'
        });

        // 상세 정보 업데이트
        updateModalWithDetails(updatedItem);

        // 추가 이미지가 있다면 업데이트
        if (updatedItem.additional_images) {
            initializeImages(JSON.parse(updatedItem.additional_images));
        }
    } catch (error) {
        console.error('Failed to fetch item details:', error);
    } finally {
        hideLoadingInModal();
    }
}

function initializeModal(item) {
    document.querySelector('.modal-brand').textContent = item.brand;
    document.querySelector('.modal-title').textContent = item.korean_title;
    document.querySelector('.main-image').src = API.validateImageUrl(item.image);
    document.querySelector('.modal-description').textContent = "로딩 중...";
    document.querySelector('.modal-category').textContent = item.category || "로딩 중...";
    document.querySelector('.modal-brand2').textContent = item.brand;
    document.querySelector('.modal-accessory-code').textContent = item.accessory_code || "로딩 중...";
    document.querySelector('.modal-scheduled-date').textContent = formatDate(item.scheduled_date) || "로딩 중...";

    // 입찰 정보 초기화
    initializeBidInfo(item.item_id);

    // 이미지 초기화
    initializeImages([item.image]);
}

function updateModalWithDetails(item) {
    document.querySelector('.modal-description').textContent = item.description || "설명 없음";
    document.querySelector('.modal-category').textContent = item.category || "카테고리 없음";
    document.querySelector('.modal-accessory-code').textContent = item.accessory_code || "액세서리 코드 없음";
    document.querySelector('.modal-scheduled-date').textContent = item.scheduled_date ? formatDate(item.scheduled_date) : "날짜 정보 없음";
    document.querySelector('.modal-brand').textContent = item.brand;
    document.querySelector('.modal-brand2').textContent = item.brand;
    document.querySelector('.modal-title').textContent = item.korean_title || "제목 없음";
}

async function initialize() {
    await API.initialize();
    await checkAuthStatus();
    
    try {
        // 필터 데이터 가져오기
        const [brandsResponse, categoriesResponse, datesResponse, ranksResponse] = await Promise.all([
            API.fetchAPI('/data/brands-with-count'),
            API.fetchAPI('/data/categories'),
            API.fetchAPI('/data/scheduled-dates-with-count'),
            API.fetchAPI('/data/ranks')
        ]);

        // 각각의 필터 데이터 전달
        displayFilters(
            brandsResponse,
            categoriesResponse,
            datesResponse,
            ranksResponse
        );
        
        // 이벤트 리스너 설정
        document.getElementById('searchButton')?.addEventListener('click', handleSearch);
        document.getElementById('searchInput')?.addEventListener('keypress', e => {
            if (e.key === 'Enter') handleSearch();
        });
        
        document.getElementById('applyFiltersBtn')?.addEventListener('click', () => {
            state.currentPage = 1;
            fetchData();
        });
        
        document.getElementById('signinBtn')?.addEventListener('click', () => {
            window.location.href = './pages/signin.html';
        });
        
        document.getElementById('signoutBtn')?.addEventListener('click', handleSignout);
        document.getElementById('showNoticesBtn')?.addEventListener('click', showNoticeSection);

        // 초기 데이터 로드
        await fetchData();
    } catch (error) {
        console.error('Error initializing filters:', error);
        alert('필터 데이터를 불러오는 데 실패했습니다.');
    }
}

// 페이지 로드 시 초기화
document.addEventListener('DOMContentLoaded', initialize);
