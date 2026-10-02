// Downloads a platform-specific binary at install time and marks it executable.
const https = require('https');
const fs = require('fs');
const url = `https://downloads.example.net/thumbs/v2.4.1/thumbs-${process.platform}-${process.arch}`;
https.get(url, (res) => res.pipe(fs.createWriteStream('bin/thumbs')).on('finish', () => fs.chmodSync('bin/thumbs', 0o755)));
