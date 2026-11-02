"""Provider package (T2.3/T2.4/T5.x).

Importing this package auto-discovers and imports every sibling module so the
`@register` decorators populate `base._REGISTRY`. Without this, the line
`from app.platform.connectors import providers as _` in app/platform/router.py
would be a no-op (namespace package with no eager import).
"""
from __future__ import annotations

import importlib
import pkgutil

for _mod in pkgutil.iter_modules(__path__):
    if _mod.name.startswith("_"):
        continue
    try:
        importlib.import_module(f"{__name__}.{_mod.name}")
    except Exception as _exc:  # never crash startup; log honestly
        import logging
        logging.getLogger(__name__).error("provider %s failed to import: %s", _mod.name, _exc)
