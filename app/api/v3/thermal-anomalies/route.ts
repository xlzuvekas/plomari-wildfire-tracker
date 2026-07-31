import { handleThermalAnomalyRequest } from "../../../../lib/firewatch/v3/thermal-anomaly-route.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 12;

export async function GET(request: Request) {
  return handleThermalAnomalyRequest(request);
}
