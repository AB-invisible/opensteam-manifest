const fs = require('fs');

const files = [
  "app/api/[apiKey]/activate/route.ts",
  "app/api/[apiKey]/bulk/generate/route.ts",
  "app/api/[apiKey]/download/[appId]/route.ts",
  "app/api/[apiKey]/generate/[appId]/route.ts",
  "app/api/[apiKey]/request/[appId]/route.ts"
];

const injection = `
  const cutoffDate = new Date('2026-07-05T00:00:00.000Z')
  if (new Date(auth.apiKey.createdAt) >= cutoffDate) {
    return NextResponse.json(
      { error: 'Please use our new v2 endpoint from http://127.0.0.1:3000/docs' },
      { status: 666, headers: apiHeaders(auth.rateLimit, auth.dailyQuota, request.headers.get('Origin')) }
    )
  }`;

for (const file of files) {
  let content = fs.readFileSync(file, 'utf8');
  // Match the block `if (!auth) { ... }`
  const regex = /if\s*\(!auth\)\s*\{[\s\S]*?\n\s*\}/;
  const match = content.match(regex);
  if (match) {
    const updated = content.replace(regex, match[0] + "\n" + injection);
    fs.writeFileSync(file, updated);
    console.log("Updated", file);
  } else {
    console.log("Failed to match in", file);
  }
}
