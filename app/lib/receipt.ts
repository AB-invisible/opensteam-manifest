import { readFile } from "fs/promises";
import { join } from "path";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFImage, type PDFPage, type RGB } from "pdf-lib";
import sharp from "sharp";

const PAGE_W = 612;
const PAGE_H = 792;
const M = 56;
const CONTENT_W = PAGE_W - M * 2;

const C = {
  emerald: rgb(0.063, 0.725, 0.506),
  emeraldDeep: rgb(0.02, 0.5, 0.36),
  emeraldSoft: rgb(0.93, 0.99, 0.96),
  emeraldLine: rgb(0.75, 0.93, 0.86),
  midnight: rgb(0.043, 0.055, 0.098),
  midnight2: rgb(0.08, 0.1, 0.16),
  slate600: rgb(0.34, 0.39, 0.47),
  slate500: rgb(0.45, 0.5, 0.58),
  slate400: rgb(0.58, 0.63, 0.7),
  slate300: rgb(0.78, 0.81, 0.85),
  slate200: rgb(0.89, 0.91, 0.93),
  slate100: rgb(0.96, 0.97, 0.98),
  ink: rgb(0.07, 0.09, 0.12),
  cloud: rgb(0.62, 0.68, 0.78),
  white: rgb(1, 1, 1),
};

const PLAN_LABELS: Record<string, string> = {
  REGULAR: "Regular Plan",
  PREMIUM: "Premium Plan",
  RESELLER: "Reseller Plan",
  BUSINESS: "Business Plan",
  UNBAN: "Account Reactivation",
  ALL_ACCOUNTS: "All Accounts",
  "All Accounts": "All Accounts",
};

const PLAN_AMOUNTS: Record<string, { amount: string; cadence: string }> = {
  REGULAR: { amount: "$2.00", cadence: "One-time payment" },
  PREMIUM: { amount: "$4.00", cadence: "One-time payment" },
  RESELLER: { amount: "$6.00", cadence: "One-time payment" },
  BUSINESS: { amount: "$12.00", cadence: "Monthly subscription" },
  UNBAN: { amount: "—", cadence: "One-time payment" },
  ALL_ACCOUNTS: { amount: "$100.00", cadence: "One-time payment" },
  "All Accounts": { amount: "$100.00", cadence: "One-time payment" },
};

type Fonts = { regular: PDFFont; bold: PDFFont };

let cachedLogo: Uint8Array | null | undefined;

async function getLogoBytes(): Promise<Uint8Array | null> {
  if (cachedLogo !== undefined) return cachedLogo;
  try {
    const raw = await readFile(join(process.cwd(), "public", "opensteam.png"));
    cachedLogo = await sharp(raw)
      .resize(160, 160, { fit: "cover" })
      .png({ quality: 90, compressionLevel: 9 })
      .toBuffer();
  } catch {
    cachedLogo = null;
  }
  return cachedLogo;
}

function t(text: string): string {
  return text.replace(/[^\x20-\x7E\n\r]/g, "?");
}

function fmtDate(date: Date): string {
  return date.toLocaleDateString("en-GB", { year: "numeric", month: "long", day: "numeric" });
}

function receiptId(date: Date): string {
  const stamp = date.toISOString().slice(0, 10).replace(/-/g, "");
  const suffix = date.getTime().toString(36).slice(-6).toUpperCase();
  return `GG-${stamp}-${suffix}`;
}

function tw(font: PDFFont, text: string, size: number): number {
  return font.widthOfTextAtSize(t(text), size);
}

function drawText(page: PDFPage, text: string, x: number, y: number, size: number, font: PDFFont, color: RGB, spacing?: number) {
  const clean = t(text);
  if (!spacing) {
    page.drawText(clean, { x, y, size, font, color });
    return;
  }
  let cx = x;
  for (const ch of clean) {
    page.drawText(ch, { x: cx, y, size, font, color });
    cx += font.widthOfTextAtSize(ch, size) + spacing;
  }
}

function drawRight(page: PDFPage, text: string, xRight: number, y: number, size: number, font: PDFFont, color: RGB, spacing = 0) {
  const clean = t(text);
  const width = tw(font, text, size) + spacing * Math.max(0, clean.length - 1);
  drawText(page, clean, xRight - width, y, size, font, color, spacing);
}

function drawHeader(page: PDFPage, fonts: Fonts, logo: PDFImage | null, id: string, date: Date) {
  const bandH = 152;
  const bandTop = PAGE_H;
  const bandBottom = PAGE_H - bandH;

  page.drawRectangle({ x: 0, y: bandBottom, width: PAGE_W, height: bandH, color: C.midnight });
  page.drawRectangle({ x: 0, y: bandBottom, width: PAGE_W, height: 3, color: C.emerald });
  page.drawRectangle({ x: 0, y: bandTop - 4, width: PAGE_W, height: 4, color: C.emerald });

  const logoSize = 66;
  const logoX = M;
  const logoY = bandBottom + (bandH - logoSize) / 2 + 4;
  if (logo) {
    page.drawCircle({
      x: logoX + logoSize / 2,
      y: logoY + logoSize / 2,
      size: logoSize / 2 + 3,
      color: C.midnight2,
      borderColor: C.emerald,
      borderWidth: 1,
    });
    page.drawImage(logo, { x: logoX, y: logoY, width: logoSize, height: logoSize });
  }

  const textX = logoX + logoSize + 20;
  const centerY = bandBottom + bandH / 2;
  drawText(page, "OPENSTEAM", textX, centerY + 8, 25, fonts.bold, C.white, 1.5);
  drawText(page, "MANIFEST PLATFORM", textX, centerY - 12, 9, fonts.regular, C.cloud, 3);
  drawText(page, "opensteam.lol", textX, centerY - 28, 8.5, fonts.regular, C.slate500, 0.5);

  const right = PAGE_W - M;
  const topY = bandTop - 40;
  drawRight(page, "OFFICIAL RECEIPT", right, topY, 10, fonts.bold, C.emerald, 2);
  drawRight(page, `No. ${id}`, right, topY - 20, 13, fonts.bold, C.white);
  drawRight(page, fmtDate(date), right, topY - 37, 9.5, fonts.regular, C.cloud);

  const badgeLabel = "PAID IN FULL";
  const bs = 8;
  const padX = 11;
  const bw = tw(fonts.bold, badgeLabel, bs) + bs * 1 + padX * 2;
  const bh = 20;
  const bx = right - bw;
  const by = topY - 62;
  page.drawRectangle({ x: bx, y: by, width: bw, height: bh, color: C.emerald });
  page.drawCircle({ x: bx + padX + 3, y: by + bh / 2, size: 3, color: C.white });
  drawText(page, badgeLabel, bx + padX + 10, by + 6, bs, fonts.bold, C.white, 1);

  return bandBottom;
}

function drawMeta(page: PDFPage, fonts: Fonts, yTop: number, username: string, id: string, date: Date): number {
  const leftX = M;
  const rightX = M + CONTENT_W / 2 + 14;
  const y = yTop;

  drawText(page, "BILLED TO", leftX, y, 8, fonts.bold, C.slate500, 1.5);
  page.drawLine({ start: { x: leftX, y: y - 6 }, end: { x: leftX + 28, y: y - 6 }, thickness: 1.5, color: C.emerald });
  drawText(page, username, leftX, y - 24, 13, fonts.bold, C.ink);
  drawText(page, "OpenSteam account holder", leftX, y - 40, 9.5, fonts.regular, C.slate500);

  drawText(page, "PAYMENT DETAILS", rightX, y, 8, fonts.bold, C.slate500, 1.5);
  page.drawLine({ start: { x: rightX, y: y - 6 }, end: { x: rightX + 28, y: y - 6 }, thickness: 1.5, color: C.emerald });

  const rowGap = 15;
  let ry = y - 22;
  const detail = (label: string, value: string) => {
    drawText(page, label, rightX, ry, 9, fonts.regular, C.slate500);
    drawRight(page, value, PAGE_W - M, ry, 9.5, fonts.bold, C.ink);
    ry -= rowGap;
  };
  detail("Method", "Pandabase Checkout");
  detail("Reference", id);
  detail("Issued", fmtDate(date));

  return Math.min(y - 40, ry) - 26;
}

function drawOrderTable(page: PDFPage, fonts: Fonts, yTop: number, planName: string, expirationDate: Date | null): number {
  const label = PLAN_LABELS[planName] ?? `${planName} Plan`;
  const pricing = PLAN_AMOUNTS[planName] ?? { amount: "—", cadence: "" };
  const validity = expirationDate ? fmtDate(expirationDate) : "Lifetime access";

  drawText(page, "ORDER SUMMARY", M, yTop, 9, fonts.bold, C.slate500, 1.5);

  const tableTop = yTop - 18;
  const headerH = 34;
  const rowH = 60;

  const col = { item: M + 20, access: M + 300, price: PAGE_W - M - 20 };

  page.drawRectangle({ x: M, y: tableTop - headerH, width: CONTENT_W, height: headerH, color: C.midnight });
  const headerTextY = tableTop - headerH + 12;
  drawText(page, "DESCRIPTION", col.item, headerTextY, 8, fonts.bold, C.cloud, 1);
  drawText(page, "ACCESS PERIOD", col.access, headerTextY, 8, fonts.bold, C.cloud, 1);
  drawRight(page, "AMOUNT", col.price, headerTextY, 8, fonts.bold, C.cloud, 1);

  const rowTop = tableTop - headerH;
  const rowBottom = rowTop - rowH;
  page.drawRectangle({ x: M, y: rowBottom, width: CONTENT_W, height: rowH, color: C.white, borderColor: C.slate200, borderWidth: 1 });

  const rowMid = rowBottom + rowH / 2;
  page.drawRectangle({ x: M, y: rowBottom + 10, width: 3, height: rowH - 20, color: C.emerald });
  drawText(page, label, col.item, rowMid + 6, 12.5, fonts.bold, C.ink);
  drawText(page, "OpenSteam platform subscription", col.item, rowMid - 12, 8.5, fonts.regular, C.slate500);
  drawText(page, validity, col.access, rowMid - 2, 10, fonts.regular, C.slate600);
  drawRight(page, pricing.amount, col.price, rowMid - 2, 12, fonts.bold, C.ink);

  const summaryTop = rowBottom - 14;
  const summaryRight = PAGE_W - M;
  const labelX = PAGE_W - M - 200;

  drawText(page, "Subtotal", labelX, summaryTop, 9.5, fonts.regular, C.slate500);
  drawRight(page, pricing.amount, summaryRight, summaryTop, 9.5, fonts.regular, C.ink);
  drawText(page, "Tax", labelX, summaryTop - 16, 9.5, fonts.regular, C.slate500);
  drawRight(page, "$0.00", summaryRight, summaryTop - 16, 9.5, fonts.regular, C.ink);

  const totalBoxTop = summaryTop - 34;
  const totalBoxH = 52;
  const totalBoxY = totalBoxTop - totalBoxH;
  const totalBoxX = labelX - 16;
  const totalBoxW = summaryRight - totalBoxX + 16;
  page.drawRectangle({ x: totalBoxX, y: totalBoxY, width: totalBoxW, height: totalBoxH, color: C.emeraldSoft, borderColor: C.emeraldLine, borderWidth: 1 });
  page.drawRectangle({ x: totalBoxX, y: totalBoxY, width: 3, height: totalBoxH, color: C.emerald });

  const totalMid = totalBoxY + totalBoxH / 2;
  drawText(page, "TOTAL PAID", totalBoxX + 16, totalMid + 3, 9, fonts.bold, C.emeraldDeep, 1);
  if (pricing.cadence) {
    drawText(page, pricing.cadence, totalBoxX + 16, totalMid - 12, 8, fonts.regular, C.slate500);
  }
  drawRight(page, pricing.amount, summaryRight - 4, totalMid - 4, 21, fonts.bold, C.emeraldDeep);

  return totalBoxY - 34;
}

function drawNotes(page: PDFPage, fonts: Fonts, yTop: number, planName: string) {
  const label = PLAN_LABELS[planName] ?? planName;

  page.drawLine({ start: { x: M, y: yTop + 14 }, end: { x: PAGE_W - M, y: yTop + 14 }, thickness: 0.75, color: C.slate200 });

  drawText(page, "Your plan is now active", M, yTop - 6, 12, fonts.bold, C.ink);
  page.drawText(
    t(`Thank you for choosing OpenSteam. Your ${label} is active and your upgraded limits are available immediately from the dashboard.`),
    { x: M, y: yTop - 24, size: 9.5, font: fonts.regular, color: C.slate600, maxWidth: CONTENT_W, lineHeight: 14 },
  );
  page.drawText(
    t("This document serves as an official receipt of payment processed securely through Pandabase. Please retain it for your records."),
    { x: M, y: yTop - 56, size: 9.5, font: fonts.regular, color: C.slate500, maxWidth: CONTENT_W, lineHeight: 14 },
  );
}

function drawFooter(page: PDFPage, fonts: Fonts) {
  const bandH = 56;
  page.drawRectangle({ x: 0, y: 0, width: PAGE_W, height: bandH, color: C.midnight });
  page.drawRectangle({ x: 0, y: bandH - 2, width: PAGE_W, height: 2, color: C.emerald });

  const midY = bandH / 2;
  drawText(page, "OPENSTEAM MANIFEST", M, midY + 2, 9, fonts.bold, C.white, 1);
  drawText(page, "Automated receipt - no signature required", M, midY - 12, 7.5, fonts.regular, C.slate500);
  drawRight(page, "support@opensteam.local", PAGE_W - M, midY + 2, 8.5, fonts.regular, C.cloud);
  drawRight(page, "opensteam.lol/support", PAGE_W - M, midY - 12, 8, fonts.regular, C.slate500);
}

export async function generateReceiptPdf(
  username: string,
  planName: string,
  date: Date,
  expirationDate: Date | null,
): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const fonts: Fonts = { regular, bold };

  const logoBytes = await getLogoBytes();
  const logo = logoBytes ? await doc.embedPng(logoBytes).catch(() => null) : null;

  const page = doc.addPage([PAGE_W, PAGE_H]);
  const id = receiptId(date);

  const bandBottom = drawHeader(page, fonts, logo, id, date);

  let y = bandBottom - 48;
  y = drawMeta(page, fonts, y, username, id, date);
  y = drawOrderTable(page, fonts, y, planName, expirationDate);
  drawNotes(page, fonts, y, planName);
  drawFooter(page, fonts);

  return Buffer.from(await doc.save());
}
