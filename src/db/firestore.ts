import { Firestore } from "@google-cloud/firestore";
import { config } from "@/config.ts";

// Auth and project come from Application Default Credentials: the service account
// on Cloud Run; locally, `gcloud auth application-default login` + `gcloud config set project`.
export const firestore = new Firestore({ ignoreUndefinedProperties: true });

// Local runs write to dev_* collections so they never touch production data
const prefix = config.onCloudRun ? "" : "dev_";

// ("studies" held the late-price study until 2026-10-24; its documents are still there)
export const collection = (name: "bets" | "analyses" | "kv" | "speed") =>
  firestore.collection(`${prefix}${name}`);
