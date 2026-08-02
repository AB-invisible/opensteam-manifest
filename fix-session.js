const fs = require('fs');
const path = require('path');

function walkDir(dir, callback) {
  if (!fs.existsSync(dir)) return;
  fs.readdirSync(dir).forEach(f => {
    let dirPath = path.join(dir, f);
    let isDirectory = fs.statSync(dirPath).isDirectory();
    isDirectory ? walkDir(dirPath, callback) : callback(dirPath);
  });
}

walkDir('./app', (filePath) => {
  if (!filePath.endsWith('.ts') && !filePath.endsWith('.tsx')) return;

  let content = fs.readFileSync(filePath, 'utf8');

  if (content.includes("from '@/app/api/auth/[...nextauth]/route'")) {
    content = content.replace(/from '@\/app\/api\/auth\/\[\.\.\.nextauth\]\/route'/g, "from '@/app/lib/auth-options'");
    fs.writeFileSync(filePath, content, 'utf8');
    console.log('Fixed import:', filePath);
  }
});
