// API 기본 설정
const API_BASE_URL = '/api';
let EXCHANGE_RATE = 9.0;

// API 요청 기본 함수
async function fetchAPI(endpoint, options = {}) {
    const defaultOptions = {
        credentials: 'include',
        headers: {
            'Content-Type': 'application/json',
            ...options.headers
        }
    };

    try {
        const response = await fetch(`${API_BASE_URL}${endpoint}`, {
            ...defaultOptions,
            ...options
        });

        if (!response.ok) {
            if (response.status === 401) {
                // 인증 실패 처리
                if (window.handleAuthFailure) {
                    window.handleAuthFailure();
                }
                throw new Error('Unauthorized');
            }
            const errorData = await response.json();
            throw new Error(errorData.message || `HTTP error! status: ${response.status}`);
        }

        return response.json();
    } catch (error) {
        console.error('API request failed:', error);
        throw error;
    }
}

// URL 파라미터 생성 함수
function createURLParams(params = {}) {
    const searchParams = new URLSearchParams();
    
    Object.entries(params).forEach(([key, value]) => {
        if (Array.isArray(value)) {
            if (value.length > 0) {
                searchParams.append(key, value.join(','));
            }
        } else if (value !== undefined && value !== null && value !== '') {
            searchParams.append(key, value.toString());
        }
    });
    
    return searchParams.toString();
}

// 필터 데이터 요청 함수
async function fetchFilterData(endpoint) {
    try {
        const response = await fetchAPI(endpoint);
        return response;
    } catch (error) {
        console.error('Error fetching filter data:', error);
        throw error;
    }
}

// 공통 필터 데이터 가져오기
async function fetchCommonFilters(baseEndpoint) {
    try {
        const [brands, categories, dates, ranks] = await Promise.all([
            fetchFilterData(`${baseEndpoint}/brands-with-count`),
            fetchFilterData(`${baseEndpoint}/categories`),
            fetchFilterData(`${baseEndpoint}/scheduled-dates-with-count`),
            fetchFilterData(`${baseEndpoint}/ranks`)
        ]);
        
        return { brands, categories, dates, ranks };
    } catch (error) {
        console.error('Error fetching filters:', error);
        throw error;
    }
}

// 환율 정보 가져오기
async function fetchExchangeRate() {
    try {
        const response = await fetchAPI('/data/exchange-rate');
        EXCHANGE_RATE = response.rate;
        return response.rate;
    } catch (error) {
        console.error('Error fetching exchange rate:', error);
        return EXCHANGE_RATE; // 기본값 반환
    }
}

// 이미지 URL 검증
function validateImageUrl(url) {
    if (!url) return '/images/placeholder.png';
    // 이미지 URL이 유효한지 확인하는 추가 로직
    return url;
}

// API 초기화
async function initializeAPI() {
    await fetchExchangeRate();
}

// 내보내기
window.API = {
    fetchAPI,
    createURLParams,
    fetchFilterData,
    fetchCommonFilters,
    validateImageUrl,
    initialize: initializeAPI,
    get exchangeRate() { return EXCHANGE_RATE; }
};