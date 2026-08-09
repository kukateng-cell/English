import { notFound } from "next/navigation";
import MotionHarness from "./MotionHarness";

export default async function WordCardMotionTestPage({
  searchParams,
}: {
  searchParams: Promise<{ timelineLead?: string }>;
}) {
  if (process.env.ENABLE_TEST_ROUTES !== "1") notFound();
  const params = await searchParams;
  return <MotionHarness timelineLeadEnabled={params.timelineLead !== "0"} />;
}
