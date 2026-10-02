// Downloads a platform binary at install time, which is what the deps check reports.
const https = require('https');
https.get(`https://downloads.example.net/tool-${process.platform}-${process.arch}`, () => {});
