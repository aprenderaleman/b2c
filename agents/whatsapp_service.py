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

    def send_text(self, name: str, to_e164: str, text: str) -> str:
        """
        Send a WhatsApp text message. Returns the Evolution message id on success.
        Raises WhatsAppError otherwise.

        Uses the Evolution v1.8 shape: {number, options, textMessage:{text}}.
        (v2.x used a flatter {number, text} shape but v1.8 is what works on our VPS.)
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
        res = self._request("POST", f"/message/sendText/{name}", json=payload)
        if isinstance(res, dict):
            key = res.get("key") or {}
            return key.get("id") or res.get("messageId") or "sent"
        return "sent"

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
