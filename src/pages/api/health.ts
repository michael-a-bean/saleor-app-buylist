import type { NextApiRequest, NextApiResponse } from "next";

/**
 * Health check endpoint for ALB target group health checks.
 * Returns 200 OK when the service is healthy.
 */
export default function handler(
  _req: NextApiRequest,
  res: NextApiResponse
) {
  res.status(200).json({
    status: "healthy",
    service: "buylist-app",
    timestamp: new Date().toISOString(),
  });
}
