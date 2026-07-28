const fs = require('fs');
const path = require('path');

const assetsDir = path.join(__dirname, 'assets');
const outputFile = path.join(__dirname, 'src', 'assets-base64.js');

const files = ['cat.png', 'dog.png', 'bao.png'];

let content = 'const PET_IMAGES = {\n';

files.forEach(f => {
  const key = f.replace('.png', '');
  const filePath = path.join(assetsDir, f);
  const buf = fs.readFileSync(filePath);
  const b64 = buf.toString('base64');
  content += '  ' + key + ': "data:image/png;base64,' + b64 + '",\n';
});

content += '};\n\n';
content += 'module.exports = PET_IMAGES;\n';

fs.writeFileSync(outputFile, content);
console.log('Done: ' + outputFile);
console.log('Size: ' + fs.statSync(outputFile).size + ' bytes');
