// TypeScript mirror of agents/shared/phone.py — keep the two in sync.
//
// Rules:
//   1. If raw starts with "+" → already international, strip non-digits, keep +
//   2. If raw (digits) starts with "00" → strip, prepend +
//   3. If raw (digits) starts with "0" → domestic trunk prefix, strip & prepend +defaultCountry
//   4. Else if raw starts with a known country code AND remainder is plausible → prepend +
//   5. Else prepend +defaultCountry

const KNOWN_CC = [
  "34", "41", "43", "44", "49",
  "51", "52", "53", "54", "55", "56", "57", "58",
  "502", "503", "504", "505", "506", "507",
  "591", "593", "595", "598",
].sort((a, b) => b.length - a.length);

export function normalizePhone(raw: string, defaultCountry = "49"): string {
  if (raw == null) throw new Error("Phone number is empty");
  const hadPlus = raw.trim().startsWith("+");
  let digits = raw.replace(/\D/g, "");
  if (!digits) throw new Error("Phone number contains no digits");

  if (hadPlus) {
    // Common user mistake: selecting "+49" in the dropdown AND typing the
    // national trunk 0 in the number field ("+49 0152…"). Strip the 0.
    digits = stripTrunkZeroAfterCC(digits, defaultCountry);
    return "+" + digits;
  }
  if (digits.startsWith("00")) return "+" + digits.slice(2);
  if (digits.startsWith("0")) return "+" + defaultCountry + digits.slice(1);

  for (const cc of KNOWN_CC) {
    if (digits.startsWith(cc) && digits.length - cc.length >= 6) {
      return "+" + digits;
    }
  }
  return "+" + defaultCountry + digits;
}

function stripTrunkZeroAfterCC(digits: string, defaultCountry: string): string {
  const candidates = Array.from(new Set([...KNOWN_CC, defaultCountry]))
    .sort((a, b) => b.length - a.length);
  for (const cc of candidates) {
    if (digits.startsWith(cc) && digits[cc.length] === "0" && digits.length - cc.length - 1 >= 6) {
      return cc + digits.slice(cc.length + 1);
    }
  }
  return digits;
}

export function isValidE164(phone: string): boolean {
  return /^\+\d{8,15}$/.test(phone || "");
}

export const COUNTRY_CODES: Array<{ code: string; label: string; flag: string }> = [
  { code: "+49", label: "Deutschland",  flag: "🇩🇪" },
  { code: "+34", label: "España",       flag: "🇪🇸" },
  { code: "+41", label: "Schweiz",      flag: "🇨🇭" },
  { code: "+43", label: "Österreich",   flag: "🇦🇹" },
  { code: "+52", label: "México",       flag: "🇲🇽" },
  { code: "+54", label: "Argentina",    flag: "🇦🇷" },
  { code: "+56", label: "Chile",        flag: "🇨🇱" },
  { code: "+57", label: "Colombia",     flag: "🇨🇴" },
  { code: "+51", label: "Perú",         flag: "🇵🇪" },
  { code: "+58", label: "Venezuela",    flag: "🇻🇪" },
  { code: "+593", label: "Ecuador",     flag: "🇪🇨" },
  { code: "+591", label: "Bolivia",     flag: "🇧🇴" },
  { code: "+595", label: "Paraguay",    flag: "🇵🇾" },
  { code: "+598", label: "Uruguay",     flag: "🇺🇾" },
];
