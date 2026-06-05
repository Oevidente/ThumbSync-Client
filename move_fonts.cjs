const fs = require('fs');
const path = require('path');

const fontsDir = path.join(__dirname, 'public', 'fonts');
if (!fs.existsSync(fontsDir)) {
  fs.mkdirSync(fontsDir, { recursive: true });
}

fs.readdirSync(__dirname).forEach(file => {
  if (file.startsWith('SF-') && (file.endsWith('.otf') || file.endsWith('.ttf'))) {
    const oldPath = path.join(__dirname, file);
    const newPath = path.join(fontsDir, file);
    fs.renameSync(oldPath, newPath);
  }
});
console.log("Fonts moved!");
