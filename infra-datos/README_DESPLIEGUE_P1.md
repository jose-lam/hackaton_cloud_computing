# Despliegue P1 — TeleCorp Sentinel AI

Este paquete contiene únicamente archivos P1: `setup_aws.sh`, `deploy_p1.sh` y `lambdas/api_crud.py`. Preserva la lógica de ingesta y del simulador ya escrita en el repositorio.

## 1. Preparación local (sin AWS)

Desde la raíz del repositorio:

```bash
bash infra-datos/deploy_p1.sh check
python3 infra-datos/storm_simulator.py --self-test
git diff --check
```

No ejecutar `deploy` hasta que P1 y P2 acuerden la cuenta de AWS y el mecanismo de autenticación del frontend.

## 2. Despliegue (en CloudShell o CLI autenticada en la cuenta acordada)

```bash
export AWS_DEFAULT_REGION=us-east-1
export TELECORP_ACCOUNT_ID=<ID_CUENTA_AWS_ACORDADA>
bash infra-datos/deploy_p1.sh deploy
bash infra-datos/deploy_p1.sh smoke
```

El script valida el ID real con STS, crea/configura las dos tablas DynamoDB, 3 colas SQS y DLQ, EventBridge, SSM y despliega `telecorp-ingest-telemetry`, `telecorp-ingest-ticket`, `telecorp-ingest-logs` y `telecorp-api-crud`. Crea sus event-source mappings y una API Gateway REST regional con Lambda proxy `/\{proxy+\}` desplegada a `/prod`. No modifica recursos de P2.

**Autenticación:** por defecto, los métodos de API Gateway requieren firma SigV4 (`AWS_IAM`). La preflight `OPTIONS` es pública. El frontend de P3 necesita autenticación de AWS o un authorizer adecuado. Solamente en una demo sin datos reales ni información personal, se puede ejecutar `P1_PUBLIC_DEMO=true bash infra-datos/deploy_p1.sh deploy` para habilitar acceso anónimo. **Esto expone todos los endpoints, incluyendo tickets y PATCH, sin autenticación; no usar en producción.** Re-ejecutar sin `P1_PUBLIC_DEMO` para volver a IAM.

El modo `smoke` invoca la Lambda directamente y comprueba siete casos de las seis rutas sin escribir datos. Para validar realmente SQS/DynamoDB/EventBridge y el navegador, hay que hacer después pruebas de escritura en una cuenta de ensayo y coordinar P2/P3.

## 3. Git

```bash
git add infra-datos/setup_aws.sh infra-datos/deploy_p1.sh infra-datos/lambdas/api_crud.py infra-datos/README_DESPLIEGUE_P1.md
git commit -m 'feat(p1): add account-safe reproducible AWS deployment'
git push origin p1-infra-datos
```

No fusionar `main` sin coordinación con Lam.
