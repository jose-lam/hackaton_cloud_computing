import json
import os
import time
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any, Dict, List, Optional, Tuple

import boto3
from boto3.dynamodb.conditions import Key
from botocore.exceptions import ClientError

# Clientes AWS globales (reutilizados entre ejecuciones warm)
dynamodb = boto3.resource("dynamodb")
ssm_client = boto3.client("ssm")
sns_client = boto3.client("sns")

TABLA_OPERACIONES = os.environ.get("TABLA_OPERACIONES", "TeleCorp_Operaciones")
TABLA_VENTANAS = os.environ.get("TABLA_VENTANAS", "TeleCorp_VentanasZonales")
SSM_SNS_TOPIC_PARAM = os.environ.get("SSM_SNS_TOPIC_PARAM", "/telecorp/sns/topic_arn")
ENABLE_DIRECT_SMS = os.environ.get("ENABLE_DIRECT_SMS", "false").lower() == "true"

tabla_operaciones = dynamodb.Table(TABLA_OPERACIONES)
tabla_ventanas = dynamodb.Table(TABLA_VENTANAS)

# Caché en memoria para parámetros SSM (60 segundos)
_SSM_CACHE: Dict[str, Tuple[str, float]] = {}
_CACHE_TTL_SECONDS = 60.0

VALID_MILESTONES = {
    "EN_EVALUACION",
    "INCIDENCIA_IDENTIFICADA",
    "SERVICIO_RESTABLECIDO",
}

STATUS_TO_MILESTONE = {
    "En revisión": "EN_EVALUACION",
    "Siendo atendida": "INCIDENCIA_IDENTIFICADA",
    "Solucionada": "SERVICIO_RESTABLECIDO",
    "Cerrada": "SERVICIO_RESTABLECIDO",
}


def _decimal_to_native(obj: Any) -> Any:
    if isinstance(obj, list):
        return [_decimal_to_native(i) for i in obj]
    if isinstance(obj, dict):
        return {k: _decimal_to_native(v) for k, v in obj.items()}
    if isinstance(obj, Decimal):
        return int(obj) if obj % 1 == 0 else float(obj)
    return obj


def _now_utc_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%fZ")


def _get_sns_topic_arn() -> Optional[str]:
    now = time.time()
    cached = _SSM_CACHE.get(SSM_SNS_TOPIC_PARAM)
    if cached and (now - cached[1]) < _CACHE_TTL_SECONDS:
        return cached[0] or None

    try:
        resp = ssm_client.get_parameter(Name=SSM_SNS_TOPIC_PARAM, WithDecryption=True)
        value = (resp.get("Parameter", {}).get("Value") or "").strip()
        if not value or value.startswith("PENDIENTE"):
            _SSM_CACHE[SSM_SNS_TOPIC_PARAM] = ("", now)
            return None
        _SSM_CACHE[SSM_SNS_TOPIC_PARAM] = (value, now)
        return value
    except ClientError as exc:
        print(f"[WARN] No se pudo leer SSM {SSM_SNS_TOPIC_PARAM}: {exc}")
        return None


def _extract_context(event: Dict[str, Any]) -> Dict[str, Any]:
    """
    Normaliza payloads provenientes de:
      1. AWS Step Functions (TeleCorpSentinelWorkflow -> NotificarUsuariosAfectados)
      2. Amazon EventBridge (incidente.solucionado / colectivo.detectado)
      3. Invocaciones directas de prueba CLI
    """
    base = dict(event.get("detail") or event)

    # Aplanar posibles salidas anidadas de estados previos en Step Functions
    for nested_key in ("enrich_result", "recurrence_result", "Payload"):
        nested = base.get(nested_key)
        if isinstance(nested, dict):
            for k, v in nested.items():
                if k not in base or base[k] in (None, "", []):
                    base[k] = v

    raw_milestone = (base.get("milestone") or "").strip().upper()
    raw_status = (base.get("new_status") or base.get("status") or "").strip()

    if raw_milestone in VALID_MILESTONES:
        milestone = raw_milestone
    elif raw_status in STATUS_TO_MILESTONE:
        milestone = STATUS_TO_MILESTONE[raw_status]
    else:
        milestone = "INCIDENCIA_IDENTIFICADA"

    return {
        "incident_id": (base.get("incident_id") or base.get("master_incident_id") or "").strip(),
        "ticket_id": (base.get("ticket_id") or "").strip(),
        "geohash": (base.get("geohash") or "").strip(),
        "zone_name": (base.get("zone_name") or "").strip(),
        "milestone": milestone,
        "status": raw_status,
        "priority_level": (base.get("priority_level") or "ALTA").strip(),
        "priority_score": base.get("priority_score"),
        "ai_diagnosis": (base.get("ai_diagnosis") or base.get("ai_executive_diagnosis") or "").strip(),
        "ai_category": (base.get("ai_category") or base.get("normalized_category") or "").strip(),
        "critical_pois": base.get("critical_pois") or [],
        "antenna_id": (base.get("antenna_id") or "").strip(),
        "resolution_note": (base.get("note") or "").strip(),
        "changed_by": (base.get("changed_by") or "SISTEMA_SFN").strip(),
    }


def _get_incident_meta(incident_id: str) -> Dict[str, Any]:
    if not incident_id:
        return {}
    try:
        resp = tabla_operaciones.get_item(
            Key={"PK": f"INCIDENT#{incident_id}", "SK": "META"}
        )
        return _decimal_to_native(resp.get("Item") or {})
    except ClientError as exc:
        print(f"[WARN] Error consultando INCIDENT#{incident_id}: {exc}")
        return {}


def _get_ticket_meta(ticket_id: str) -> Optional[Dict[str, Any]]:
    if not ticket_id:
        return None
    try:
        resp = tabla_operaciones.get_item(
            Key={"PK": f"TICKET#{ticket_id}", "SK": "META"}
        )
        item = resp.get("Item")
        return _decimal_to_native(item) if item else None
    except ClientError as exc:
        print(f"[WARN] Error consultando TICKET#{ticket_id}: {exc}")
        return None


def _find_affected_tickets(
    incident_id: str, geohash: str, single_ticket_id: str
) -> List[Dict[str, Any]]:
    """
    Obtiene todos los tickets afectados por el incidente en la zona usando GSI1_ZonaEstado.
    """
    tickets_by_id: Dict[str, Dict[str, Any]] = {}

    if geohash:
        try:
            query_kwargs = {
                "IndexName": "GSI1_ZonaEstado",
                "KeyConditionExpression": Key("GSI1PK").eq(f"ZONA#{geohash}")
                & Key("GSI1SK").begins_with("TS#"),
            }
            while True:
                resp = tabla_operaciones.query(**query_kwargs)
                for raw_item in resp.get("Items", []):
                    item = _decimal_to_native(raw_item)
                    pk = item.get("PK", "")
                    if not pk.startswith("TICKET#"):
                        continue
                    t_id = item.get("ticket_id") or pk.replace("TICKET#", "", 1)
                    master_id = item.get("master_incident_id") or ""
                    t_status = item.get("status") or ""

                    # Incluir tickets vinculados al incidente o activos recientes en la misma zona
                    if incident_id and master_id == incident_id:
                        tickets_by_id[t_id] = item
                    elif not master_id and t_status in ("Registrada", "En revisión", "Siendo atendida"):
                        tickets_by_id[t_id] = item

                last_key = resp.get("LastEvaluatedKey")
                if not last_key:
                    break
                query_kwargs["ExclusiveStartKey"] = last_key
        except ClientError as exc:
            print(f"[WARN] Error consultando GSI1_ZonaEstado para ZONA#{geohash}: {exc}")

    if single_ticket_id and single_ticket_id not in tickets_by_id:
        single_item = _get_ticket_meta(single_ticket_id)
        if single_item:
            tickets_by_id[single_ticket_id] = single_item

    return list(tickets_by_id.values())


def _propagate_resolution_if_needed(
    incident_id: str,
    tickets: List[Dict[str, Any]],
    resolution_note: str,
    changed_by: str,
    now_iso: str,
) -> None:
    """
    Cuando el hito es SERVICIO_RESTABLECIDO, asegura que el Incidente Maestro
    y todos sus tickets hermanos queden cerrados/solucionados con auditoría.
    """
    note_text = resolution_note or "Servicio restablecido y verificado por operaciones."

    if incident_id:
        try:
            tabla_operaciones.update_item(
                Key={"PK": f"INCIDENT#{incident_id}", "SK": "META"},
                UpdateExpression=(
                    "SET #st = :sol, GSI1PK = :inactive, closed_at = if_not_exists(closed_at, :ts), "
                    "updated_at = :ts"
                ),
                ExpressionAttributeNames={"#st": "status"},
                ExpressionAttributeValues={
                    ":sol": "Solucionada",
                    ":inactive": "ACTIVE#false",
                    ":ts": now_iso,
                },
            )
        except ClientError as exc:
            print(f"[WARN] No se pudo actualizar estado cerrado en INCIDENT#{incident_id}: {exc}")

    for ticket in tickets:
        t_id = ticket.get("ticket_id")
        old_status = ticket.get("status") or "Siendo atendida"
        if not t_id or old_status in ("Solucionada", "Cerrada"):
            continue
        try:
            tabla_operaciones.update_item(
                Key={"PK": f"TICKET#{t_id}", "SK": "META"},
                UpdateExpression="SET #st = :sol, updated_at = :ts",
                ExpressionAttributeNames={"#st": "status"},
                ExpressionAttributeValues={":sol": "Solucionada", ":ts": now_iso},
            )
            tabla_operaciones.put_item(
                Item={
                    "PK": f"TICKET#{t_id}",
                    "SK": f"HIST#{now_iso}",
                    "GSI1PK": f"USER#{ticket.get('user_id', 'UNKNOWN')}",
                    "GSI1SK": f"TS#{now_iso}",
                    "ticket_id": t_id,
                    "old_status": old_status,
                    "new_status": "Solucionada",
                    "changed_by": changed_by,
                    "note": note_text,
                    "timestamp": now_iso,
                }
            )
        except ClientError as exc:
            print(f"[WARN] Error propagando cierre a TICKET#{t_id}: {exc}")


def _build_messages(
    ctx: Dict[str, Any], tickets: List[Dict[str, Any]]
) -> Tuple[str, str, str]:
    """
    Construye (subject <= 95 chars, email_body, sms_body <= 160 chars)
    acorde al estado exacto del incidente requerido por Red TeleCorp.
    """
    milestone = ctx["milestone"]
    incident_id = ctx["incident_id"] or ctx["ticket_id"] or "INC-ZONA"
    geohash = ctx["geohash"] or "N/A"
    zone_label = ctx["zone_name"] or f"Sector {geohash}"
    priority = ctx["priority_level"] or "ALTA"

    pois = ctx.get("critical_pois") or []
    poi_names = [p.get("name") for p in pois if isinstance(p, dict) and p.get("name")]
    poi_line = (
        f"- Infraestructura crítica cercana: {', '.join(poi_names[:3])}\n"
        if poi_names
        else ""
    )

    ticket_refs = [
        f"{t.get('ticket_id')} ({t.get('service_number') or t.get('user_id')})"
        for t in tickets[:15]
        if t.get("ticket_id")
    ]
    tickets_summary = ", ".join(ticket_refs) if ticket_refs else "Reporte zonal registrado"

    if milestone == "EN_EVALUACION":
        raw_subject = f"[Red TeleCorp] Evaluando inconveniente en {zone_label} ({incident_id})"
        headline = "SU REPORTE ESTÁ SIENDO EVALUADO POR NUESTRO EQUIPO TÉCNICO"
        detail_msg = (
            "Hemos recibido su reporte y estamos correlacionando las métricas de nuestra "
            "red en su sector para determinar el alcance del inconveniente."
        )
        sms_body = (
            f"Red TeleCorp: Evaluamos su reporte en {zone_label} (Ref: {incident_id}). "
            f"Le informaremos el diagnostico pronto."
        )
    elif milestone == "SERVICIO_RESTABLECIDO":
        raw_subject = f"[Red TeleCorp] Servicio restablecido en {zone_label} ({incident_id})"
        headline = "EL SERVICIO HA SIDO RESTABLECIDO EN SU ZONA"
        resolution = ctx["resolution_note"] or "Parámetros de tráfico y señal normalizados."
        detail_msg = (
            f"Nuestro equipo de operaciones ha concluido las labores técnicas y el servicio "
            f"en su sector vuelve a operar con normalidad.\n- Acción realizada: {resolution}"
        )
        sms_body = (
            f"Red TeleCorp: El servicio en {zone_label} ({incident_id}) ha sido restablecido. "
            f"Gracias por su comprension."
        )
    else:  # INCIDENCIA_IDENTIFICADA
        raw_subject = f"[Red TeleCorp] Incidencia confirmada en {zone_label} [{priority}]"
        headline = "SE HA IDENTIFICADO UNA INCIDENCIA ACTIVA EN SU ZONA"
        diagnosis = (
            ctx["ai_diagnosis"]
            or "Afectación zonal detectada por correlación de reportes ciudadanos y telemetría de red."
        )
        detail_msg = (
            f"Confirmamos una afectación generalizada en su sector. Nuestras cuadrillas "
            f"especializadas ya han sido asignadas con prioridad {priority}.\n"
            f"- Diagnóstico operativo: {diagnosis}"
        )
        sms_body = (
            f"Red TeleCorp: Detectamos incidencia {priority} en {zone_label} ({incident_id}). "
            f"Cuadrillas tecnicas atendiendo."
        )

    # AWS SNS exige estrictamente Subject <= 100 caracteres sin saltos de línea
    subject = raw_subject.replace("\n", " ")[:95]

    email_body = (
        f"Estimado(a) cliente de Red TeleCorp,\n\n"
        f"{headline}\n"
        f"====================================================================\n"
        f"{detail_msg}\n\n"
        f"Detalles del seguimiento:\n"
        f"- Código de Incidente: {incident_id}\n"
        f"- Zona / Geohash: {zone_label} ({geohash})\n"
        f"- Nivel de Prioridad: {priority}\n"
        f"{poi_line}"
        f"- Tickets cubiertos ({len(tickets)}): {tickets_summary}\n\n"
        f"Puede consultar la evolución completa en tiempo real desde el Portal de Incidencias "
        f"de Red TeleCorp.\n\n"
        f"Atentamente,\n"
        f"Centro de Operaciones de Red (NOC) — Red TeleCorp Sentinel AI\n"
        f"(Notificación automatizada enviada vía Amazon SNS)"
    )

    return subject, email_body, sms_body[:160]


def _publish_notifications(
    topic_arn: Optional[str],
    subject: str,
    email_body: str,
    sms_body: str,
    tickets: List[Dict[str, Any]],
    ctx: Dict[str, Any],
) -> Tuple[str, str, Dict[str, str]]:
    """
    Publica el correo vía Amazon SNS Topic y gestiona el envío/simulación SMS.
    Retorna: (sns_message_id, email_delivery_status, sms_status_by_phone)
    """
    sns_message_id = f"sim-sns-{int(time.time() * 1000)}"
    email_status = "SIMULATED_NO_SNS_TOPIC"

    if topic_arn:
        try:
            resp = sns_client.publish(
                TopicArn=topic_arn,
                Subject=subject,
                Message=email_body,
                MessageAttributes={
                    "geohash": {
                        "DataType": "String",
                        "StringValue": ctx["geohash"] or "UNKNOWN",
                    },
                    "milestone": {
                        "DataType": "String",
                        "StringValue": ctx["milestone"],
                    },
                    "priority_level": {
                        "DataType": "String",
                        "StringValue": ctx["priority_level"] or "ALTA",
                    },
                },
            )
            sns_message_id = resp.get("MessageId", sns_message_id)
            email_status = "SENT_SNS"
        except ClientError as exc:
            print(f"[ERROR] Fallo al publicar en SNS Topic {topic_arn}: {exc}")
            email_status = f"FAILED_SNS:{exc.response['Error']['Code']}"

    # Envío o registro de SMS por teléfono único afectado
    unique_phones = {
        (t.get("phone") or "").strip()
        for t in tickets
        if (t.get("phone") or "").strip()
    }
    sms_status_by_phone: Dict[str, str] = {}

    for phone in unique_phones:
        if ENABLE_DIRECT_SMS and phone.startswith("+"):
            try:
                sms_resp = sns_client.publish(
                    PhoneNumber=phone,
                    Message=sms_body,
                    MessageAttributes={
                        "AWS.SNS.SMS.SMSType": {
                            "DataType": "String",
                            "StringValue": "Transactional",
                        }
                    },
                )
                sms_status_by_phone[phone] = f"SENT_SMS:{sms_resp.get('MessageId', '')}"
            except ClientError as exc:
                print(f"[WARN] SMS sandbox/bloqueado para {phone}: {exc}")
                sms_status_by_phone[phone] = "SIMULATED_SMS_ACADEMY"
        else:
            sms_status_by_phone[phone] = "SIMULATED_SMS_ACADEMY"

    return sns_message_id, email_status, sms_status_by_phone


def _record_notification_audit(
    tickets: List[Dict[str, Any]],
    ctx: Dict[str, Any],
    sns_message_id: str,
    email_status: str,
    sms_status_by_phone: Dict[str, str],
    now_iso: str,
) -> int:
    """
    Persiste en TeleCorp_VentanasZonales la auditoría omnicanal según contrato RegistroNotificacion.
    """
    records_written = 0
    incident_id = ctx["incident_id"] or "UNLINKED"
    milestone = ctx["milestone"]

    # Si se invocó manualmente sin tickets previos en BD, registrar al menos una auditoría sintética
    target_items = tickets or [
        {
            "ticket_id": ctx["ticket_id"] or f"TEST-{incident_id}",
            "email": "sns-topic-subscribers@telecorp.local",
            "phone": "",
        }
    ]

    for ticket in target_items:
        t_id = ticket.get("ticket_id") or "UNKNOWN"
        email = (ticket.get("email") or "").strip()
        phone = (ticket.get("phone") or "").strip()

        if email:
            try:
                tabla_ventanas.put_item(
                    Item={
                        "PK": f"TICKET#{t_id}",
                        "SK": f"NOTIF#{now_iso}#EMAIL",
                        "GSI1PK": f"INCIDENT#{incident_id}",
                        "GSI1SK": f"TS#{now_iso}",
                        "ticket_id": t_id,
                        "incident_id": incident_id,
                        "channel": "EMAIL",
                        "recipient": email,
                        "milestone": milestone,
                        "delivery_status": email_status,
                        "sns_message_id": sns_message_id,
                        "timestamp": now_iso,
                    }
                )
                records_written += 1
            except ClientError as exc:
                print(f"[WARN] Error guardando auditoría EMAIL para {t_id}: {exc}")

        if phone:
            try:
                tabla_ventanas.put_item(
                    Item={
                        "PK": f"TICKET#{t_id}",
                        "SK": f"NOTIF#{now_iso}#SMS",
                        "GSI1PK": f"INCIDENT#{incident_id}",
                        "GSI1SK": f"TS#{now_iso}",
                        "ticket_id": t_id,
                        "incident_id": incident_id,
                        "channel": "SMS",
                        "recipient": phone,
                        "milestone": milestone,
                        "delivery_status": sms_status_by_phone.get(
                            phone, "SIMULATED_SMS_ACADEMY"
                        ),
                        "sns_message_id": sns_message_id,
                        "timestamp": now_iso,
                    }
                )
                records_written += 1
            except ClientError as exc:
                print(f"[WARN] Error guardando auditoría SMS para {t_id}: {exc}")

    return records_written


def lambda_handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    now_iso = _now_utc_iso()
    ctx = _extract_context(event)

    # Enriquecer contexto con metadatos almacenados del Incidente Maestro si faltan campos
    if ctx["incident_id"]:
        inc_meta = _get_incident_meta(ctx["incident_id"])
        if inc_meta:
            ctx["geohash"] = ctx["geohash"] or inc_meta.get("geohash", "")
            ctx["zone_name"] = ctx["zone_name"] or inc_meta.get("zone_name", "")
            ctx["priority_level"] = ctx["priority_level"] or inc_meta.get("priority_level", "ALTA")
            ctx["priority_score"] = ctx["priority_score"] or inc_meta.get("priority_score")
            ctx["ai_diagnosis"] = ctx["ai_diagnosis"] or inc_meta.get("ai_diagnosis", "")
            ctx["critical_pois"] = ctx["critical_pois"] or inc_meta.get("critical_pois", [])

    # Si llegó solo ticket_id (ej. cierre puntual sin incident_id), extraer geohash y master_incident_id
    if ctx["ticket_id"] and (not ctx["geohash"] or not ctx["incident_id"]):
        t_meta = _get_ticket_meta(ctx["ticket_id"])
        if t_meta:
            ctx["geohash"] = ctx["geohash"] or t_meta.get("geohash", "")
            ctx["incident_id"] = ctx["incident_id"] or t_meta.get("master_incident_id", "")

    tickets = _find_affected_tickets(
        incident_id=ctx["incident_id"],
        geohash=ctx["geohash"],
        single_ticket_id=ctx["ticket_id"],
    )

    if ctx["milestone"] == "SERVICIO_RESTABLECIDO":
        _propagate_resolution_if_needed(
            incident_id=ctx["incident_id"],
            tickets=tickets,
            resolution_note=ctx["resolution_note"],
            changed_by=ctx["changed_by"],
            now_iso=now_iso,
        )

    topic_arn = _get_sns_topic_arn()
    subject, email_body, sms_body = _build_messages(ctx, tickets)
    sns_message_id, email_status, sms_status_by_phone = _publish_notifications(
        topic_arn=topic_arn,
        subject=subject,
        email_body=email_body,
        sms_body=sms_body,
        tickets=tickets,
        ctx=ctx,
    )

    audit_count = _record_notification_audit(
        tickets=tickets,
        ctx=ctx,
        sns_message_id=sns_message_id,
        email_status=email_status,
        sms_status_by_phone=sms_status_by_phone,
        now_iso=now_iso,
    )

    result = {
        "status": "NOTIFIED" if email_status == "SENT_SNS" else "DEGRADED_OR_SIMULATED",
        "incident_id": ctx["incident_id"],
        "geohash": ctx["geohash"],
        "milestone": ctx["milestone"],
        "sns_topic_arn": topic_arn or "NOT_CONFIGURED",
        "sns_message_id": sns_message_id,
        "email_delivery_status": email_status,
        "affected_tickets_count": len(tickets),
        "audit_records_written": audit_count,
        "subject_sent": subject,
        "timestamp": now_iso,
    }
    print(f"[INFO] Resultado notificación P2.5: {json.dumps(result, ensure_ascii=False)}")
    return result
