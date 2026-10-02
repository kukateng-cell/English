import type { NextConfig } from "next";
import { productionConfigurationErrors } from "./src/lib/production-config";

if (process.env.VERCEL_ENV === "production") {
  const errors = productionConfigurationErrors(process.env);
  if (errors.length > 0) {
    throw new Error(`Invalid production configuration: ${errors.join("; ")}`);
  }
}

const nextConfig: NextConfig = {
  /* config options here */
};

export default nextConfig;
