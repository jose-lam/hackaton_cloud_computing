#!/usr/bin/env python3
"""TeleCorp P1.5: simulacion reproducible de telemetria y tickets.

Por defecto publica en SQS. Usa --dry-run para probar sin AWS.
En modo recurrent se siembra el historial en DynamoDB y se publica la falla actual.
"""

import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date, datetime, time, timedelta, timezone
from decimal import Decimal
import json
import sys
import time as time_module
import uuid
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

HOSPITAL = (-12.04955, -77.04462)
RESIDENTIAL = (-12.0938, -77.0645)
EARLY_ZONE = (-12.1332, -77.0234)
RECURRENT_ZONE = (-12.1720, -76.9965)


def iso(dt):
    return dt.astimezone(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def telemetry(antenna, zone, traffic, timestamp, zone_name):
    return {
        "antenna_id": antenna,
        "zone_name": zone_name,
        "lat": zone[0], "lon": zone[1],
        "traffic_gb_min": traffic,
        "timestamp": iso(timestamp),
    }


def ticket(run_id, group, number, zone, description, location):
    label = f"{group}-{number:02d}"
    return {
        "ticket_id": f"TCK-SIM-{run_id}-{label}",
        "user_id": f"SIM-{run_id}-{label}",
        "service_number": f"SIM-{run_id}-{label}",
        "email": f"sim-{run_id.lower()}-{label.lower()}@example.com",
        "phone": "",
        "location_text": location,
        "lat": zone[0], "lon": zone[1],
        "problem_type": "SIN_INTERNET",
        "description": description,
    }


def build_scenario(mode, now, run_id):
    """Devuelve fases de (descripcion, tipo, mensajes).

    Las fases separadas permiten esperar que el estado de antenas se indexe
    antes de comenzar el aluvion de tickets en SQS estandar.
    """
    if mode == "normal":
        return [(
            "telemetria normal (70-115 GB/min)", "telemetry",
            [telemetry(f"ANT-NORMAL-{i:02d}", HOSPITAL, value, now, "Zona normal de prueba")
             for i, value in enumerate((70, 85, 100, 115), start=1)]
        )]

    if mode == "storm-hospital":
        zones = [
            ("H", "ANT-HOSP-01", HOSPITAL, "Hospital Loayza - area simulada", 42,
             "Sin internet cerca del hospital; pacientes sin conectividad"),
            ("R", "ANT-RES-02", RESIDENTIAL, "Zona residencial - area simulada", 45,
             "Sin internet en mi vivienda desde hace varios minutos"),
        ]
        baseline = [telemetry(a, z, 100, now, label) for _, a, z, label, _, _ in zones]
        failures = [telemetry(a, z, gb, now + timedelta(seconds=5), label)
                    for _, a, z, label, gb, _ in zones]
        reports = [ticket(run_id, group, idx, z, desc, label)
                   for group, _, z, label, _, desc in zones
                   for idx in range(1, 16)]
        return [
            ("linea base de 2 antenas", "telemetry", baseline),
            ("caida hospitalaria y residencial", "telemetry", failures),
            ("30 reportes: 15 hospital + 15 residencial", "ticket", reports),
        ]

    if mode == "early-ai":
        descriptions = [
            "No tengo datos moviles desde esta manana en esta cuadra",
            "El internet del celular dejo de funcionar cerca de mi edificio",
            "Hay interrupcion de conexion de datos en toda la zona",
        ]
        return [
            ("linea base de antena", "telemetry",
             [telemetry("ANT-EARLY-01", EARLY_ZONE, 105, now, "Zona IA temprana")]),
            ("antena en CAIDA (55 GB/min)", "telemetry",
             [telemetry("ANT-EARLY-01", EARLY_ZONE, 55, now + timedelta(seconds=5),
                        "Zona IA temprana")]),
            ("3 reportes semanticos distintos", "ticket",
             [ticket(run_id, "E", i, EARLY_ZONE, desc, "Zona de deteccion temprana")
              for i, desc in enumerate(descriptions, 1)]),
        ]

    if mode == "recurrent":
        return [
            ("nueva falla de ANT-REC-09 hoy", "telemetry",
             [telemetry("ANT-REC-09", RECURRENT_ZONE, 43, now,
                        "Zona de recurrencia estructural")]),
        ]
    raise ValueError(f"Modo desconocido: {mode}")


def recurrent_items(now):
    """Cuatro dias historicos anómalos y recuperacion entre fallas.

    Se siembra DDB directamente para evitar reordenamientos en SQS standard
    y asegurar que eval_recurrence vea cada EVENT#dia#timestamp.
    """
    antenna = "ANT-REC-09"
    items = []
    for days_ago in (6, 5, 4, 2):
        day = (now - timedelta(days=days_ago)).date()
        failed = datetime.combine(day, time(hour=10, tzinfo=timezone.utc))
        restored = failed + timedelta(minutes=45)
        for dt, status, gb in (
            (failed, "CAIDA", Decimal("43")),
            (restored, "NORMAL", Decimal("100")),
        ):
            stamp = iso(dt)
            items.append({
                "PK": f"ANTENNA#{antenna}",
                "SK": f"EVENT#{day.isoformat()}#{stamp}",
                "health_status": status,
                "traffic_gb": gb,
                "geohash": encode_geohash(*RECURRENT_ZONE),
                "updated_at": stamp,
            })
    # Las lecturas del ingestor parten de NORMAL antes de enviar la falla actual.
    current = {
        "PK": f"ANTENNA#{antenna}", "SK": "CURRENT",
        "antenna_id": antenna,
        "geohash": encode_geohash(*RECURRENT_ZONE),
        "GSI1PK": f"ZONA#{encode_geohash(*RECURRENT_ZONE)}",
        "GSI1SK": f"ANTENNA#{antenna}",
        "lat": Decimal(str(RECURRENT_ZONE[0])),
        "lon": Decimal(str(RECURRENT_ZONE[1])),
        "last_traffic_gb": Decimal("100"),
        "health_status": "NORMAL",
        "updated_at": iso(now - timedelta(minutes=5)),
    }
    return items, current


def encode_geohash(lat, lon, precision=6):
    chars = "0123456789bcdefghjkmnpqrstuvwxyz"
    latitude = [-90., 90.]
    longitude = [-180., 180.]
    out, value, bits = "", 0, 0
    while len(out) < precision:
        use_lon = bits % 2 == 0
        interval = longitude if use_lon else latitude
        position = lon if use_lon else lat
        half = sum(interval) / 2
        value = (value << 1) | int(position >= half)
        if position >= half:
            interval[0] = half
        else:
            interval[1] = half
        bits += 1
        if bits % 5 == 0:
            out += chars[value]
            value = 0
    return out


def publish_sqs(client, queue_url, payloads):
    count = 0
    for start in range(0, len(payloads), 10):
        chunk = payloads[start:start + 10]
        pending = [
            {"Id": str(i), "MessageBody": json.dumps(body, ensure_ascii=False)}
            for i, body in enumerate(chunk)
        ]
        for attempt in range(3):
            if not pending:
                break
            result = client.send_message_batch(QueueUrl=queue_url, Entries=pending)
            count += len(result.get("Successful", []))
            failed = {x["Id"]: x for x in result.get("Failed", [])}
            permanent = [f for f in failed.values() if f.get("SenderFault", False)]
            if permanent:
                raise RuntimeError(f"Error SQS permanente: {permanent}")
            pending = [x for x in pending if x["Id"] in failed]
            if pending:
                time_module.sleep(.25 * 2 ** attempt)
        if pending:
            raise RuntimeError(f"SQS no acepto {len(pending)} mensajes despues de 3 intentos")
    return count


def publish_http(base_url, kind, payloads):
    path = "/telemetria" if kind == "telemetry" else "/tickets"
    def send(body):
        # En HTTP, el API genera el ticket_id. No reintentamos POST para no duplicar.
        if kind == "ticket":
            body = {k: v for k, v in body.items() if k != "ticket_id"}
        req = Request(
            base_url.rstrip("/") + path,
            data=json.dumps(body, ensure_ascii=False).encode("utf-8"),
            headers={"Content-Type": "application/json"}, method="POST",
        )
        with urlopen(req, timeout=15) as resp:
            if resp.status != 202:
                raise RuntimeError(f"HTTP {resp.status} en {path}")
        return 1
    with ThreadPoolExecutor(max_workers=8) as executor:
        jobs = [executor.submit(send, body) for body in payloads]
        return sum(job.result() for job in as_completed(jobs))


def seed_recurrence(dynamodb, now, dry_run):
    historic, current = recurrent_items(now)
    if dry_run:
        print(f"[DRY-RUN] DynamoDB: {len(historic)} EVENT# (4 fallas + 4 recuperaciones) y 1 CURRENT")
        return
    table = dynamodb.Table("TeleCorp_Operaciones")
    for item in historic:
        table.put_item(Item=item)
    table.put_item(Item=current)
    print(f"DynamoDB: {len(historic)} EVENT# historicos + CURRENT normal insertados")


def self_test():
    now = datetime(2026, 11, 15, 16, 0, tzinfo=timezone.utc)
    run_id = "TEST1234"
    normal = build_scenario("normal", now, run_id)
    assert len(normal[0][2]) == 4
    assert all(70 <= p["traffic_gb_min"] <= 115 for p in normal[0][2])
    storm = build_scenario("storm-hospital", now, run_id)
    assert [len(x[2]) for x in storm] == [2, 2, 30]
    reports = storm[2][2]
    assert len({p["user_id"] for p in reports}) == 30
    assert len({encode_geohash(p["lat"], p["lon"]) for p in reports}) == 2
    assert len([p for p in reports if "-H-" in p["user_id"]]) == 15
    assert len([p for p in reports if "-R-" in p["user_id"]]) == 15
    early = build_scenario("early-ai", now, run_id)
    assert len(early[2][2]) == 3 and early[1][2][0]["traffic_gb_min"] < 60
    assert len({p["description"] for p in early[2][2]}) == 3
    historic, current = recurrent_items(now)
    assert len(historic) == 8 and current["health_status"] == "NORMAL"
    assert len({p["SK"].split("#")[1] for p in historic if p["health_status"] == "CAIDA"}) == 4
    print("OK: pruebas locales de los cuatro modos y de la recurrencia")


def main():
    parser = argparse.ArgumentParser(description="Simulador de incidentes TeleCorp (P1.5)")
    parser.add_argument("--mode", choices=("normal", "storm-hospital", "early-ai", "recurrent"))
    parser.add_argument("--self-test", action="store_true")
    parser.add_argument("--dry-run", action="store_true", help="No utiliza AWS ni HTTP")
    parser.add_argument("--transport", choices=("sqs", "http"), default="sqs")
    parser.add_argument("--api-url", help="URL base API Gateway, incluyendo /prod")
    parser.add_argument("--region", default="us-east-1")
    parser.add_argument("--settle-seconds", type=float, default=5,
                        help="Espera entre fases para que SQS y DynamoDB procesen datos")
    args = parser.parse_args()
    if args.self_test:
        self_test()
        return 0
    if not args.mode:
        parser.error("Debes indicar --mode o --self-test")
    if args.transport == "http" and not args.api_url and not args.dry_run:
        parser.error("--transport http requiere --api-url")
    if args.settle_seconds < 0:
        parser.error("--settle-seconds debe ser >= 0")

    now = datetime.now(timezone.utc)
    run_id = uuid.uuid4().hex[:8].upper()
    phases = build_scenario(args.mode, now, run_id)
    print(f"Modo={args.mode} | transporte={args.transport} | dry_run={args.dry_run} | run_id={run_id}")
    print("Zonas: " + ", ".join(sorted({encode_geohash(p['lat'], p['lon'])
          for _, _, payloads in phases for p in payloads})))

    sqs = dynamodb = queue_urls = None
    if not args.dry_run:
        if args.mode == "recurrent" or args.transport == "sqs":
            try:
                import boto3
            except ImportError as exc:
                raise RuntimeError("Instala boto3 para enviar por SQS / sembrar DynamoDB") from exc
            session = boto3.Session(region_name=args.region)
            if args.mode == "recurrent":
                dynamodb = session.resource("dynamodb")
            if args.transport == "sqs":
                sqs = session.client("sqs")
                queue_urls = {
                    kind: sqs.get_queue_url(QueueName=f"telecorp-{name}-q")["QueueUrl"]
                    for kind, name in (("telemetry", "telemetry"), ("ticket", "tickets"))
                }

    if args.mode == "recurrent":
        seed_recurrence(dynamodb, now, args.dry_run)

    total = 0
    for index, (label, kind, payloads) in enumerate(phases):
        print(f"Fase {index + 1}/{len(phases)}: {label} ({len(payloads)} mensajes)")
        if args.dry_run:
            for item in payloads[:2]:
                print("  " + json.dumps(item, ensure_ascii=False))
            if len(payloads) > 2:
                print(f"  ... {len(payloads) - 2} mensajes adicionales")
            sent = len(payloads)
        elif args.transport == "sqs":
            sent = publish_sqs(sqs, queue_urls[kind], payloads)
        else:
            sent = publish_http(args.api_url, kind, payloads)
        total += sent
        print(f"  {'preparados' if args.dry_run else 'aceptados'}: {sent}/{len(payloads)}")
        if index < len(phases) - 1 and not args.dry_run:
            time_module.sleep(args.settle_seconds)

    print(f"FIN: {total} mensajes {'preparados (sin enviar)' if args.dry_run else 'aceptados'}")
    if args.mode == "recurrent":
        print("Verifica structural_risk en ANTENNA#ANT-REC-09 / CURRENT y Step Functions")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (HTTPError, URLError, RuntimeError, OSError) as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        sys.exit(1)
