const fs = require("fs");

const filePath = "./list.json"; // your file

// Read file
const raw = fs.readFileSync(filePath, "utf-8");
const data = JSON.parse(raw);

// Keep only name + appId
const cleaned = data.games.map(({ name, appId }) => ({ name, appId }));

// Overwrite SAME file
fs.writeFileSync(filePath, JSON.stringify(cleaned, null, 2));

console.log("✅ File cleaned (only name + appId kept)");