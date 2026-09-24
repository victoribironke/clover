import { Firestore } from "@google-cloud/firestore";
import { config } from "@/config.ts";

// Auth and project come from Application Default Credentials: the service account
// on Cloud Run; locally, `gcloud auth application-default login` + `gcloud config set project`.
export const firestore = new Firestore({ ignoreUndefinedProperties: true });

// Local runs write to dev_* collections so they never touch production data
const prefix = config.onCloudRun ? "" : "dev_";

export const collection = (name: "bets" | "analyses" | "kv") => firestore.collection(`${prefix}${name}`);
