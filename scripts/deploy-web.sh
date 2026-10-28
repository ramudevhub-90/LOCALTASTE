#!/usr/bin/env bash
# Build the front end against the localtaste CDK stack's outputs and push it to
# Amplify Hosting (manual zip deploy). Usage: AWS_PROFILE=default scripts/deploy-web.sh
set -euo pipefail
APP_ID="${AMPLIFY_APP_ID:-d1kr390j864wbi}"
BRANCH=main
export AWS_REGION="${AWS_REGION:-us-east-1}"

aws cloudformation describe-stacks --stack-name localtaste --query 'Stacks[0].Outputs' --output json \
  | node -e 'const o = JSON.parse(require("fs").readFileSync(0, "utf8")); console.log(JSON.stringify(Object.fromEntries(o.map((x) => [x.OutputKey, x.OutputValue])), null, 2))' \
  > web/src/backend.json
npm run build
ZIP="$(mktemp -d)/web.zip"
(cd web/dist && zip -qr "$ZIP" .)
read -r JOB URL <<<"$(aws amplify create-deployment --app-id "$APP_ID" --branch-name "$BRANCH" --query '[jobId,zipUploadUrl]' --output text)"
curl -sf -T "$ZIP" "$URL"
aws amplify start-deployment --app-id "$APP_ID" --branch-name "$BRANCH" --job-id "$JOB" --query jobSummary.status --output text
echo "https://localtaste.revenuerush.in (also https://$BRANCH.$APP_ID.amplifyapp.com)"
