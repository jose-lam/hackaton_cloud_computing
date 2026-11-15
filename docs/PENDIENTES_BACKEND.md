# Pendientes de backend para cerrar el frontend

> Documento de coordinación. Cada responsable actualiza su estado y el frontend se ajusta a lo que queda aquí.
> Guardar en el repo como `docs/PENDIENTES_BACKEND.md`.

**API base:** `https://z0zcs0rpvk.execute-api.us-east-1.amazonaws.com/prod`
**Frontend (S3):** `https://telecorp-sentinel-portal-139694589223.s3.us-east-1.amazonaws.com/index.html` (NOC: `.../index.html#/noc`)

## Resumen

| # | Tarea | Responsable | Estado | Verificación |
|---|---|---|---|---|
| 1 | `GET /incidentes` | P1 | [ ] | Pruebas A y B |
| 2 | `GET /antenas` | P1 | [ ] | Prueba A y C |
| 3 | `incident_time` guardado y en el contrato | P1 | [ ] | Prueba D |
| 4 | CORS en las rutas nuevas | P1 | [ ] | Prueba E |
| 5 | Datos de demo (simulador) | P1 | [ ] | NOC con datos |
| 6 | Incidentes maestros generados por el flujo | P2 | [ ] | `/incidentes` no vacío |
| 7 | Tickets vinculados al incidente (`master_incident_id`) | P2 | [ ] | Prueba F |
| 8 | `PATCH` a "Solucionada" dispara notificación | P2 | [ ] | Correo recibido |
| 9 | Despliegue del frontend en S3 | Quien tenga el bucket | [ ] | Sitio abre |

## P1: Datos e ingesta

### 1. `GET /incidentes`
Lista los incidentes maestros (entidad `INCIDENT#`). Misma convención que `GET /tickets`: respuesta `{ "items": [...] }`.

```yaml
  /incidentes:
    get:
      summary: Lista los incidentes maestros
      responses:
        "200":
          description: OK
          content:
            application/json:
              schema:
                type: object
                properties:
                  items:
                    type: array
                    items:
                      $ref: "#/components/schemas/Incidente"
```

```yaml
    Incidente:
      type: object
      properties:
        incident_id:          { type: string }
        geohash:              { type: string }
        zone_name:            { type: string }
        trigger_type:         { type: string, enum: [COLECTIVO_10, TEMPRANO_IA, ANTENA_UMBRAL] }
        affected_users_count: { type: integer }
        critical_pois:
          type: array
          items:
            type: object
            properties:
              name:       { type: string }
              type:       { type: string }
              distance_m: { type: number }
        priority_score:       { type: number }
        priority_level:       { type: string, enum: [CRITICA, ALTA, MEDIA, BAJA] }
        status:               { type: string }
        ai_diagnosis:         { type: string }
        created_at:           { type: string, format: date-time }
        closed_at:            { type: string, format: date-time, nullable: true }
        # Opcionales (mejoran el NOC; si no existen, el frontend se adapta):
        antenna_id:           { type: string }
        ai_confidence:        { type: number, minimum: 0, maximum: 1 }  # semantic_cluster_confidence de Gemini
        ticket_ids:           { type: array, items: { type: string } }
```

Opcional: `PATCH /incidentes/{incident_id}/estado` con `{ new_status, changed_by, note }`, que actualice el incidente y sus tickets vinculados. Hoy el NOC hace un `PATCH` por cada ticket.

### 2. `GET /antenas`
Lista el estado actual de las antenas (`ANTENNA#<id>` / `CURRENT`). Respuesta `{ "items": [...] }`.

```yaml
    Antena:
      type: object
      properties:
        antenna_id:      { type: string }
        zone_name:       { type: string }
        lat:             { type: number }
        lon:             { type: number }
        geohash:         { type: string }
        last_traffic_gb: { type: number }
        health_status:   { type: string, enum: [INHABILITADA, CAIDA, NORMAL, SATURADA] }
        updated_at:      { type: string, format: date-time }
        structural_risk: { type: boolean }
```

### 3. `incident_time`
Agregar a `TicketCreateRequest` (opcional, ISO 8601), guardarlo en el ticket y devolverlo en `GET /tickets`. El caso pide registrar la fecha y hora del inconveniente.

```yaml
        incident_time: { type: string, format: date-time }
```

### 4. CORS
Las rutas nuevas deben responder `OPTIONS` y las cabeceras CORS para el origen de S3 (o `*`), con métodos `GET, POST, PATCH`.

### 5. Datos de demo
Cuando P2 tenga su flujo desplegado, correr el simulador (`storm-hospital`) para dejar el NOC con incidentes, antenas caídas y una antena recurrente.

> Ajustar los nombres de esquemas a la convención que ya use `openapi.yaml`.

## P2: Orquestación

### 6. Incidentes maestros
Al detectar un incidente colectivo (>= 10 usuarios distintos, misma zona, < 24 h) o uno temprano por IA, crear el `INCIDENT#` con `priority_score`, `priority_level`, `critical_pois` y `ai_diagnosis`. Hoy hay 0 y la tabla principal del NOC queda vacía.

### 7. Vinculación
Asignar `master_incident_id` a los tickets del incidente y actualizar su estado (`En revisión` / `Siendo atendida`) con registro en el historial.

### 8. Notificación de restablecimiento
Al cambiar un ticket a `Solucionada` (`PATCH /tickets/{id}/estado`), enviar la notificación de servicio restablecido.

## Quien tenga las credenciales del bucket

### 9. Despliegue en S3
```bash
git pull
cd frontend
npm install
npm run build        # usa .env.production (API real)
aws s3 sync dist/ s3://telecorp-sentinel-portal-139694589223 --delete
```
Repetir cada vez que cambie el frontend o la URL del API.

## Pruebas de aceptación

Sustituir `$API` por la API base.

```bash
API=https://z0zcs0rpvk.execute-api.us-east-1.amazonaws.com/prod

# A. Las dos listas existen y devuelven { items: [...] }
curl -s $API/incidentes | head -c 600
curl -s $API/antenas    | head -c 600

# B. Hay al menos un incidente tras correr el simulador
curl -s $API/incidentes | grep -c incident_id

# D. incident_time se guarda
curl -s -X POST $API/tickets -H "content-type: application/json" \
  -d '{"user_id":"DNI-1","service_number":"999111222","location_text":"Cercado de Lima","lat":-12.0464,"lon":-77.0428,"problem_type":"SIN_INTERNET","description":"prueba","incident_time":"2026-11-15T17:00:00Z"}'
# luego GET /tickets?user_id=DNI-1 debe devolver incident_time

# E. CORS (debe aparecer access-control-allow-origin y PATCH)
curl -i -X OPTIONS $API/incidentes \
  -H "Origin: https://telecorp-sentinel-portal-139694589223.s3.us-east-1.amazonaws.com" \
  -H "Access-Control-Request-Method: GET"

# F. Un ticket de la zona tiene master_incident_id
curl -s "$API/tickets?geohash=6mc5p8" | grep master_incident_id
```

## Notas
- Si un endpoint no está listo, el frontend usa un respaldo temporal (incidentes desde `master_incidents` y antenas desde `recurrent_antennas`), pero deja el NOC incompleto.
- No se publican secretos en el frontend: las variables `VITE_*` quedan visibles en el navegador.
