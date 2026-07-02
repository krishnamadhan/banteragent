import ExcelJS from "exceljs";
import { tmpdir } from "os";
import { join } from "path";
import type { ConstructionTx, Balance } from "./types.js";
import { fmt } from "./parse.js";

export async function generateReport(
  txs: ConstructionTx[],
  balance: Balance,
): Promise<string> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "BanterAgent Construction Tracker";
  wb.created = new Date();

  // ── Sheet 1: Summary ──────────────────────────────────────────────────────
  const sumSheet = wb.addWorksheet("Summary");
  sumSheet.columns = [
    { key: "label", width: 32 },
    { key: "value", width: 18 },
  ];
  const hdr = sumSheet.addRow({ label: "🏗️ Construction Fund Summary", value: "" });
  hdr.font = { bold: true, size: 13 };
  sumSheet.addRow({});

  const addRow = (label: string, value: string | number, bold = false, color?: string) => {
    const row = sumSheet.addRow({ label, value });
    if (bold) row.font = { bold: true };
    if (color) row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: color } };
    if (typeof value === "number") row.getCell("value").numFmt = '₹#,##0';
    return row;
  };

  addRow("Pool contributions (fund IN)",  balance.poolFunded,       true, "FFE2EFDA");
  addRow("Pool expenses (!add OUT)",       balance.poolSpent,        false);
  addRow("Pool balance",                   balance.poolBalance,      true, "FFD9E1F2");
  sumSheet.addRow({});
  addRow("External payments (by others)",  balance.externalPaid,     false, "FFFFF2CC");
  sumSheet.addRow({});
  addRow("Total project cost",             balance.totalProjectCost, true, "FFFCE4D6");
  sumSheet.addRow({});
  addRow("Report generated",               new Date().toLocaleString("en-IN"), false);

  // ── Sheet 2: Transactions ─────────────────────────────────────────────────
  // Three logical sections: Fund IN | Pool expenses (add) | External payments (contri)
  const txSheet = wb.addWorksheet("Transactions");
  txSheet.columns = [
    { header: "Date",        key: "date",   width: 12 },
    { header: "Type",        key: "type",   width: 18 },
    { header: "Amount",      key: "amount", width: 14 },
    { header: "Category",    key: "cat",    width: 18 },
    { header: "Description", key: "desc",   width: 36 },
    { header: "Person",      key: "person", width: 16 },
    { header: "Added by",    key: "by",     width: 14 },
  ];
  const hdrRow = txSheet.getRow(1);
  hdrRow.font = { bold: true, color: { argb: "FFFFFFFF" } };
  hdrRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF4472C4" } };

  const fundRows  = txs.filter(t => t.source === "fund");
  const addRows   = txs.filter(t => t.source === "add");
  const contriRows = txs.filter(t => t.source === "contri"); // both IN and OUT rows

  const writeSection = (rows: ConstructionTx[], label: string, color: string) => {
    if (!rows.length) return;
    const secHdr = txSheet.addRow({ date: label });
    secHdr.font = { bold: true };
    secHdr.fill = { type: "pattern", pattern: "solid", fgColor: { argb: color } };

    for (const tx of rows) {
      const typeLabel = tx.source === "fund" ? "Fund IN"
        : tx.source === "add" ? "Pool OUT"
        : tx.flow === "in" ? "External IN" : "External OUT";
      const row = txSheet.addRow({
        date:   tx.tx_date,
        type:   typeLabel,
        amount: Number(tx.amount),
        cat:    tx.category ?? "",
        desc:   tx.description ?? "",
        person: tx.person ?? "",
        by:     tx.added_by,
      });
      row.getCell("amount").numFmt = '₹#,##0';
      // Green for IN rows, red for OUT rows
      const isIn = tx.flow === "in";
      row.getCell("amount").font = { color: { argb: isIn ? "FF00B050" : "FFFF0000" } };
      row.getCell("type").font   = { color: { argb: isIn ? "FF00B050" : "FFFF0000" } };
    }
    txSheet.addRow({});
  };

  writeSection(fundRows,   "── Fund Contributions (Pool IN) ──", "FFE2EFDA");
  writeSection(addRows,    "── Pool Expenses (!add) ──",         "FFFCE4D6");
  writeSection(contriRows, "── External Payments (IN + OUT) ──", "FFFFF2CC");

  // ── Sheet 3: By Category ─────────────────────────────────────────────────
  const catSheet = wb.addWorksheet("By Category");
  catSheet.columns = [
    { header: "Category",    key: "cat",  width: 22 },
    { header: "Total Spent", key: "amt",  width: 16 },
    { header: "% of Total",  key: "pct",  width: 12 },
  ];
  catSheet.getRow(1).font = { bold: true };
  catSheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF4472C4" } };
  catSheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };

  const catEntries = Object.entries(balance.byCategory).sort((a, b) => b[1] - a[1]);
  for (const [cat, amt] of catEntries) {
    const pct = balance.totalProjectCost > 0 ? ((amt / balance.totalProjectCost) * 100).toFixed(1) + "%" : "0%";
    const row = catSheet.addRow({ cat, amt, pct });
    row.getCell("amt").numFmt = '₹#,##0';
  }
  catSheet.addRow({});
  const catTotalRow = catSheet.addRow({ cat: "TOTAL", amt: balance.totalProjectCost, pct: "100%" });
  catTotalRow.font = { bold: true };
  catTotalRow.getCell("amt").numFmt = '₹#,##0';

  // ── Sheet 4: Contributors ─────────────────────────────────────────────────
  const perSheet = wb.addWorksheet("Contributors");
  perSheet.columns = [
    { header: "Person",       key: "person", width: 22 },
    { header: "Type",         key: "type",   width: 16 },
    { header: "Amount",       key: "amt",    width: 16 },
  ];
  perSheet.getRow(1).font = { bold: true };
  perSheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF4472C4" } };
  perSheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };

  // Pool contributors
  for (const [person, amt] of Object.entries(balance.byPerson).sort((a, b) => b[1] - a[1])) {
    const row = perSheet.addRow({ person, type: "Fund contribution", amt });
    row.getCell("amt").numFmt = '₹#,##0';
  }
  // External contributors (unique contri persons + their total)
  const extByPerson: Record<string, number> = {};
  for (const tx of contriRows) {
    if (tx.person) extByPerson[tx.person] = (extByPerson[tx.person] ?? 0) + Number(tx.amount);
  }
  for (const [person, amt] of Object.entries(extByPerson).sort((a, b) => b[1] - a[1])) {
    const row = perSheet.addRow({ person, type: "External payment", amt });
    row.getCell("amt").numFmt = '₹#,##0';
    row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF2CC" } };
  }

  const outPath = join(tmpdir(), `construction_report_${Date.now()}.xlsx`);
  await wb.xlsx.writeFile(outPath);
  return outPath;
}
