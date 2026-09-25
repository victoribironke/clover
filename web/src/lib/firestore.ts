import "server-only";
import { Firestore } from "@google-cloud/firestore";

// Same Firestore as the bot, read on the server only; the browser never talks to Firestore,
// so the locked-down security rules stay as they are. Credentials: the Cloud Run service
// account in production; locally `gcloud auth application-default login`.
export const firestore = new Firestore({ ignoreUndefinedProperties: true });

// The bot writes production data to unprefixed collections (dev_* is its local test data).
// The panel shows production, locally too.
export const collection = (name: "bets" | "analyses" | "kv" | "studies") => firestore.collection(name);
