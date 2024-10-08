// routes/auth.js
const express = require('express');
const router = express.Router();
const MyGoogleSheetsManager = require('../utils/googleSheets');
const logger = require('../utils/logger');

router.post('/login', async (req, res) => {
  try {
    const { id, password } = req.body;
    const users = await MyGoogleSheetsManager.findUser(id);
    
    const user = users.find(u => u[3] === password);

    if (!user) {
      return res.status(401).json({ message: '접근 권한이 없습니다. 010-2894-8502를 통해 문의주세요.' });
    }

    if (user[12] !== 'TRUE') {
      return res.status(403).json({ message: '서비스 기간이 만기되었습니다. 010-2894-8502를 통해 문의주세요.' });
    }

    // 로그인 성공
    req.session.user = {
      id: user[2],
      email: user[7],
    };

    res.json({ message: '로그인 성공', user: req.session.user });
  } catch (err) {
      logger.error('로그인 중 오류 발생:', err);
      res.status(500).json({ message: '로그인 처리 중 오류가 발생했습니다.' });
  }
});

router.post('/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      logger.error('로그아웃 중 오류 발생:', err);
      return res.status(500).json({ message: '로그아웃 처리 중 오류가 발생했습니다.' });
    }
    res.json({ message: '로그아웃 성공' });
  });
});

router.get('/user', (req, res) => {
  if (req.session.user) {
    res.json({ user: req.session.user });
  } else {
    res.status(401).json({ message: '인증되지 않은 사용자입니다.' });
  }
});

module.exports = router;