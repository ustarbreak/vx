"""T5.2 — EICAR first-success test script (safe by design).

Writes the standard EICAR test signature (43 bytes, harmless, industry
test string recognized by AV engines incl. Wazuh/ClamAV/Rspamd) into a
DEDICATED temp dir, prints what to check in each engine, then deletes it.
It NEVER leaves the file on disk after the run and NEVER touches real data.

Usage (from repo root):
    python backend/tools/eicar_first_success.py            # create + instructions + cleanup
    python backend/tools/eicar_first_success.py --keep     # leave file for manual scan window

Expected results (first-success milestones, brief §first-success):
  * Wazuh   : active-response/syscheck or ClamAV integration raises an alert within ~60 s
              -> check: bash deploy/wazuh/verify.sh ; dashboard > Security events
  * Rspamd  : if attached to mail flow, scanning a message containing the string
              scores it as virus (~+500) -> check: curl $RSPAMD_URL/stats
  * ClamAV  : `clamdscan <file>` returns FOUND immediately (if deployed)
  * Velociraptor (roadmap): artifact Windows.EventLogs.Evtx or file hunt finds it

No network calls, no DB writes; exit code always 0 (this is a guide tool).
"""
from __future__ import annotations

import argparse
import os
import sys
import tempfile

# Canonical EICAR test file (one line, 68 chars incl. CRLF convention aside).
EICAR = "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*"


def main() -> int:
    ap = argparse.ArgumentParser(description="EICAR first-success helper (T5.2)")
    ap.add_argument("--keep", action="store_true",
                    help="do not delete the test file after printing instructions")
    args = ap.parse_args()

    d = os.environ.get("EICAR_DIR") or tempfile.mkdtemp(prefix="eicar-test-")
    path = os.path.join(d, "eicar.com.txt")
    with open(path, "w", encoding="ascii", newline="\r\n") as f:
        f.write(EICAR + "\r\n")
    size = os.path.getsize(path)
    print(f"[ok] wrote EICAR test signature ({size} bytes) -> {path}")
    print("[ok] this string is the harmless industry-standard AV test signature.")
    print()
    print("Check these engines now (read-only steps):")
    print("  1. Wazuh:  bash deploy/wazuh/verify.sh   then look for a new security event")
    print("             naming eicar.com.txt / virus signature (allow up to 60 s).")
    print("  2. ClamAV: clamdscan --no-summary " + path + "   (expect: FOUND)")
    print("  3. Rspamd: attach to mail flow and scan an email carrying this string;")
    print("             expect a high 'virus' score in /stats.")
    print("  4. DFIR-IRIS: if detected, open a case via POST /api/platform/actions")
    print("             {\"service\":\"incident-response\",\"action\":\"case.create\",...} (dry_run first).")
    print()
    if args.keep:
        print(f"[kept] file remains at {path} — DELETE IT MANUALLY when done.")
    else:
        os.remove(path)
        try:
            os.rmdir(d)
        except OSError:
            pass
        print("[ok] cleaned up: test file removed (nothing left on disk).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
