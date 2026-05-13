import ExcelJS from "exceljs";
import { parse } from "csv-parse/sync";
import { normalizeBrazilianPhone } from "@/lib/phone";

export type ImportedContact = {
  name: string | null;
  phone: string;
  raw_data: Record<string, unknown>;
};

export type ContactsImportResult = {
  contacts: ImportedContact[];
  totalRows: number;
  importedRows: number;
  invalidRows: number;
  duplicateRows: number;
};

type Row = Record<string, unknown>;

const nameFields = ["nome", "name", "cliente", "lead", "contato"];
const phoneFields = ["telefone", "phone", "celular", "whatsapp", "numero", "número"];

export async function parseContactsFile(file: File): Promise<ContactsImportResult> {
  const extension = file.name.split(".").pop()?.toLowerCase();
  const bytes = Buffer.from(await file.arrayBuffer());

  if (extension === "csv") {
    const content = bytes.toString("utf8");
    const rows = parse(content, {
      columns: true,
      skip_empty_lines: true,
      bom: true,
      trim: true
    }) as Row[];

    return normalizeRows(rows);
  }

  if (extension === "xlsx" || extension === "xls") {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(bytes as never);
    const sheet = workbook.worksheets[0];

    if (!sheet) {
      return {
        contacts: [],
        totalRows: 0,
        importedRows: 0,
        invalidRows: 0,
        duplicateRows: 0
      };
    }

    const headers = getWorksheetHeaders(sheet);
    const rows: Row[] = [];

    sheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) {
        return;
      }

      const data: Row = {};
      headers.forEach((header, index) => {
        data[header] = row.getCell(index + 1).text.trim();
      });
      rows.push(data);
    });

    return normalizeRows(rows);
  }

  throw new Error("Formato de planilha nao suportado. Envie CSV ou XLSX.");
}

export function parseManualContactsText(value: string): ContactsImportResult {
  const rows = value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const phoneCandidate = findPhoneInText(line);
      const name = phoneCandidate
        ? line
            .replace(phoneCandidate.original, "")
            .replace(/[;,|\-]+/g, " ")
            .replace(/\s+/g, " ")
            .trim()
        : "";

      return {
        nome: name || null,
        telefone: phoneCandidate?.original ?? line,
        linha_original: line
      };
    });

  return normalizeRows(rows);
}

function getWorksheetHeaders(sheet: ExcelJS.Worksheet) {
  const headerRow = sheet.getRow(1);
  const headers: string[] = [];

  headerRow.eachCell((cell, colNumber) => {
    const value = cell.text.trim();
    headers[colNumber - 1] = value || `coluna_${colNumber}`;
  });

  return headers;
}

function normalizeRows(rows: Row[]) {
  const uniquePhones = new Set<string>();
  const contacts: ImportedContact[] = [];
  let invalidRows = 0;
  let duplicateRows = 0;

  for (const row of rows) {
    const name = pickField(row, nameFields);
    const phoneValue = pickField(row, phoneFields) ?? findPhoneLikeValue(row);
    const phone = normalizeBrazilianPhone(phoneValue);

    if (!phone) {
      invalidRows += 1;
      continue;
    }

    if (uniquePhones.has(phone)) {
      duplicateRows += 1;
      continue;
    }

    uniquePhones.add(phone);
    contacts.push({
      name: name ? String(name).trim() : null,
      phone,
      raw_data: row
    });
  }

  return {
    contacts,
    totalRows: rows.length,
    importedRows: contacts.length,
    invalidRows,
    duplicateRows
  };
}

function pickField(row: Row, candidates: string[]) {
  const entries = Object.entries(row);

  for (const candidate of candidates) {
    const found = entries.find(([key]) => normalizeKey(key) === normalizeKey(candidate));
    if (found?.[1]) {
      return found[1];
    }
  }

  return null;
}

function findPhoneLikeValue(row: Row) {
  return Object.values(row).find((value) => {
    const digits = String(value ?? "").replace(/\D/g, "");
    return digits.length >= 10 && digits.length <= 13;
  });
}

function findPhoneInText(value: string) {
  const match = value.match(/(?:\+?55\s*)?(?:\(?0?\d{2}\)?\s*)?9?\d{4}[-\s]?\d{4}/);

  if (!match?.[0]) {
    return null;
  }

  return { original: match[0] };
}

function normalizeKey(value: string) {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();
}
