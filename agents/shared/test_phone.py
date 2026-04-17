"""
Quick sanity checks for phone.normalize_phone.
Run:  python -m agents.shared.test_phone
"""
from agents.shared.phone import normalize_phone, is_valid_e164


CASES: list[tuple[str, str]] = [
    # (input, expected)
    ("+49 152 5340 9644",         "+4915253409644"),
    ("0049 152 5340 9644",        "+4915253409644"),
    ("015253409644",              "+4915253409644"),   # German domestic w/ trunk 0
    ("15253409644",               "+4915253409644"),   # no code, no leading 0 -> default DE
    ("+34 612 345 678",           "+34612345678"),
    ("0034-612-345-678",          "+34612345678"),
    ("+52 55 1234 5678",          "+525512345678"),
    ("(+41) 79 123 45 67",        "+41791234567"),
    ("  +49-152-5340-9644  ",     "+4915253409644"),
]


def main() -> None:
    failed = 0
    for raw, expected in CASES:
        got = normalize_phone(raw)
        ok = got == expected and is_valid_e164(got)
        mark = "OK " if ok else "FAIL"
        print(f"  {mark}  {raw!r:40} -> {got!r}  (expected {expected!r})")
        if not ok:
            failed += 1

    if failed:
        print(f"\n{failed} test(s) failed")
        raise SystemExit(1)
    print(f"\nAll {len(CASES)} tests passed.")


if __name__ == "__main__":
    main()
