"""T5.4 — Playbook canonical-action shim (ADAPTED-PLAN.md Phase 5).

Owner decision #6: thin adapter, no backend rewrite. This tool translates
NEW-style canonical platform actions inside playbook steps to the legacy
`SAFE_ACTIONS` names the SOAR engine already validates and executes. Old
playbooks keep working untouched; new-style steps are only accepted when a
canonical name maps 1:1 onto an existing safe action.

Mapping (canonical -> legacy SAFE_ACTIONS):
    ticket.create     -> create_ticket   (title/priority params compatible)
    notify.send       -> notify          (channel/message)
    evidence.add      -> add_evidence    (name)
    asset.query       -> snmp_query      (target)
    host.snapshot     -> snapshot        (target)
    network.block_ip  -> block_ip        (ip)         [consequential]
    endpoint.isolate  -> isolate_host    (hostname)   [consequential]
    case.create       -> create_ticket   (alias used by native_actions)

Anything unmapped is reported as unsupported — never silently rewritten.

Usage (DRY-RUN BY DEFAULT per plan):
    python backend/tools/playbook_action_shim.py                 # audit all playbooks in DB? NO —
    python backend/tools/playbook_action_shim.py file.json       # dry-run a steps JSON file
    python backend/tools/playbook_action_shim.py --apply file.json  # emit translated JSON

Exit codes: 0 = nothing to change / translation clean, 1 = unmapped actions
found (file left untouched), 2 = usage/parse error.
"""
from __future__ import annotations

import argparse
import json
import sys
from typing import Any, Dict, List, Tuple

# canonical -> (legacy, {param rename})
CANONICAL_TO_LEGACY: Dict[str, Tuple[str, Dict[str, str]]] = {
    "ticket.create": ("create_ticket", {}),
    "notify.send": ("notify", {}),
    "evidence.add": ("add_evidence", {}),
    "asset.query": ("snmp_query", {}),
    "host.snapshot": ("snapshot", {}),
    "network.block_ip": ("block_ip", {}),
    "endpoint.isolate": ("isolate_host", {}),
    "case.create": ("create_ticket", {"summary": "title"}),
}

# Legacy actions that remain valid as-is (kept in sync with soar.SAFE_ACTIONS).
LEGACY_OK = {
    "wait", "notify", "create_ticket", "add_evidence",
    "snmp_query", "snapshot", "block_ip", "isolate_host",
}


def translate_step(step: Dict[str, Any]) -> Tuple[Dict[str, Any], List[str]]:
    """Return (translated_step, notes). Unmapped actions raise ValueError."""
    action = (step.get("action") or "").strip()
    if action in LEGACY_OK:
        return step, []
    mapping = CANONICAL_TO_LEGACY.get(action)
    if mapping is None:
        raise ValueError(f"unmapped canonical action {action!r}")
    legacy, param_renames = mapping
    params = dict(step.get("params") or {})
    for old, new in param_renames.items():
        if old in params:
            params[new] = params.pop(old)
    out = {**step, "action": legacy, "params": params}
    note = f"{action} -> {legacy}" + (f" (params {param_renames})" if param_renames else "")
    return out, [note]


def translate_steps(steps: List[Dict[str, Any]]) -> Tuple[List[Dict[str, Any]], List[str], List[str]]:
    """Returns (new_steps, notes, errors). Errors non-empty => caller must NOT apply."""
    out: List[Dict[str, Any]] = []
    notes: List[str] = []
    errors: List[str] = []
    for i, s in enumerate(steps, start=1):
        try:
            ns, n = translate_step(s)
        except ValueError as e:
            errors.append(f"step {i}: {e}")
            continue
        out.append(ns)
        notes.extend(f"step {i}: {x}" for x in n)
    return out, notes, errors


def main(argv: List[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("file", help="JSON file: either a list of steps or {\"steps\": [...]}")
    ap.add_argument("--apply", action="store_true",
                    help="write translated JSON back to <file>.translated.json (default: dry-run report only)")
    args = ap.parse_args(argv)

    try:
        with open(args.file) as fh:
            data = json.load(fh)
    except (OSError, json.JSONDecodeError) as e:
        print(f"error: cannot read {args.file}: {e}", file=sys.stderr)
        return 2

    steps = data.get("steps") if isinstance(data, dict) else data
    if not isinstance(steps, list):
        print('error: expected a JSON array of steps or {"steps": [...]}', file=sys.stderr)
        return 2

    new_steps, notes, errors = translate_steps(steps)
    mode = "APPLY" if args.apply else "DRY-RUN"
    print(f"[{mode}] {args.file}: {len(steps)} steps")
    for n in notes:
        print(f"  translate: {n}")
    for e in errors:
        print(f"  UNSUPPORTED: {e}", file=sys.stderr)

    if errors:
        print("refusing to write: fix unsupported actions first (never silently dropped).",
              file=sys.stderr)
        return 1

    if args.apply and notes:
        out_path = args.file + ".translated.json"
        payload: Any = {"steps": new_steps} if isinstance(data, dict) else new_steps
        if isinstance(data, dict):
            payload = {**data, "steps": new_steps}
        with open(out_path, "w") as fh:
            json.dump(payload, fh, indent=2)
        print(f"wrote {out_path}")
    elif not notes:
        print("  (all steps already legacy-valid; nothing to translate)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
