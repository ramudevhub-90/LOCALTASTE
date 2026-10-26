#!/usr/bin/env bash
# Build the front end against the current amplify_outputs.json and push it to
# Amplify Hosting (manual zip deploy). Usage: AWS_PROFILE=default scripts/deploy-web.sh
set -euo pipefail
APP_ID="${AMPLIFY_APP_ID:-d1kr390j864wbi}"
BRANCH=main
export AWS_REGION="${AWS_REGION:-us-east-1}"

npm run build
ZIP="$(mktemp -d)/web.zip"
(cd web/dist && zip -qr "$ZIP" .)
read -r JOB URL <<<"$(aws amplify create-deployment --app-id "$APP_ID" --branch-name "$BRANCH" --query '[jobId,zipUploadUrl]' --output text)"
curl -sf -T "$ZIP" "$URL"
aws amplify start-deployment --app-id "$APP_ID" --branch-name "$BRANCH" --job-id "$JOB" --query jobSummary.status --output text
echo "https://localtaste.revenuerush.in (also https://$BRANCH.$APP_ID.amplifyapp.com)"
