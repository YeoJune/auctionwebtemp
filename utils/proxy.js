// utils/proxy.js (최적화 버전)
const tough = require("tough-cookie");
const axios = require("axios");
const { HttpsProxyAgent } = require("https-proxy-agent");
const { HttpProxyAgent } = require("http-proxy-agent");
const {
  HttpCookieAgent,
  HttpsCookieAgent,
  createCookieAgent,
} = require("http-cookie-agent/http");

// agentkeepalive를 사용한 최적화 (권장)
const Agent = require("agentkeepalive");

// 또는 기본 Node.js Agent 사용
// const http = require("http");
// const https = require("https");

class ProxyManager {
  constructor(config = {}) {
    this.proxyIPs = this.loadProxyIPs();
    this.defaultHeaders = config.headers || {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15",
      "Accept-Language": "en-US,en;q=0.9",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    };
    this.defaultTimeout = config.timeout || 30000;
    this.defaultMaxRedirects = config.maxRedirects || 5;

    // Keep-Alive 설정
    this.keepAliveConfig = {
      maxSockets: config.maxSockets || 100, // 호스트당 최대 소켓 수
      maxFreeSockets: config.maxFreeSockets || 10, // 재사용을 위해 유지할 소켓 수
      timeout: config.socketTimeout || 60000, // 활성 소켓 타임아웃 (60초)
      freeSocketTimeout: config.freeSocketTimeout || 30000, // 유휴 소켓 타임아웃 (30초)
      keepAliveMsecs: config.keepAliveMsecs || 1000, // TCP Keep-Alive 패킷 초기 지연
    };
  }

  loadProxyIPs() {
    const proxyIPsString = process.env.PROXY_IPS;
    if (!proxyIPsString) {
      console.log("No PROXY_IPS found, using direct connection only");
      return [];
    }
    return proxyIPsString.split(",").map((ip) => ip.trim());
  }

  /**
   * 최적화된 Keep-Alive Agent 생성
   */
  createKeepAliveAgents() {
    // agentkeepalive 사용 (권장)
    const httpAgent = new Agent(this.keepAliveConfig);
    const httpsAgent = new Agent.HttpsAgent(this.keepAliveConfig);

    /* 기본 Node.js Agent 사용하는 경우
    const httpAgent = new http.Agent({
      keepAlive: true,
      maxSockets: this.keepAliveConfig.maxSockets,
      maxFreeSockets: this.keepAliveConfig.maxFreeSockets,
      timeout: this.keepAliveConfig.timeout,
      keepAliveMsecs: this.keepAliveConfig.keepAliveMsecs,
    });
    
    const httpsAgent = new https.Agent({
      keepAlive: true,
      maxSockets: this.keepAliveConfig.maxSockets,
      maxFreeSockets: this.keepAliveConfig.maxFreeSockets,
      timeout: this.keepAliveConfig.timeout,
      keepAliveMsecs: this.keepAliveConfig.keepAliveMsecs,
    });
    */

    return { httpAgent, httpsAgent };
  }

  /**
   * 직접 연결 클라이언트 생성 (Keep-Alive 최적화)
   */
  createDirectClient() {
    const cookieJar = new tough.CookieJar();
    const { httpAgent, httpsAgent } = this.createKeepAliveAgents();

    // Cookie Agent와 Keep-Alive Agent 결합
    const HttpKeepAliveCookieAgent = createCookieAgent(httpAgent.constructor);
    const HttpsKeepAliveCookieAgent = createCookieAgent(httpsAgent.constructor);

    const client = axios.create({
      httpAgent: new HttpKeepAliveCookieAgent({
        cookies: { jar: cookieJar },
        ...this.keepAliveConfig,
      }),
      httpsAgent: new HttpsKeepAliveCookieAgent({
        cookies: { jar: cookieJar },
        ...this.keepAliveConfig,
      }),
      headers: this.defaultHeaders,
      maxRedirects: this.defaultMaxRedirects,
      timeout: this.defaultTimeout,
      validateStatus: function (status) {
        return status >= 200 && status < 500;
      },
    });

    return {
      client,
      cookieJar,
      httpAgent,
      httpsAgent,
      type: "direct",
      name: "직접연결(Keep-Alive)",
      proxyInfo: null,
    };
  }

  /**
   * 프록시 클라이언트 생성 (Keep-Alive 최적화)
   */
  createProxyClient(proxyIP, port = 3128) {
    const cookieJar = new tough.CookieJar();
    const { httpAgent, httpsAgent } = this.createKeepAliveAgents();

    // Keep-Alive가 적용된 Proxy Agent 생성
    const HttpProxyKeepAliveAgent = createCookieAgent(HttpProxyAgent);
    const HttpsProxyKeepAliveAgent = createCookieAgent(HttpsProxyAgent);

    const client = axios.create({
      httpAgent: new HttpProxyKeepAliveAgent({
        cookies: { jar: cookieJar },
        host: proxyIP,
        port: port,
        protocol: "http:",
        // Keep-Alive 설정 추가
        keepAlive: true,
        maxSockets: this.keepAliveConfig.maxSockets,
        maxFreeSockets: this.keepAliveConfig.maxFreeSockets,
        timeout: this.keepAliveConfig.timeout,
        keepAliveMsecs: this.keepAliveConfig.keepAliveMsecs,
      }),
      httpsAgent: new HttpsProxyKeepAliveAgent({
        cookies: { jar: cookieJar },
        host: proxyIP,
        port: port,
        protocol: "http:",
        // Keep-Alive 설정 추가
        keepAlive: true,
        maxSockets: this.keepAliveConfig.maxSockets,
        maxFreeSockets: this.keepAliveConfig.maxFreeSockets,
        timeout: this.keepAliveConfig.timeout,
        keepAliveMsecs: this.keepAliveConfig.keepAliveMsecs,
      }),
      headers: this.defaultHeaders,
      maxRedirects: this.defaultMaxRedirects,
      timeout: this.defaultTimeout,
      validateStatus: function (status) {
        return status >= 200 && status < 500;
      },
    });

    return {
      client,
      cookieJar,
      type: "proxy",
      name: `프록시(${proxyIP})-Keep-Alive`,
      proxyInfo: { ip: proxyIP, port },
    };
  }

  /**
   * 모든 가능한 클라이언트 생성 (직접 연결 + 모든 프록시)
   */
  createAllClients() {
    const clients = [];

    // 직접 연결 클라이언트
    clients.push({
      index: 0,
      ...this.createDirectClient(),
      isLoggedIn: false,
      loginTime: null,
    });

    // 프록시 클라이언트들
    this.proxyIPs.forEach((ip, index) => {
      clients.push({
        index: index + 1,
        ...this.createProxyClient(ip),
        isLoggedIn: false,
        loginTime: null,
      });
    });

    return clients;
  }

  /**
   * 특정 클라이언트 재생성
   */
  recreateClient(clientIndex) {
    if (clientIndex === 0) {
      return {
        index: 0,
        ...this.createDirectClient(),
        isLoggedIn: false,
        loginTime: null,
      };
    } else {
      const proxyIP = this.proxyIPs[clientIndex - 1];
      if (!proxyIP) {
        throw new Error(`Invalid client index: ${clientIndex}`);
      }
      return {
        index: clientIndex,
        ...this.createProxyClient(proxyIP),
        isLoggedIn: false,
        loginTime: null,
      };
    }
  }

  /**
   * Keep-Alive 상태 모니터링
   */
  getKeepAliveStatus(clientInfo) {
    if (clientInfo.httpAgent && clientInfo.httpAgent.getCurrentStatus) {
      return {
        http: clientInfo.httpAgent.getCurrentStatus(),
        https: clientInfo.httpsAgent
          ? clientInfo.httpsAgent.getCurrentStatus()
          : null,
      };
    }
    return null;
  }

  /**
   * 클라이언트 연결 테스트
   */
  async testClient(clientInfo, testUrl = "https://httpbin.org/ip") {
    try {
      const startTime = Date.now();
      const response = await clientInfo.client.get(testUrl, { timeout: 10000 });
      const endTime = Date.now();

      return {
        success: true,
        status: response.status,
        data: response.data,
        responseTime: endTime - startTime,
        keepAliveStatus: this.getKeepAliveStatus(clientInfo),
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        code: error.code,
      };
    }
  }

  /**
   * 모든 클라이언트 연결 테스트
   */
  async testAllClients(clients, testUrl = "https://httpbin.org/ip") {
    const results = await Promise.allSettled(
      clients.map(async (client) => {
        const result = await this.testClient(client, testUrl);
        return {
          name: client.name,
          index: client.index,
          ...result,
        };
      })
    );

    return results.map((result, index) => ({
      client: clients[index],
      test:
        result.status === "fulfilled"
          ? result.value
          : { success: false, error: result.reason.message },
    }));
  }

  /**
   * Keep-Alive 설정 정보 반환
   */
  getKeepAliveConfig() {
    return { ...this.keepAliveConfig };
  }

  /**
   * 연결 상태 상세 정보
   */
  async getDetailedConnectionInfo(clients) {
    const info = {
      totalClients: clients.length,
      keepAliveConfig: this.getKeepAliveConfig(),
      clientStatus: [],
    };

    for (const client of clients) {
      const status = this.getKeepAliveStatus(client);
      info.clientStatus.push({
        name: client.name,
        index: client.index,
        type: client.type,
        keepAliveStatus: status,
      });
    }

    return info;
  }

  /**
   * 사용 가능한 프록시 수 반환
   */
  getAvailableProxyCount() {
    return this.proxyIPs.length;
  }

  /**
   * 총 클라이언트 수 반환 (직접 연결 + 프록시)
   */
  getTotalClientCount() {
    return 1 + this.proxyIPs.length;
  }

  /**
   * 모든 클라이언트의 Keep-Alive 연결 정리
   */
  cleanup(clients) {
    clients.forEach((client) => {
      if (client.httpAgent && client.httpAgent.destroy) {
        client.httpAgent.destroy();
      }
      if (client.httpsAgent && client.httpsAgent.destroy) {
        client.httpsAgent.destroy();
      }
    });
  }
}

module.exports = { ProxyManager };
