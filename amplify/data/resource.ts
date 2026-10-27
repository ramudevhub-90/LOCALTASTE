import { type ClientSchema, a, defineData } from "@aws-amplify/backend";
import { analyzeWorker } from "../functions/analyze-worker/resource";
import { startAnalysis } from "../functions/start-analysis/resource";

const schema = a
  .schema({
    JobStatus: a.enum(["QUEUED", "RUNNING", "DONE", "FAILED"]),

    // One agent run. The worker updates it through AppSync, so clients get
    // progress and the final result via the onUpdate subscription.
    // kind: "analyze" (default), or a follow-up on a finished analysis
    // (parentId): "branch", "competitor" or "ask" with its text in `input`.
    AnalysisJob: a
      .model({
        location: a.string().required(),
        menu: a.string().array(),
        compareWith: a.string(),
        cafe: a.string(),
        kind: a.string(),
        parentId: a.string(),
        input: a.string(),
        status: a.ref("JobStatus"),
        step: a.string(),
        result: a.json(),
        error: a.string(),
      })
      .authorization((allow) => [allow.guest().to(["read"]), allow.authenticated().to(["read"])]),

    startAnalysis: a
      .mutation()
      .arguments({
        location: a.string().required(),
        menu: a.string().array(),
        compareWith: a.string(),
        cafe: a.string(),
      })
      .returns(a.ref("AnalysisJob"))
      .authorization((allow) => [allow.guest(), allow.authenticated()])
      .handler(a.handler.function(startAnalysis)),

    startFollowUp: a
      .mutation()
      .arguments({
        parentId: a.string().required(),
        kind: a.string().required(),
        input: a.string(),
      })
      .returns(a.ref("AnalysisJob"))
      .authorization((allow) => [allow.guest(), allow.authenticated()])
      .handler(a.handler.function(startAnalysis)),
  })
  .authorization((allow) => [allow.resource(startAnalysis), allow.resource(analyzeWorker)]);

export type Schema = ClientSchema<typeof schema>;

export const data = defineData({
  schema,
  authorizationModes: { defaultAuthorizationMode: "identityPool" },
});
