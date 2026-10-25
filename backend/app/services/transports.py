"""Real notification transports: SMTP email, HTTP webhook, SMS (Twilio-compatible).

Everything is driven by per-tenant ChannelConfig rows (Settings > Notifications)
with global env fallbacks:

  Email  : SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASSWORD/SMTP_FROM or MAIL_* env
           (works out of the box with Mailcow / hMailServer / Gmail app password)
  Webhook: URL + optional shared secret -> HMAC-SHA256 signature header
           (works with n8n / Zapier / Make / Slack incoming webhooks)
  SMS    : Twilio REST API (account SID + auth token + from number) — any
           Twilio-compatible gateway also works.

If a channel has no configuration the dispatch records an honest failure in the
delivery diagnostics instead of pretending the message was sent.
"""
import os
import json
import hmac
import hashlib
import smtplib
import ssl
from email.message import EmailMessage

try:  # optional dependency; webhook/email still work without it
    import httpx
except ImportError:  # pragma: no cover
    httpx = None


def _cfg_get(cfg: dict | None, key: str, env: str = "", default: str = "") -> str:
    cfg = cfg or {}
    return str(cfg.get(key) or os.getenv(env) or default or "").strip()


# ---------------------------------------------------------------------------
# EMAIL (real SMTP)
# ---------------------------------------------------------------------------
def send_email(cfg: dict | None, recipient: str, subject: str, body: str = "") -> dict:
    host = _cfg_get(cfg, "smtp_host", "SMTP_HOST")
    port = int(_cfg_get(cfg, "smtp_port", "SMTP_PORT", "587") or 587)
    user = _cfg_get(cfg, "smtp_user", "SMTP_USER")
    password = _cfg_get(cfg, "smtp_password", "SMTP_PASSWORD")
    sender = _cfg_get(cfg, "from_address", "SMTP_FROM", user or "noreply@infravx.local")
    security = _cfg_get(cfg, "security", "SMTP_SECURITY", "starttls").lower()
    if not host:
        return {"ok": False, "error": "SMTP not configured (set smtp_host in Settings > Notifications > Email)"}

    msg = EmailMessage()
    msg["From"] = sender
    msg["To"] = recipient
    msg["Subject"] = subject
    msg.set_content(body or subject)

    try:
        ctx = ssl.create_default_context()
        if port == 465 or security == "ssl":
            server = smtplib.SMTP_SSL(host, port, context=ctx, timeout=15)
        else:
            server = smtplib.SMTP(host, port, timeout=15)
            if security == "starttls":
                server.starttls(context=ctx)
        if user:
            server.login(user, password)
        server.send_message(msg)
        server.quit()
        return {"ok": True, "transport": f"smtp://{host}:{port}"}
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "error": f"SMTP error: {exc}"}


# ---------------------------------------------------------------------------
# WEBHOOK (real HTTP POST, HMAC signed)
# ---------------------------------------------------------------------------
def send_webhook(cfg: dict | None, url_fallback_recipient: str, subject: str, payload: dict | None = None) -> dict:
    if httpx is None:
        return {"ok": False, "error": "httpx not installed on backend"}
    cfg = cfg or {}
    url = str(cfg.get("url") or url_fallback_recipient or "").strip()
    if not url.startswith("http"):
        return {"ok": False, "error": "Webhook URL missing/invalid"}
    secret = str(cfg.get("secret") or os.getenv("WEBHOOK_SECRET") or "")
    body = payload or {"event": "notification", "subject": subject}
    data = json.dumps(body, default=str).encode()
    headers = {"Content-Type": "application/json"}
    if secret:
        headers["X-INFRAVX-Signature"] = "sha256=" + hmac.new(secret.encode(), data, hashlib.sha256).hexdigest()
    try:
        resp = httpx.post(url, content=data, headers=headers, timeout=15)
        ok = 200 <= resp.status_code < 300
        return {"ok": ok, "status_code": resp.status_code,
                **({} if ok else {"error": f"HTTP {resp.status_code}: {resp.text[:200]}"})}
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "error": f"Webhook error: {exc}"}


# ---------------------------------------------------------------------------
# SMS (Twilio-compatible REST)
# ---------------------------------------------------------------------------
def send_sms(cfg: dict | None, to_number: str, message: str) -> dict:
    if httpx is None:
        return {"ok": False, "error": "httpx not installed on backend"}
    sid = _cfg_get(cfg, "twilio_account_sid", "TWILIO_ACCOUNT_SID")
    token = _cfg_get(cfg, "twilio_auth_token", "TWILIO_AUTH_TOKEN")
    frm = _cfg_get(cfg, "from_number", "TWILIO_FROM_NUMBER")
    base = _cfg_get(cfg, "api_base", "SMS_API_BASE", "https://api.twilio.com")
    if not (sid and token and frm):
        return {"ok": False, "error": "SMS not configured (account SID / auth token / from number)"}
    if not to_number:
        return {"ok": False, "error": "No destination phone number"}
    try:
        resp = httpx.post(
            f"{base.rstrip('/')}/2015-05-05/Accounts/{sid}/Messages.json",
            data={"To": to_number, "From": frm, "Body": message[:1600]},
            auth=(sid, token), timeout=15,
        )
        ok = 200 <= resp.status_code < 300
        return {"ok": ok, "transport": "twilio-compatible",
                **({} if ok else {"error": f"HTTP {resp.status_code}: {resp.text[:200]}"})}
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "error": f"SMS gateway error: {exc}"}


DISPATCHERS = {"email": send_email, "webhook": send_webhook, "sms": send_sms}
