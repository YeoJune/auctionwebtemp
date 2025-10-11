const translator = require("./utils/translator");

// 일본어 → 영어 번역
translator.translate("こんにちは世界").then((res) => {
  console.log(res); // "Hello World"
});
