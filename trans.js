const translator = require("./utils/translator");

// 일본어 → 영어 번역
const result = await translator.translate("こんにちは世界");
console.log(result); // "Hello World"

// 캐시 정리
await translator.cleanupCache();
