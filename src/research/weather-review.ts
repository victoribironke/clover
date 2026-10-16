import { z } from "zod";
import { recordUsage } from "@/db/spend.ts";
import { getJson, NWS_HEADERS, parseTemperatureQuestion, stationInfo } from "@/data/station-weather.ts";
import type { MarketEvent } from "@/exchanges/types.ts";
import { log } from "@/lib/logger.ts";
import { reason } from "@/llm/openai.ts";
import { settings } from "@/settings.ts";
import type { Proposal } from "@/strategy/propose.ts";
import type { DeepDive } from "./deep-dive.ts";
import { nwsPoint } from "./multi-source-weather.ts";

// The last check on a multi-source Kalshi bet: the reasoning model reads the numbers and the local
// NWS office's Area Forecast Discussion, where forecasters describe what the hours ahead hinge on
// (a front's timing, clouds clearing, a wind shift, rain-cooled air). Numbers stay in charge: the
// model can only veto, and only with a concrete reason. About $0.0005 a check.

const SYSTEM = `You check one bet on a Kalshi daily temperature market before it's placed. It settles on the NWS climate report for the station: the day's high or low in whole °F, midnight to midnight local standard time.
The numbers: the station's readings so far, and four forecasts for the hours left (HRRR, NBM, NWS hourly, an ensemble), each shifted to match the latest reading. They agree, which is why the bet was chosen.
Read the forecast discussion for what could still move the final high/low before the day ends, beyond what the forecasts show: a front or wind shift earlier or later than modelled, clouds clearing (faster cooling) or arriving (warmer night), showers, a temperature that will keep dropping until midnight.
Veto only if the discussion gives a concrete reason the bet is likely wrong. If the discussion doesn't speak to this station's remaining hours, approve. Reply in one short sentence.`;

const schema = {
  type: "object",
  additionalProperties: false,
  required: ["approve", "reason"],
  properties: { approve: { type: "boolean" }, reason: { type: "string" } },
};

const parse = z.object({ approve: z.boolean(), reason: z.string() });

// The discussion text up to the aviation/marine sections, which don't bear on the station's
// temperature; cut to keep the prompt small
const DISCUSSION_CHARS = 6000;
export const discussionText = (text: string) => {
  const cut = text.search(/^\.(AVIATION|MARINE|FIRE WEATHER|HYDROLOGY|[A-Z]{3} WATCHES)/m);
  return (cut > 0 ? text.slice(0, cut) : text).slice(0, DISCUSSION_CHARS).trim();
};

const latestDiscussion = async (office: string) => {
  const list = await getJson<{ "@graph"?: { id: string }[] }>(
    `https://api.weather.gov/products/types/AFD/locations/${office}`,
    NWS_HEADERS,
  );
  const id = list["@graph"]?.[0]?.id;
  if (!id) throw new Error(`No forecast discussion from ${office}`);
  const product = await getJson<{ productText: string; issuanceTime: string }>(
    `https://api.weather.gov/products/${id}`,
    NWS_HEADERS,
  );
  return { text: discussionText(product.productText), issued: product.issuanceTime };
};

const cents = (price: number) => `${Math.round(price * 100)}¢`;

// null = approved; otherwise the reason for the veto
export const reviewWeatherBet = async (
  event: MarketEvent,
  research: DeepDive,
  proposal: Proposal,
): Promise<string | null> => {
  const question = parseTemperatureQuestion(event);
  if (!question) return "not a Kalshi temperature market";
  const station = await stationInfo(question.station);
  const point = await nwsPoint(station.latitude, station.longitude);
  const discussion = await latestDiscussion(point.office);
  const now = new Intl.DateTimeFormat("en-US", {
    timeZone: station.timeZone,
    dateStyle: "medium",
    timeStyle: "short",
  }).format(Date.now());

  const result = await reason({
    system: SYSTEM,
    prompt: [
      `Now ${now} at the station (${station.name}).`,
      `Market: ${event.title}`,
      `Bet: buy ${proposal.outcome.label} on "${proposal.market.title}" at ${cents(proposal.quotedPrice)}; our probability ${Math.round(proposal.probability * 100)}%.`,
      `Numbers: ${research.summary}`,
      `Forecast discussion (NWS ${point.office}, issued ${discussion.issued}):`,
      discussion.text,
    ].join("\n"),
    jsonSchema: schema,
    parse,
    effort: "low",
    maxOutputTokens: 3000,
  });
  const costUsd = await recordUsage(settings.reasoningModel, result.usage);
  log.info("weather review", {
    eventId: event.id,
    approve: result.data.approve,
    reason: result.data.reason,
    costUsd,
  });
  return result.data.approve ? null : result.data.reason;
};
