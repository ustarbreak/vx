import pytest
from types import SimpleNamespace
from decimal import Decimal
from app.routers.usage import _period, _scope, UsageEventIn


def test_usage_period_bounds_are_month_scoped():
    start, end = _period("2026-11")
    assert start.isoformat().startswith("2026-11-01")
    assert end.isoformat().startswith("2026-12-01")


@pytest.mark.parametrize("period", ["2026-00", "2026-13", "Nov-2026", "202611"])
def test_usage_period_rejects_invalid_values(period):
    with pytest.raises(Exception) as exc:
        _period(period)
    assert getattr(exc.value, "status_code", None) == 400


def test_usage_scope_rejects_cross_tenant_access():
    with pytest.raises(Exception) as exc:
        _scope(SimpleNamespace(role="client_admin", org_id=4), 5)
    assert getattr(exc.value, "status_code", None) == 403


def test_platform_admin_must_choose_tenant_for_usage():
    with pytest.raises(Exception) as exc:
        _scope(SimpleNamespace(role="platform_admin", org_id=None), None)
    assert getattr(exc.value, "status_code", None) == 400


def test_usage_event_requires_idempotency_and_positive_quantity():
    body = UsageEventIn(org_id=4, metric="siem_gb", quantity=Decimal("1.5"),
                        source="opensearch-meter", idempotency_key="daily-2026-11-06")
    assert body.quantity == Decimal("1.5")
    with pytest.raises(Exception):
        UsageEventIn(org_id=4, metric="siem_gb", quantity=Decimal("0"),
                     source="opensearch-meter", idempotency_key="daily-2026-11-06")
