export function normalizeBrazilianPhone(value: unknown) {
  let digits = String(value ?? "").replace(/\D/g, "");

  if (!digits) {
    return null;
  }

  digits = digits.replace(/^0+/, "");

  if (digits.startsWith("55") && digits.length >= 12 && digits.length <= 13) {
    return digits;
  }

  if (digits.length === 10 || digits.length === 11) {
    return `55${digits}`;
  }

  if (digits.length > 11 && !digits.startsWith("55")) {
    return `55${digits.slice(-11)}`;
  }

  return null;
}
