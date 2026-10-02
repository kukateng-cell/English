import { notFound } from "next/navigation";
import FidelityFixture from "./FidelityFixture";

export default function WordCardFidelityPage() {
  if (process.env.ENABLE_TEST_ROUTES !== "1") notFound();
  return <FidelityFixture />;
}
