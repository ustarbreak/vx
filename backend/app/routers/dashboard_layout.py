"""Dashboard layout persistence API.

Stores each user's customizable widget arrangement (order / width / collapse)
per dashboard page, so the "Overview & Live Proof" and every other widgetized
page survives logout, browser changes and device switches. The frontend
WidgetLayoutProvider hydrates from GET and debounce-saves through PUT;
localStorage remains a fast offline cache.

Scoping: rows are keyed by (user_id, page_key) and always filtered by the
caller's own identity — one user can never read or write another tenant's
layout. `org_id` is denormalised onto the row for admin auditing.
"""
import re

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.core.security import get_current_user
from app.models import User, DashboardLayout

router = APIRouter(prefix="/dashboard", tags=["Dashboard Layout"])

# page_key comes from the frontend (e.g. "client-admin-dashboard"); keep it
# tight to avoid junk rows / injection into stored JSON keys.
PAGE_KEY_RE = re.compile(r"^[a-z0-9][a-z0-9\-_/]{0,63}$")

MAX_WIDGETS = 64


class LayoutEntry(BaseModel):
    id: str = Field(min_length=1, max_length=80)
    colSpan: int = Field(default=1, ge=1, le=3)
    collapsed: bool = False
    # Free pixel height set by edge-resizing the widget (optional).
    heightPx: int | None = Field(default=None, ge=80, le=4000)


class LayoutPut(BaseModel):
    layout: list[LayoutEntry] = Field(max_length=MAX_WIDGETS)
    # Catalogue (`cat-*`) widget ids the user explicitly added on this page.
    added_catalog: list[str] = Field(default_factory=list, max_length=MAX_WIDGETS)
    # Free-flow visual order of widget ids (drag & drop arrangement).
    order: list[str] = Field(default_factory=list, max_length=MAX_WIDGETS * 2)


def _check_page_key(page_key: str) -> None:
    if not PAGE_KEY_RE.match(page_key):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                            f"Invalid page key '{page_key}'")


def _normalize_doc(stored) -> dict:
    """Return the response shape for a stored layout document.

    New rows store an envelope object {layout, added_catalog, order}; legacy
    rows stored a bare list of entries — both are accepted here so no data
    migration is required.
    """
    if isinstance(stored, list):
        return {"layout": stored, "added_catalog": [], "order": []}
    if isinstance(stored, dict):
        return {
            "layout": stored.get("layout") or [],
            "added_catalog": stored.get("added_catalog") or [],
            "order": stored.get("order") or [],
        }
    return {"layout": [], "added_catalog": [], "order": []}


async def _get_row(db: AsyncSession, user: User, page_key: str) -> DashboardLayout | None:
    res = await db.execute(
        select(DashboardLayout).where(
            DashboardLayout.user_id == user.id,
            DashboardLayout.page_key == page_key,
        )
    )
    return res.scalar_one_or_none()


@router.get("/layout/{page_key}")
async def get_dashboard_layout(
    page_key: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Return the saved widget layout for this user & page (404 → use defaults)."""
    _check_page_key(page_key)
    row = await _get_row(db, current_user, page_key)
    if row is None:
        # Honest "never saved yet" state — the frontend falls back to the
        # page default layout (and localStorage cache) on 404.
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No saved layout for this page yet")
    return {"page_key": page_key, "updated_at": row.updated_at, **_normalize_doc(row.layout)}


@router.put("/layout/{page_key}")
async def put_dashboard_layout(
    page_key: str,
    payload: LayoutPut,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Upsert the widget layout (called debounced by the frontend on any change)."""
    _check_page_key(page_key)
    entries = [e.model_dump(exclude_none=True) for e in payload.layout]
    # Store everything in the single JSON column as an envelope object; older
    # rows saved a bare list, which GET/PUT below still accept transparently.
    doc = {
        "layout": entries,
        "added_catalog": list(dict.fromkeys(payload.added_catalog)),
        "order": list(dict.fromkeys(payload.order)),
    }
    row = await _get_row(db, current_user, page_key)
    if row is None:
        row = DashboardLayout(user_id=current_user.id, org_id=current_user.org_id,
                              page_key=page_key, layout=doc)
        db.add(row)
    else:
        row.layout = doc
        row.org_id = current_user.org_id  # keep denormalised tenant in sync
    await db.commit()
    await db.refresh(row)
    return {"page_key": page_key, **_normalize_doc(row.layout)}


@router.delete("/layout/{page_key}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_dashboard_layout(
    page_key: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Reset: drop the saved layout so the page falls back to its defaults."""
    _check_page_key(page_key)
    row = await _get_row(db, current_user, page_key)
    if row is not None:
        await db.delete(row)
        await db.commit()
    return None
