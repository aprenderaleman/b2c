"""
WhatsApp service — thin client over Evolution API v2.

Exposes the operations the agents need:

    * create_instance(name)
    * get_connection_state(name)     -> "open" | "connecting" | "close" | "unknown"
    * get_qr_base64(name)            -> returns a data-URL PNG of the QR
    * set_webhook(name, url)
    * send_text(name, to, text)      -> returns message id on success
    * is_number_on_whatsapp(name, to) -> bool

All methods raise WhatsAppError with a descriptive message on failure.
"""
from __future__ import annotations

import os
import re
import time
from dataclasses import dataclass
from typing import Any

import httpx
from dotenv import load_dotenv

load_dotenv(override=True)


class WhatsAppError(RuntimeError):
    pass


@dataclass(frozen=True)
class EvolutionConfig:
    base_url: str
    api_key: str

    @classmethod
    def from_env(cls) -> "EvolutionConfig":
        url = os.environ.get("EVOLUTION_API_URL", "http://localhost:8080").rstrip("/")
        key = os.environ.get("EVOLUTION_API_KEY")
        if not key:
            raise WhatsAppError("EVOLUTION_API_KEY is not set in environment")
        return cls(base_url=url, api_key=key)


class WhatsAppService:
    """
    Stateless client. Create once and reuse; it uses a connection pool internally.
    """

    def __init__(self, config: EvolutionConfig | None = None, timeout: float = 30.0):
        self.config = config or EvolutionConfig.from_env()
        self._client = httpx.Client(
            base_url=self.config.base_url,
            headers={"apikey": self.config.api_key},
            timeout=timeout,
        )

    # ──────────────────────────────────────────────────────────
    # Internals
    # ──────────────────────────────────────────────────────────

    def _request(self, method: str, path: str, **kw: Any) -> Any:
        resp = self._client.request(method, path, **kw)
        if resp.status_code >= 400:
            raise WhatsAppError(
                f"{method} {path} failed [{resp.status_code}]: {resp.text[:400]}"
            )
        if not resp.content:
            return None
        try:
            return resp.json()
        except ValueError:
            return resp.text

    # ──────────────────────────────────────────────────────────
    # Instance lifecycle
    # ──────────────────────────────────────────────────────────

    def list_instances(self) -> list[dict]:
        res = self._request("GET", "/instance/fetchInstances")
        return res if isinstance(res, list) else []

    def instance_exists(self, name: str) -> bool:
        for inst in self.list_instances():
            # v2 returns either {name: "..."} or {instance: {instanceName: ...}}
            n = inst.get("name") or inst.get("instanceName")
            if not n and isinstance(inst.get("instance"), dict):
                n = inst["instance"].get("instanceName")
            if n == name:
                return True
        return False

    def create_instance(self, name: str, webhook_url: str | None = None) -> dict:
        """
        Create a new WhatsApp instance (QR session). Idempotent — if already
        exists, returns the existing descriptor.
        """
        if self.instance_exists(name):
            return {"instanceName": name, "status": "exists"}

        body: dict[str, Any] = {
            "instanceName": name,
            "integration": "WHATSAPP-BAILEYS",
            "qrcode": True,
        }
        if webhook_url:
            body["webhook"] = {
                "url": webhook_url,
                "by_events": False,
                "events": [
                    "QRCODE_UPDATED",
                    "CONNECTION_UPDATE",
                    "MESSAGES_UPSERT",
                    "MESSAGES_UPDATE",
                ],
            }
        return self._request("POST", "/instance/create", json=body)

    def delete_instance(self, name: str) -> None:
        self._request("DELETE", f"/instance/delete/{name}")

    def get_connection_state(self, name: str) -> str:
        res = self._request("GET", f"/instance/connectionState/{name}")
        # v2 shape: { instance: { state: "open" | "connecting" | "close" } }
        if isinstance(res, dict):
            inst = res.get("instance") or {}
            state = inst.get("state") or res.get("state")
            if state:
                return state
        return "unknown"

    def get_qr_base64(self, name: str) -> str | None:
        """
        Return the QR as a base64 PNG data URL — displayable in browsers.
        Returns None once the instance is already connected.
        """
        try:
            res = self._request("GET", f"/instance/connect/{name}")
        except WhatsAppError:
            return None
        if not isinstance(res, dict):
            return None
        qr = res.get("base64") or res.get("qrcode") or res.get("code")
        if isinstance(qr, dict):
            qr = qr.get("base64") or qr.get("code")
        return qr

    def logout(self, name: str) -> None:
        self._request("DELETE", f"/instance/logout/{name}")

    def set_webhook(self, name: str, url: str) -> None:
        self._request(
            "POST",
            f"/webhook/set/{name}",
            json={
                "enabled": True,
                "url": url,
                "webhook_by_events": False,
                "events": [
                    "QRCODE_UPDATED",
                    "CONNECTION_UPDATE",
                    "MESSAGES_UPSERT",
                    "MESSAGES_UPDATE",
                ],
            },
        )

    # ──────────────────────────────────────────────────────────
    # Messaging
    # ──────────────────────────────────────────────────────────

    def _to_jid(self, phone_e164: str) -> str:
        """Evolution expects a bare number (no +) or a full jid 'xxx@s.whatsapp.net'."""
        return re.sub(r"\D", "", phone_e164)

    def send_text(
        self,
        name: str,
        to_e164: str,
        text: str,
        *,
        kind:    str = "manual",
        lead_id: str | None = None,
    ) -> str:
        """
        Send a WhatsApp text message. Returns the Evolution message id on success.
        Raises WhatsAppError otherwise.

        On TRANSIENT failures (Evolution disconnected, http_503, network)
        the message is also pushed to `outbound_queue` so the scheduler
        worker retries it with exponential backoff. The exception is still
        raised so the immediate caller knows the inline send didn't work,
        but the lead won't be left without their message.

        Uses the Evolution v1.8 shape: {number, options, textMessage:{text}}.
        """
        payload = {
            "number": self._to_jid(to_e164),
            "options": {
                "delay": 1200,
                "presence": "composing",
                "linkPreview": False,
            },
            "textMessage": {"text": text},
        }
        try:
            res = self._request("POST", f"/message/sendText/{name}", json=payload)
        except WhatsAppError as e:
            self._maybe_enqueue_for_retry(to_e164, text, kind, lead_id, str(e))
            raise
        if isinstance(res, dict):
            key = res.get("key") or {}
            return key.get("id") or res.get("messageId") or "sent"
        return "sent"

    @staticmethod
    def _maybe_enqueue_for_retry(
        phone:   str,
        body:    str,
        kind:    str,
        lead_id: str | None,
        error:   str,
    ) -> None:
        """Best-effort enqueue. Imported lazily to avoid a hard module dep
        when running scripts that don't need DB access."""
        try:
            from agents.shared.outbound_queue import enqueue_for_retry
            enqueue_for_retry(
                phone_e164=phone, body=body, kind=kind,
                lead_id=lead_id, error=error,
            )
        except Exception:                           # noqa: BLE001
            # Worst case the retry just doesn't happen — the caller still
            # logs the original failure to the lead timeline so we don't
            # silently lose visibility.
            pass

    def is_number_on_whatsapp(self, name: str, to_e164: str) -> bool:
        numbers = [self._to_jid(to_e164)]
        res = self._request(
            "POST",
            f"/chat/whatsappNumbers/{name}",
            json={"numbers": numbers},
        )
        if isinstance(res, list) and res:
            first = res[0] or {}
            return bool(first.get("exists"))
        return False

    # ──────────────────────────────────────────────────────────
    # Helpers
    # ──────────────────────────────────────────────────────────

    def wait_for_connection(self, name: str, timeout_seconds: int = 180) -> str:
        """Poll connection state until 'open' or timeout. Returns final state."""
        deadline = time.time() + timeout_seconds
        while time.time() < deadline:
            state = self.get_connection_state(name)
            if state == "open":
                return state
            time.sleep(2)
        return self.get_connection_state(name)
