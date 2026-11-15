#!/usr/bin/env bash
set -euo pipefail

export AWS_DEFAULT_REGION=us-east-1

ACCOUNT=$(aws sts get-caller-identity --query Account --output text)

if [[ "$ACCOUNT" != "553662839025" ]]; then
  echo "ERROR: cuenta AWS incorrecta: $ACCOUNT"
  exit 1
fi

echo "Creando infraestructura DynamoDB de TeleCorp..."

if ! aws dynamodb describe-table \
  --table-name TeleCorp_Operaciones >/dev/null 2>&1; then

  aws dynamodb create-table \
    --table-name TeleCorp_Operaciones \
    --attribute-definitions \
    AttributeName=PK,AttributeType=S \
    AttributeName=SK,AttributeType=S \
    AttributeName=GSI1PK,AttributeType=S \
    AttributeName=GSI1SK,AttributeType=S \
    --key-schema \
    AttributeName=PK,KeyType=HASH \
    AttributeName=SK,KeyType=RANGE \
    --global-secondary-indexes \
    '[{"IndexName":"GSI1_ZonaEstado","KeySchema":[{"AttributeName":"GSI1PK","KeyType":"HASH"},{"AttributeName":"GSI1SK","KeyType":"RANGE"}],"Projection":{"ProjectionType":"ALL"}}]' \
    --billing-mode PAY_PER_REQUEST
fi

if ! aws dynamodb describe-table \
  --table-name TeleCorp_VentanasZonales >/dev/null 2>&1; then

  aws dynamodb create-table \
    --table-name TeleCorp_VentanasZonales \
    --attribute-definitions \
    AttributeName=PK,AttributeType=S \
    AttributeName=SK,AttributeType=S \
    --key-schema \
    AttributeName=PK,KeyType=HASH \
    AttributeName=SK,KeyType=RANGE \
    --billing-mode PAY_PER_REQUEST
fi

aws dynamodb wait table-exists \
  --table-name TeleCorp_Operaciones

aws dynamodb wait table-exists \
  --table-name TeleCorp_VentanasZonales

for config in \
  "TeleCorp_Operaciones:ttl_epoch" \
  "TeleCorp_VentanasZonales:expires_at"; do

  IFS=: read -r table attribute <<<"$config"

  status=$(aws dynamodb describe-time-to-live \
    --table-name "$table" \
    --query 'TimeToLiveDescription.TimeToLiveStatus' \
    --output text)

  if [[ "$status" == "DISABLED" ]]; then
    aws dynamodb update-time-to-live \
      --table-name "$table" \
      --time-to-live-specification \
      "Enabled=true,AttributeName=$attribute"
  fi
done

echo "Tablas configuradas:"
aws dynamodb list-tables --output table
