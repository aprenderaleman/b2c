# Sistema Profesor-Estudiante: Documento Maestro

> Documento de referencia tecnica para Aprender-Aleman.de B2C.
> Describe la relacion profesor-estudiante end-to-end: desde la conversion del lead hasta la baja.
> Actualizado: agosto 2026.

---

## 1. Ciclo de vida del estudiante

### 1.1 Conversion lead -> estudiante

El flujo de conversion se origina de dos formas:

**Conversion automatica (Stripe)** — archivo `web/lib/auto-conversion.ts`:
1. El lead paga via checkout de Stripe.
2. El webhook (`_shared.ts`) detecta `metadata.type === 'enrollment'` y llama a `handleFirstPayment()`.
3. Se lee la oferta de `ofertas_enviadas` (pack, ritmo, tipo de pago, importe).
4. Se llama a `convertLeadToStudent()` con `skipLegacyCommission: true`.
5. Se crea el usuario, el student, y el grupo 1:1 con el trial teacher.
6. Se actualiza el student: `clases_totales`, `clases_desbloqueadas`, `oferta_id`, `commission_window_end` (+6 meses), `stripe_customer_id`.
7. Se detecta el escenario de comision (E1/E2/E3) segun si hubo closer y si el lead asistio al trial.
8. En E1 (sin closer): se registra `bono_cierre` (50EUR fijo) + `comision` (% segun rango del teacher).
9. Se ejecuta `runPostConversionFlow()` (notificaciones, asignacion en E3).
10. Se cancelan las cadenas de seguimiento activas.

**Conversion manual** — archivo `web/lib/lead-conversion.ts`:
- Admin ejecuta la conversion desde `/admin/leads/[id]`.
- Mismo `convertLeadToStudent()` pero con `conversionSource: 'manual'`.
- El sistema legacy de comisiones esta DESACTIVADO (julio 2026).

### 1.2 Que se crea al convertir

| Entidad | Tabla | Detalles |
|---|---|---|
| Usuario | `users` | role='student', email, full_name, idioma, password temporal |
| Estudiante | `students` | Vinculado a user, con nivel, objetivo, subscription_type, classes_remaining |
| Grupo 1:1 | `groups` | type='individual', teacher asignado, student como miembro |
| Chat directo | `chats` | Auto-creado entre teacher y student |
| Entitlements | SCHULE + Hans | SSO automatico, `schule_access=true`, `hans_access=true` |

### 1.3 Estados del estudiante

El campo `students.subscription_status` tiene 4 valores:

| Estado | Significado |
|---|---|
| `active` | Estudiante activo con clases |
| `paused` | Pausado temporalmente (admin) |
| `cancelled` | Baja definitiva |
| `expired` | Pack agotado sin renovacion |

### 1.4 No existe

- **Reasignacion de profesor**: no hay flujo para cambiar el teacher asignado a un student. Se hace manualmente en BD.
- **Flujo de fin de programa**: cuando un student termina sus clases, no hay ceremonia automatica mas alla de la alerta de pack completado.
- **Auto-renovacion de pack**: el desbloqueo de clases en suscripcion se dispara por `invoice.paid` de Stripe, pero no hay logica de "programa completado -> renovar".

---

## 2. Gestion de clases

### 2.1 Creacion de clases

Archivo: `web/lib/classes.ts` — funcion `createClass()`.

**Quien puede crear clases:**
- **Teachers**: solo con sus propios estudiantes (via `/profesor/clases` o `StartNowButton`).
- **Admin**: con cualquier teacher/student, con `adminOverride: true` para saltarse el balance.
- **Students**: NO pueden crear ni cancelar clases.

**Input requerido** (`CreateClassInput`):
- `teacherId`, `studentIds[]`, `scheduledAt` (UTC), `durationMinutes` (default 50)
- `type`: `'individual'` | `'group'`
- `title`, `topic`, `notesAdmin` (opcionales)
- `recurrencePattern`: `'none'` | `'weekly'` | `'biweekly'`
- `recurrenceEndDate` (para series recurrentes)
- `isTrial` (boolean)

### 2.2 Room virtual

Cada clase obtiene un `livekit_room_id` (UUID) automaticamente al insertarse en BD. No se crea sala en LiveKit hasta que alguien se conecta.

### 2.3 Balance de clases

Archivo: `web/lib/class-balance.ts`.

`getClassBalance(studentId)` retorna:
- `total`: clases del programa completo
- `desbloqueadas`: pagadas hasta ahora
- `consumidas`: SUM(billed_hours) de clases kind='class'
- `agendadas`: clases futuras status='scheduled'
- `disponibles`: desbloqueadas - consumidas - agendadas

`canBookClass(studentId)`:
- Si `disponibles >= 1` -> permitido.
- Si proximo cobro Stripe < 5 dias -> grace period, permitido.
- Si legacy (sin `oferta_id`) -> bypass total (sin enforcement).
- Si admin -> permitido siempre.

### 2.4 Flujo de una clase

```
scheduled -> [15 min antes: sala se abre]
          -> teacher entra -> POST /api/aula/{id}/start -> status='live', started_at=now()
          -> clase transcurre (LiveKit)
          -> teacher termina -> POST /api/aula/{id}/end -> status='completed', ended_at=now()
          -> teacher confirma duracion real (actual_duration_minutes)
          -> trigger 047 calcula billed_hours y crea class_hours_log
          -> trigger rollup actualiza teacher_earnings del mes
```

### 2.5 Regla de facturacion: 50 min = 1 unidad

| Duracion real | Unidades facturadas |
|---|---|
| < 15 min | 0 |
| 15-75 min | 1 |
| 76-125 min | 2 |
| 126-175 min | 3 |

### 2.6 Cancelacion y ausencias

- **Cancelacion**: admin cambia `status='cancelled'`. Si es futura, devuelve 1 a `classes_remaining` (trigger 081).
- **Ausencia del student**: la clase igual cuenta como dada si el teacher estuvo. `class_participants.attended=false` pero `billed_hours` se factura.
- **Solo marking manual cuenta como asistencia** — la "completion" de clase por si sola no marca attendance.

### 2.7 Recurrencia

Clases recurrentes se crean como filas individuales en `classes` con `parent_class_id` apuntando a la primera. El patron (`weekly`/`biweekly`) genera todas las ocurrencias hasta `recurrenceEndDate` al momento de creacion.

---

## 3. Aula virtual (LiveKit)

### 3.1 Infraestructura

- **Servidor**: LiveKit self-hosted (env vars: `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`).
- **Graceful degradation**: si LiveKit no esta configurado, el UI muestra "Aula en preparacion" sin crashear.

### 3.2 Tokens

Archivo: `web/lib/livekit.ts` — `mintLivekitToken()`.

- TTL: 2 horas (para reconexiones durante clases de 50-60 min).
- Identity: `${userId}-${randomSuffix}` — permite multi-dispositivo (ej. telefono + laptop).
- Display name: `"${name} (PC)"` o `"${name} (movil)"` segun user-agent.
- Grants: todos publican audio/video/data. Solo el host (teacher) tiene `roomAdmin: true`.

### 3.3 Flujo de entrada

Ruta: `/aula/[id]` — `web/app/aula/[id]/page.tsx`.

1. **Autenticacion dual**: usuarios logueados (session) + leads de trial (cookie `aa_trial_session` o query `?t=<hmac>`).
2. **Ventana de acceso**: sala abre 15 min antes de `scheduled_at`, cierra a `scheduled_at + duration + 5 min`. Trials tienen 20 min de gracia extra.
3. **Deteccion WebView**: bloquea WhatsApp, Instagram, Facebook, TikTok in-app browsers. Muestra interstitial "abrir en Safari/Chrome".
4. **PreJoin**: preview de camara, seleccion de dispositivos (estilo Google Meet).
5. **Pausa iOS**: 400ms entre PreJoin y LiveKitRoom mount (Safari solo permite un `getUserMedia` por origen).
6. **Conexion**: GridLayout, FocusLayout (auto-focus en screen share), Chat, moderacion para host.

### 3.4 Moderacion del teacher

Endpoint: `POST /api/aula/{id}/moderate`.

Acciones disponibles (solo host):
- `mute_audio`, `mute_video`: silenciar participante.
- `kick`: expulsar participante.
- `end_class`: `deleteRoom()` + `status='completed'`.

### 3.5 Clase ad-hoc ("empezar ahora")

Endpoint: `POST /api/teacher/classes/start-now`.

El teacher puede iniciar una clase instantanea con un student. Crea la fila con `status='live'`, `started_at=NOW()` y envia notificacion in-app al student.

### 3.6 Manejo de errores

- **Error de conexion**: pantalla de error con boton "Reintentar" que re-fetcha el token.
- **Permisos de media denegados**: el user queda como espectador (solo audio receptor).
- **Desconexion**: teacher redirigido a flujo de end-class; student a `/estudiante`; lead a landing.
- **No hay fallback a otro proveedor de video.**

---

## 4. Grabaciones

### 4.1 Inicio automatico

Componente `RecordingAutoStart` en `AulaClient.tsx` — solo el host (teacher) dispara `POST /api/aula/{id}/recording/start` al montar el componente. Idempotente: verifica que no haya egress activo antes de iniciar.

### 4.2 Pipeline tecnico

```
LiveKit Egress (room composite, layout=speaker, MP4)
  -> S3-compatible storage (Cloudflare R2, bucket: aprender-aleman-recordings)
  -> Webhook /api/webhooks/livekit-egress
     -> INSERT recordings (status=processing)
     -> UPDATE recordings (status=ready, file_url, duration, size)
     -> Notificacion in-app a teacher + students
```

**S3 key pattern**: `classes/${classId}/${timestamp}.mp4`.

### 4.3 Acceso y playback

Ruta: `/grabacion/[id]` — `web/app/grabacion/[id]/page.tsx`.

- **URLs firmadas**: R2 presigned URLs con TTL de 6 horas. Si `R2_PUBLIC_DOMAIN` esta configurado, se reescribe el host para CDN edge caching.
- **Permisos** (`canViewRecording()`):
  - Superadmin: todo.
  - Admin: todo excepto grabaciones de trials.
  - Teacher: solo clases que enseno.
  - Student: solo clases en las que participo.
  - Trials: solo teacher asignado + superadmin.

### 4.4 Reconciliacion

Archivo: `web/lib/recordings-reconcile.ts`.

Safety net para grabaciones stuck en `processing`:
- Cron cada 15 minutos (Vercel cron via `vercel.json`).
- Tambien disponible como boton manual en `/admin/mantenimiento`.
- Consulta LiveKit API por cada `egress_id` pendiente y actualiza el estado.

### 4.5 Retencion

No hay politica de expiracion automatica. Las grabaciones persisten indefinidamente en R2 y en la BD. Existe `deleteRecordingObject()` para limpieza manual.

### 4.6 Grabaciones de contenido

Flag `classes.is_content_recording` (default false) — sesiones de grabacion solo del teacher para YouTube. Reutiliza todo el pipeline pero no factura horas.

---

## 5. Seguimiento pedagogico

### 5.1 Script de clase de prueba

Tabla: `trial_class_scripts` — archivo `web/lib/trial-script.ts`.

Wizard estructurado que el teacher completa durante/despues del trial:

| Campo | Proposito |
|---|---|
| `objetivo` | Meta del estudiante |
| `nivel_objetivo` | Nivel CEFR deseado |
| `deadline` | Fecha limite del estudiante |
| `motivacion` | Razon para aprender aleman |
| `feedback_clase` | Feedback del teacher sobre la clase |
| `enrollment_sense` | Probabilidad de inscripcion |
| `objection_reason/unblock` | Objeciones y respuestas |
| `presented_packs/chosen_pack` | Packs presentados y elegido |
| `teacher_notes` | Notas libres |
| `final_outcome` | attended/absent/converted |

Cuando el lead convierte, `teacher_notes` del script se propagan a las notas del student.

### 5.2 Notas de voz

Endpoint: `POST /api/teacher/trial/[leadId]/voice-note` — el teacher puede enviar notas de voz, registradas via `voice_note_sent_at`.

### 5.3 Barras de progreso por habilidad

Los teachers actualizan scores por habilidad (Sprechen, Horen, Lesen, Schreiben) en `/profesor/estudiantes/[id]`. El student ve estas barras en modo lectura en su dashboard.

### 5.4 Notas privadas del teacher

Timeline de notas por student en `/profesor/estudiantes/[id]`. Solo visibles para el teacher y admins; el student no las ve.

### 5.5 Tareas (Homework)

- Teacher asigna tareas desde la vista de clase.
- Student ve tareas en `/estudiante/tareas` con estados: Pendiente -> En revision -> Revisada.
- Upload de archivos o texto para entregas.

### 5.6 Lo que NO existe

- **Notas estructuradas por clase regular**: solo existe para trials. Las clases regulares solo tienen `notes_admin`.
- **Reportes de progreso mensuales**: no hay "informe mensual" generado para el student.
- **Tracking de ejercicios SCHULE**: no hay flujo de datos de vuelta de SCHULE a b2c.
- **"Garantia de Nivel"**: no existe en el codigo. La asistencia se trackea para alertas admin, no para un programa de garantia.

---

## 6. Herramientas del profesor

### 6.1 Portal `/profesor/` — paginas disponibles

| Ruta | Funcion |
|---|---|
| `/profesor` | Dashboard: proxima clase, Hans AI, SCHULE SSO, calendario |
| `/profesor/clases` | Lista de clases (1 ano atras, 6 meses adelante) + crear nueva |
| `/profesor/clases/[id]` | Detalle: asistencia, fin de clase, tareas, aula, grabaciones |
| `/profesor/clasedeprueba` | Hub de trials: script, payment link, notas, conversion |
| `/profesor/estudiantes` | Lista de students con nivel y clases restantes |
| `/profesor/estudiantes/[id]` | Detalle: progreso, notas privadas, start-now, certificados |
| `/profesor/grupos` | Grupos activos con miembros y documentos |
| `/profesor/ganancias` | Earnings: graficas SVG, tabla mensual, comisiones, rango |
| `/profesor/disponibilidad` | Editor de horarios semanales |
| `/profesor/materiales` | Presentaciones oficiales + biblioteca personal |
| `/profesor/recursos` | Biblioteca compartida entre teachers |
| `/profesor/grabaciones` | Todas las grabaciones (separadas: trial vs regular) |
| `/profesor/videos` | Estudio de grabacion para contenido YouTube |

### 6.2 Herramientas externas integradas

- **Hans AI** (`hans.aprender-aleman.de/lehrer`): asistente IA para preparacion de clases.
- **SCHULE** (`api-schule.aprender-aleman.de`): plataforma de ejercicios. El teacher entra como su alumno via SSO para ver materiales y asignar tareas.
- **Google Calendar**: sync via iCal URL.
- **Google Docs**: documento compartido por grupo para apuntes de clase (`document_url` en groups).

### 6.3 Ganancias y comisiones

La pagina `/profesor/ganancias` muestra:
- Tarjetas: earnings del mes, acumulado total, promedio mensual, horas totales, estado de pago.
- Grafica de barras SVG (6 meses): verde=pagado, brand=pendiente.
- Grafica de lineas SVG (6 meses): horas trabajadas.
- Tabla mensual detallada.
- Seccion de comisiones: badge del rango (Starter 5% / Pro 8% / Elite 12% / Master 15%), listado de comisiones del mes con base, porcentaje e importe.

### 6.4 Certificados

El teacher puede emitir certificados desde `/profesor/estudiantes/[id]` cuando el student tiene 0 clases restantes. Se genera PDF descargable.

---

## 7. Herramientas del estudiante

### 7.1 Portal `/estudiante/` — paginas disponibles

| Ruta | Funcion |
|---|---|
| `/estudiante` | Dashboard: proxima clase, live CTA, racha, progreso, plan |
| `/estudiante/clases` | Lista de clases con teacher y estado |
| `/estudiante/clases/[id]` | Detalle: aula, companeros, grabaciones, documento |
| `/estudiante/apuntes` | Redirect a Google Doc del grupo |
| `/estudiante/materiales` | Presentaciones oficiales + materiales del teacher |
| `/estudiante/biblioteca` | Recursos curados por teachers (filtro por nivel) |
| `/estudiante/grabaciones` | Grabaciones de clases propias |
| `/estudiante/tareas` | Homework: pendientes, en revision, revisadas |
| `/estudiante/certificados` | Certificados con descarga PDF |

### 7.2 Dashboard del estudiante

- Saludo personalizado.
- **LiveClassCta**: banner en tiempo real que pollcea cada 15s cuando hay clase en vivo.
- **ClassReviewPrompt**: prompt flotante para evaluar clase reciente (hasta 7 dias despues).
- Proxima clase con boton "entrar al aula".
- Link a Google Doc de apuntes.
- SCHULE + Hans (herramientas externas via SSO).
- **Racha de asistencia**: racha actual y mejor racha historica.
- Proximas 5 clases + ultimas 5.
- Barras de progreso (lectura).
- Info del plan: nivel, tipo de suscripcion, clases restantes.
- Sync de calendario (iCal).

### 7.3 Lo que el student NO puede hacer

- **No puede agendar clases** — solo teachers y admins crean clases.
- **No puede cancelar clases** — solo admins.
- **No puede ver facturas ni historial de pagos** — no hay seccion financiera.
- **No puede cambiar de profesor** — no existe el flujo.
- **No puede pausar su suscripcion** — solo admin.

---

## 8. Comunicacion

### 8.1 Chat in-platform

Tablas: `chats`, `chat_participants`, `messages`.

- **Tipos**: `direct` (1:1 teacher-student) y `group` (chat de clase grupal).
- **Auto-creacion**: `wireChatsForClass()` crea el chat automaticamente al agendar una clase.
- **Funcionalidades**: adjuntos (url, nombre, tamano, content_type), respuestas (`reply_to_message_id`), edicion, borrado suave, conteo de no-leidos por user.

### 8.2 WhatsApp (sistema -> lead/student, NO bidireccional)

Archivo: `web/lib/whatsapp.ts` — Evolution API (self-hosted).

Tipos de mensaje definidos en `message-catalog.ts`:
- Confirmacion y recordatorios de trial (2h, 24h, 15min, 30min, manana).
- Post-trial: seguimiento, inscripcion, ausencia.
- Welcome student, diagnostico drip (6 msgs), email-only nudge (5 msgs).
- Reactivacion masiva con PDF.

**Protecciones anti-ban**:
- Kill switch global (3 modos: off, partial, full).
- Night gate: 22:00-08:00 Berlin.
- Cap diario: 300 (warm-up progresivo post-ban).
- Rate limit: 15s minimo entre envios.
- Blocklist de numeros.
- Rotacion de instancias (v2/v3/v4).

### 8.3 Email

Archivo: `web/lib/email/send.ts` — Resend + SMTP con 3 reintentos.

30+ templates cubriendo todo el lifecycle:
- **Pre-conversion**: diagnostico welcome/followup/pdf, trial confirmation/reminder/rescheduled/cancelled/attended/absent.
- **Conversion**: welcome student, welcome platform.
- **Clases activas**: reminder 30min, morning summary, schedule summary, lifecycle (created/rescheduled/cancelled), group added.
- **Retention**: pack low balance (5 restantes), pack completed (0 restantes + feedback request).
- **Admin/staff**: daily digest, closer digest, lead urgente, teacher invoice paid, announcements, rank change, venta pendiente, welcome staff.

### 8.4 Notificaciones in-app

Archivo: `web/lib/notifications.ts`.

Sistema de campanita con tipos: `class_scheduled`, `class_reminder_30m`, `class_cancelled`, `class_updated`, `class_starting`, `recording_ready`, `homework_new`, `homework_reviewed`, `trial_assigned`, `student_converted`, `lead_new_urgent`, `generic`.

Opt-out por usuario (`users.notifications_opt_out`), prevencion de duplicados para reminders, badge de no-leidos.

---

## 9. Retencion, churn y deuda tecnica

### 9.1 Senales de riesgo

Archivo: `web/lib/reports.ts` — `computeRiskAlerts()`.

| Alerta | Severidad | Logica |
|---|---|---|
| `low_attendance` | warn | Asistencia < 70% en ultimos 30 dias (minimo 3 clases) |
| `two_absences` | danger | 2 ausencias consecutivas en clases mas recientes |
| `inactive_14d` | warn | Student activo sin login en 14+ dias |
| `no_classes` | — | Tipo definido pero sin implementacion |

Estas alertas aparecen en el daily digest del admin. **No se envian al student.**

### 9.2 Alertas de pack

Cron horario (`/api/cron/pack-alerts`):
- **5 clases restantes**: email + notificacion in-app ("contacta a Gelfis").
- **0 clases restantes**: email + notificacion ("completaste tu plan" + feedback request).
- Ambas dirigen al student a WhatsApp de Gelfis.

### 9.3 Flujo de baja (admin-only)

Endpoint: `POST /api/admin/students/[id]/deactivate`.

1. `users.active = false` (bloquea login).
2. `students.subscription_status = 'cancelled'`.
3. Clases futuras 1:1 -> `status='cancelled'`.
4. Student removido de rosters de clases grupales.
5. Teachers notificados via WhatsApp.
6. Admin note registrada.

**Reactivacion**: `users.active = true`, `subscription_status = 'active'`. NO recrea clases canceladas.

### 9.4 Lo que NO se detecta

- Student con clases restantes que no ha agendado nuevas.
- Student que no usa SCHULE/Hans.
- Caida de ritmo vs plan (ej. paga 8/mes pero solo toma 3).

### 9.5 Deuda tecnica identificada

| Area | Deuda | Impacto |
|---|---|---|
| Reasignacion de profesor | No existe flujo | Se hace con UPDATE manual en BD |
| Notas de clase regular | Solo `notes_admin` | Teacher no puede documentar cada sesion |
| Tracking SCHULE | Sin datos de vuelta | No se sabe si el student hace ejercicios |
| Garantia de nivel | No implementada | Feature comercial sin respaldo tecnico |
| `no_classes` risk alert | Tipo definido, sin codigo | Students inactivos no se detectan por falta de clases |
| Progreso mensual | No existe reporte | No hay visibilidad periodica para el student |
| Cancelacion self-service | No existe | El student no puede pausar/cancelar solo |
| Devolucion de saldo | Manual | `classes_remaining` no se ajusta automaticamente en baja |
| Notas de trial -> regular | Se copian una vez | No hay continuidad estructurada post-conversion |
| Chat grupal | Auto-creado pero poco promovido | El student ve el chat solo en el aula |

---

## Anexo: Tabla de archivos clave

| Archivo | Responsabilidad |
|---|---|
| `web/lib/auto-conversion.ts` | Motor de conversion automatica Stripe |
| `web/lib/lead-conversion.ts` | Conversion manual admin |
| `web/lib/commission-engine.ts` | Comisiones por rango + bono de cierre |
| `web/lib/classes.ts` | Creacion y gestion de clases |
| `web/lib/class-balance.ts` | Balance y enforcement de saldo |
| `web/lib/livekit.ts` | Token generation para aula |
| `web/app/aula/[id]/page.tsx` | Server component del aula |
| `web/app/aula/[id]/AulaClient.tsx` | Client component del aula (WebView, PreJoin, Room) |
| `web/lib/aula.ts` | Autorizacion de acceso + ventana temporal |
| `web/lib/r2.ts` | Firmado de URLs de grabacion (Cloudflare R2) |
| `web/lib/recordings-reconcile.ts` | Reconciliacion de grabaciones stuck |
| `web/lib/chat.ts` | Sistema de chat in-platform |
| `web/lib/whatsapp.ts` | Envio WhatsApp via Evolution API |
| `web/lib/email/send.ts` | Envio email (Resend/SMTP) |
| `web/lib/notifications.ts` | Notificaciones in-app |
| `web/lib/reports.ts` | Alertas de riesgo y asistencia |
| `web/lib/trial-script.ts` | Script estructurado de trial |
| `web/lib/entitlements.ts` | SSO a SCHULE y Hans |
| `web/lib/finance/teacher-invoice-pdf.ts` | Factura PDF con clases + comisiones |
| `db/migrations/010_classes.sql` | Schema de classes |
| `db/migrations/014_recordings.sql` | Schema de recordings |
| `db/migrations/047_auto_log_hours.sql` | Trigger de facturacion automatica |
| `db/migrations/081_auto_update_classes_remaining.sql` | Trigger de saldo |
| `db/migrations/096_fix_recompute.sql` | Fix de recompute_teacher_month |
| `db/migrations/097_bono_cierre.sql` | Bono de cierre + class_id nullable |
