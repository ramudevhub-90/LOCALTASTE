# Localtaste

A taste advisor for independent cafés and restaurants that can't afford market research.

Enter your café's address and current menu. Localtaste's agent asks [Qloo](https://qloo.com) what the
neighbourhood over-indexes on across food, music, film/TV and brands, then suggests:

- **Menu additions** the area likes that your menu doesn't cover yet
- **An in-store playlist** built from the artists the area favours
- **Theme nights**, e.g. "this area over-indexes on K-drama fans, so try a Korean street-food Friday"
- **An area comparison** for a competitor's neighbourhood or a second branch

Every suggestion has a **Why this?** link showing the Qloo signals and the exact workflow call behind it.
Results are aggregate neighbourhood affinities, never claims about individuals.

> Built for the [Qloo Agentic Hackathon](https://qloo.devpost.com).

## How the agent works

The worker runs a tool-use agent loop on Amazon Bedrock (`core/agent-bedrock.ts`, Amazon Nova Pro through the model-neutral Converse API, IAM roles only, no API key) with Qloo workflows as tools:

1. The worker maps the area with Qloo: `recommend` with the city as `signal_location` for artists, TV shows and
   brands; the neighbourhood's own favoured venues (`filter_location`); and `entity_tags` on those venues for food
   concepts and the crowd's vibe. The model gets all of it up front, each signal with an id.
2. The model digs deeper with 2-5 `qloo_recommend` calls, one lead each: places in the neighbourhood that fans of a
   top artist favour, artists that fans of a favoured venue like, shows for theme nights. Known signals are passed by
   Qloo id. If it tries to submit before two calls return something, it is sent back once.
3. It submits suggestions through `submit_suggestions`. Code checks each one: menu ideas must cite a dining signal,
   the playlist music, theme nights the show or artist they are built on. Each "Why it fits" line is written from the
   cited Qloo results (e.g. "Fans of Three Dots & A Dash in Bengaluru also favour Mirzapur"), not by the model, so it
   never claims a link the data does not show.

Every tool call is recorded and shown under "How the agent worked". If Qloo or Bedrock is not available, the app
falls back to clearly labelled sample data and a deterministic template writer, so the demo never breaks.

## Architecture

Serverless on AWS with [Amplify Gen 2](https://docs.amplify.aws/react/):

```
Browser (React) ──startAnalysis mutation──► AppSync ──► start-analysis Lambda ──► SQS
      ▲                                                                            │
      └──── onUpdate subscription (progress + result) ◄── AppSync ◄── analyze-worker Lambda
                                                                       ├─ Qloo (@qloo/qloo-harness, in-process)
                                                                       ├─ Bedrock: Amazon Nova Pro (tool-use agent loop)
                                                                       └─ DynamoDB cache of Qloo responses
```

- **Cognito**: email sign-in for café owners, plus guest access so anyone can try it without signing up.
- **AppSync + DynamoDB**: `AnalysisJob` records; the worker updates them through AppSync, so the UI streams progress.
- **SQS**: agent runs take longer than an AppSync resolver may (~30 s), so jobs are queued (with a dead-letter queue).
- `core/qloo/`: the only code that touches Qloo. `sample.ts` returns hand-written sample data; `live.ts` runs harness
  workflows (`recommend` with `signal_location`, `compare_audiences`, …) via `createDirectQlooWorkflowExecutorFromEnvironment`.
- `core/agent.ts`: turns area taste signals and the menu into evidence-linked suggestions.
- `web/`: Vite + React front end.

## Run it

Requires Node 22.19+ and an AWS profile with Amplify/CDK permissions (account bootstrapped for CDK).

```sh
npm install
AWS_PROFILE=<profile> AWS_REGION=us-east-1 npm run sandbox   # deploys a personal backend, writes amplify_outputs.json
npm run dev                                                  # http://localhost:5173
```

Deploy the front end to Amplify Hosting: `AWS_PROFILE=<profile> scripts/deploy-web.sh`.
Live demo: https://localtaste.revenuerush.in (no sign-up needed).

The Qloo key is an Amplify secret (stored in SSM), never in the repo or the browser:

```sh
npx ampx sandbox secret set QLOO_API_KEY --identifier demo
```

The model runs on Amazon Bedrock with IAM roles, no API key (set `BEDROCK_MODEL_ID` to swap models). By default the worker calls Bedrock in its own account.
If another account has the model access, create an invoke-only role there whose trust policy names the worker's
role, and deploy with `LOCALTASTE_BEDROCK_ROLE_ARN=<that role's ARN>`; the worker assumes it for each run.
Without model access the template writer is used.

## License

[MIT](LICENSE)
