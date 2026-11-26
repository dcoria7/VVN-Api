import { deploymentEnvironment } from "@/lib/deployment-environment";

export function GET() {
  return Response.json({ service: "vvn-api", api_version: "1", environment: deploymentEnvironment }, {
    headers: { "Cache-Control": "no-store", "X-Vvn-Environment": deploymentEnvironment },
  });
}
