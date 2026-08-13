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

    # Blocklist global: números que NUNCA reciben WhatsApps automáticos.
    # Caso 2026-05-30: Gelfis pidió cortar todo a +491607530948
    # (recibía daily-digest, send-fail alerts, silent-inbound, etc).
    # Comparamos por dígitos (ignora +, espacios) para ser robustos.
    #
    # La lista se fusiona con `system_config.whatsapp_blocklist_phones`
    # (CSV) para permitir añadir números nuevos sin redeploy. Lo
    # leemos cada llamada (no cacheado) para que el bloqueo aplique
    # en cuestión de segundos al cambiar el config.
    _BLOCKLIST_DIGITS_HARDCODED = frozenset({
        "491607530948",
    })

    @classmethod
    def _blocklist_digits(cls) -> frozenset[str]:
        extra: set[str] = set()
        try:
            # Import lazy para evitar dependencia dura del módulo
            # whatsapp_service en agents.shared cuando se usa en
            # scripts sueltos / tests.
            from agents.shared.db import get_config
            raw = get_config("whatsapp_blocklist_phones") or ""
            for piece in raw.split(","):
                digits = re.sub(r"\D", "", piece)
                if digits:
                    extra.add(digits)
        except Exception:
            pass
        return cls._BLOCKLIST_DIGITS_HARDCODED | frozenset(extra)

    @classmethod
    def _is_blocklisted(cls, to_e164: str | None) -> bool:
        if not to_e164:
            return False
        digits = re.sub(r"\D", "", to_e164)
        return digits in cls._blocklist_digits()

    # Whitelist de kinds que sí pasan cuando system_config.whatsapp_disabled
    # está en modo "partial". Coincide con la lista del TypeScript
    # (web/lib/whatsapp.ts). Cuando el flag está en modo "full" ningún
    # envío pasa, ni siquiera estos.
    _ALLOWED_KINDS_PARTIAL = frozenset({
        "trial_confirmation",
        "trial_reminder_24h",
        "trial_reminder_15m",
        "trial_reminder_morning",
        # Eliminados 2026-08-01: trial_reminder_2h (fusionado en morning),
        # trial_reminder_30m (redundante con 15m).
        "trial_attended_initial",
        "trial_inscription_initial",
        "trial_absent_initial",
        "trial_cancelled",
        # ACKs de respuesta cuando el lead escribe CONFIRMO/CAMBIAR/CANCELAR
        # al T+0. Sin estos, Stiv NO responde a las respuestas del lead
        # (Gelfis 2026-07-08: Hassan y Aisa quedaron sin ACK).
        "trial_confirm_ack",
        "trial_reschedule_link",
        # Follow-up único del reagendamiento iniciado por el profesor
        # (fu1 +8h eliminado 2026-08-01)
        "trial_teacher_reschedule_fu2",  # +24h sin rebook (único)
        # WhatsApp de bienvenida al convertir un lead en estudiante
        # (Gelfis 2026-07-15: Ángela quedó sin welcome porque el kind
        # no estaba en la lista → kill switch la silenció).
        "welcome_student",
        # Flujo absent-interest (Gelfis 2026-07-16): pregunta al lead
        # ausente si sigue interesado antes de mandarle el link.
        "trial_absent_interest_yes",   # respuesta SÍ → link a /agendar/cuando
        "trial_absent_interest_close", # respuesta NO → cierre amable
        # Funnel /sesion-plan (Gelfis 2026-08-14)
        "sesion_confirmation",
        "sesion_reminder_24h",
        "sesion_reminder_morning",
        "sesion_reminder_15m",
        "sesion_confirm_ack",
        "sesion_closer_booked",
        "sesion_closer_pre_15m",
        "admin_manual",
    })

    # Anti-ban #1: gate nocturno 22:00-08:00 Europe/Berlin.
    # Exentos: recordatorios inminentes (T-30m/T-15m — legítimos a cualquier hora).
    _NIGHT_EXEMPT_KINDS = frozenset({
        "trial_reminder_30m",
        "trial_reminder_15m",
    })

    @staticmethod
    def _is_berlin_night() -> bool:
        # Aproximación sin tzdata: UTC + offset Berlin. Verano=+2, invierno=+1.
        # No hace falta precisión sub-hora: solo comparamos si la hora local
        # está en [22, 24) ∪ [0, 8).
        try:
            from datetime import datetime, timezone
            now_utc = datetime.now(timezone.utc)
            month = now_utc.month
            # DST activo aprox marzo-octubre (aproximación).
            offset = 2 if 3 <= month <= 10 else 1
            hour_berlin = (now_utc.hour + offset) % 24
            return hour_berlin >= 22 or hour_berlin < 8
        except Exception:
            return False

    @staticmethod
    def _night_gate_enabled() -> bool:
        try:
            from agents.shared.db import get_config
            raw = get_config("wa_night_gate_enabled")
            return raw != "false"
        except Exception:
            return True

    # Anti-ban #2: cap diario. Cache 60s. Cuenta sends WA de hoy Berlin.
    @staticmethod
    def _daily_cap_state() -> tuple[int, int]:
        """Returns (limit, sent_today). Si cap alcanzado, solo kinds transaccionales pasan."""
        now = time.time()
        cache = getattr(WhatsAppService, "_daily_cap_cache", None)
        if cache and now - cache[2] < 60:
            return cache[0], cache[1]
        try:
            from agents.shared.db import get_config, get_conn
            base_cap = int(get_config("wa_daily_send_cap") or "300")
            warmup_raw = get_config("wa_warmup_day") or ""
            effective = base_cap
            try:
                wd = int(warmup_raw)
                if 1 <= wd <= 3:   effective = min(effective, 30)
                elif 4 <= wd <= 7: effective = min(effective, 100)
            except (ValueError, TypeError):
                pass
            # Contar sends de hoy Berlin (aproximación: últimas 30h contando desde
            # medianoche Berlin UTC hoy — margen para DST y drift).
            with get_conn() as conn, conn.cursor() as cur:
                cur.execute("""
                    SELECT COUNT(*) FROM lead_timeline
                     WHERE type = 'system_message_sent'
                       AND metadata->>'channel' = 'whatsapp'
                       AND timestamp >= (date_trunc('day', now() AT TIME ZONE 'Europe/Berlin') AT TIME ZONE 'Europe/Berlin')
                """)
                row = cur.fetchone()
                sent = row["count"] if isinstance(row, dict) else row[0]
            setattr(WhatsAppService, "_daily_cap_cache", (effective, sent, now))
            return effective, sent
        except Exception:
            return 300, 0

    @staticmethod
    def _wa_disabled_mode() -> str:
        """Lee system_config.whatsapp_disabled:
          - "true"/"1"/true → "full"  (bloquea TODO)
          - "partial"       → "partial" (solo kinds en whitelist)
          - otro / None     → "off"    (sistema normal)
        Cacheado 30s por proceso para no martillar BD.
        """
        now = time.time()
        cache = getattr(WhatsAppService, "_wa_disabled_cache", None)
        if cache and now - cache[1] < 30:
            return cache[0]
        try:
            from agents.shared.db import get_config
            raw = get_config("whatsapp_disabled")
        except Exception:
            raw = None
        if raw in ("partial",):
            mode = "partial"
        elif raw in (True, "true", "1"):
            mode = "full"
        else:
            mode = "off"
        setattr(WhatsAppService, "_wa_disabled_cache", (mode, now))
        return mode

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
        # Blocklist check — antes de cualquier I/O. Devolvemos un id
        # sintético para no romper callers que asumen un string non-empty,
        # pero NINGÚN mensaje sale por el cable.
        if self._is_blocklisted(to_e164):
            import logging
            logging.getLogger("whatsapp_service").warning(
                "[blocklist] mensaje suprimido para %s (kind=%s, lead=%s)",
                to_e164, kind, lead_id,
            )
            return "blocklisted"

        # Kill switch global. Antes que nada: si el flag está on, no
        # tocamos Evolution — evita seguir generando errores 500 que
        # inflaman el alerta de janitor "sends están fallando".
        mode = self._wa_disabled_mode()
        if mode != "off":
            if not (mode == "partial" and kind in self._ALLOWED_KINDS_PARTIAL):
                import logging
                logging.getLogger("whatsapp_service").info(
                    "[wa-disabled] mensaje suprimido (mode=%s kind=%s lead=%s)",
                    mode, kind, lead_id,
                )
                return "whatsapp_globally_disabled"

        # Anti-ban gate nocturno (22:00-08:00 Berlin, salvo T-30m/T-15m).
        if self._is_berlin_night() and self._night_gate_enabled():
            if kind not in self._NIGHT_EXEMPT_KINDS:
                import logging
                logging.getLogger("whatsapp_service").info(
                    "[night-gate] mensaje suprimido (kind=%s lead=%s)", kind, lead_id,
                )
                return "night_gate"

        # Anti-ban cap diario. Solo kinds del whitelist pasan tras el cap.
        cap, sent_today = self._daily_cap_state()
        if sent_today >= cap and kind not in self._ALLOWED_KINDS_PARTIAL:
            import logging
            logging.getLogger("whatsapp_service").warning(
                "[daily-cap] mensaje suprimido cap=%d sent=%d kind=%s", cap, sent_today, kind,
            )
            return "daily_cap_reached"

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
            # Si esta llamada VIENE del drainer (kind="retry"), la fila YA
            # está en outbound_queue y el drainer va a actualizar attempts
            # vía _requeue. Volver a llamar enqueue_for_retry creaba una
            # fila nueva por cada fallo → loop infinito que llenó la queue
            # con 225k filas el 2026-05-02 (ver _drain_queue.py de
            # cleanup). Solo enqueamos cuando el origen NO es retry.
            if kind != "retry":
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

    def send_document(
        self,
        name: str,
        to_e164: str,
        media_url: str,
        file_name: str,
        *,
        caption: str = "",
        kind:    str = "manual",
        lead_id: str | None = None,
    ) -> str:
        """
        Envía un documento (PDF, doc, etc.) por WhatsApp via Evolution.

        Evolution API endpoint /message/sendMedia/{instance}. Acepta
        media via URL (servidor descarga). Mimetype: application/pdf.

        Returns Evolution message id on success. Raises WhatsAppError otherwise.
        """
        # Blocklist check — antes de cualquier I/O. Mismo patrón que send_text.
        if self._is_blocklisted(to_e164):
            import logging
            logging.getLogger("whatsapp_service").warning(
                "[blocklist] documento suprimido para %s (kind=%s, lead=%s, file=%s)",
                to_e164, kind, lead_id, file_name,
            )
            return "blocklisted"
        # Kill switch global — no distinguimos partial vs full para media;
        # ningún kind de la whitelist envía documentos.
        if self._wa_disabled_mode() != "off":
            import logging
            logging.getLogger("whatsapp_service").info(
                "[wa-disabled] documento suprimido (kind=%s lead=%s file=%s)",
                kind, lead_id, file_name,
            )
            return "whatsapp_globally_disabled"
        payload = {
            "number": self._to_jid(to_e164),
            "options": {"delay": 1200, "presence": "composing"},
            "mediaMessage": {
                "mediatype": "document",
                "mimetype":  "application/pdf",
                "fileName":  file_name,
                "media":     media_url,
                "caption":   caption,
            },
        }
        try:
            res = self._request("POST", f"/message/sendMedia/{name}", json=payload)
        except WhatsAppError as e:
            # Para documentos no usamos la cola de retry de texto (la cola
            # asume text body). Loguamos y dejamos que el caller decida.
            log.warning("send_document failed: %s", e)
            raise
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
