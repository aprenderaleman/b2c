"""
Phone number normalization — single source of truth for the Python side.
The TypeScript funnel uses the equivalent implementation in web/lib/phone.ts.

Rules (per spec):
  1. Remove all non-digit characters.
  2. Remove leading 0 if present (domestic trunk prefix).
  3. If no country code detected, default to +49 (Germany).
  4. Store in E.164 format: +4915253409644
"""
from __future__ import annotations

import re

# Known country codes we might encounter from Spanish-speaking leads + DACH.
# Order matters — longer codes first so we don't match a prefix of a longer code.
#
# NOTE: we deliberately exclude "1" (US/CA). Its single-digit nature makes
# it ambiguous with German mobile numbers that start with 15/16/17 after
# stripping any prefix. This business only rarely sees US leads; in the rare
# case they appear, the funnel's country-code dropdown or the leading "+"
# will still produce the correct result.
KNOWN_COUNTRY_CODES: tuple[str, ...] = (
    "34",  # ES
    "41",  # CH
    "43",  # AT
    "44",  # UK
    "49",  # DE
    "51",  # PE
    "52",  # MX
    "53",  # CU
    "54",  # AR
    "55",  # BR
    "56",  # CL
    "57",  # CO
    "58",  # VE
    "502", "503", "504", "505", "506", "507",  # Central America
    "591", "593", "595", "598",                # BO, EC, PY, UY
)


def normalize_phone(raw: str, default_country: str = "49") -> str:
    """
    Normalize a phone number to E.164.

    Returns a string starting with '+' and containing only digits after it.
    Raises ValueError if the input contains no digits.

    Decision order:
      1. If the raw string had a '+' prefix -> the digits are already international.
      2. If starts with '00' -> international prefix, strip and keep as-is.
      3. If starts with a single '0' -> DOMESTIC trunk prefix -> strip and
         prepend default_country. We do NOT try to detect a country code in
         this case; the leading 0 is an unambiguous signal of a local number.
      4. Otherwise, if the digits already start with a known country code AND
         the remainder length is plausible -> treat as international.
      5. Fallback -> prepend default_country.
    """
    if raw is None:
        raise ValueError("Phone number is empty")

    had_plus = raw.strip().startswith("+")
    digits = re.sub(r"\D", "", raw)
    if not digits:
        raise ValueError("Phone number contains no digits")

    if had_plus:
        return "+" + digits

    if digits.startswith("00"):
        return "+" + digits[2:]

    if digits.startswith("0"):
        return "+" + default_country + digits[1:]

    if _starts_with_known_cc(digits):
        return "+" + digits

    return "+" + default_country + digits


def _starts_with_known_cc(digits: str) -> bool:
    # Sort descending by length so longer prefixes win.
    for cc in sorted(KNOWN_COUNTRY_CODES, key=len, reverse=True):
        if digits.startswith(cc):
            # Sanity: the full number after stripping cc must be at least 6 digits
            # to be plausible. Otherwise it's probably a domestic number that
            # coincidentally starts with a country-code prefix.
            if len(digits) - len(cc) >= 6:
                return True
    return False


def is_valid_e164(phone: str) -> bool:
    return bool(re.fullmatch(r"\+\d{8,15}", phone or ""))
