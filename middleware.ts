import { paymentMiddleware, Network } from "x402-next";
import { facilitator } from "@coinbase/x402";

const PAY_TO = "0xe0ed7a30589fec49e98f2085c7162b90fdbb83de";

export const middleware = paymentMiddleware(
  PAY_TO,
  {
    "/api/risk/pro": {
      price: "$0.01",
      network: "base" as Network,
      config: {
        description: "CryptoRisk PRO: full wallet/token risk report (score, reasons, signals, sources).",
      },
    },
  },
  facilitator as any
);

export const config = {
  matcher: ["/api/risk/pro"],
  runtime: "nodejs",
};
